import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import {
  HEADS_UP_S,
  LEAVE_WATCH_KEY,
  leaveMessage,
  parseWalk,
  parseWatch,
  planLeave,
  pollMs,
  WALK_MINUTES_KEY,
  watchDone,
  type LeavePlan,
  type LeaveWatch,
} from '../../web/src/leaveAlert';
import { fetchArrivals, type ArrivalDirection } from './api';

/** One alert at a time, so its notification always has this name and a new one replaces the old. */
const NOTIFICATION_ID = 'leave-now';
const nowS = () => Date.now() / 1000;

// Shown even with the app open, since that's when you're most likely to be looking at the map.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type NotifyState = 'granted' | 'denied' | 'undetermined';

async function permission(ask: boolean): Promise<NotifyState> {
  try {
    const now = await Notifications.getPermissionsAsync();
    if (now.granted || !ask || !now.canAskAgain) return now.granted ? 'granted' : now.status === 'undetermined' ? 'undetermined' : 'denied';
    const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
    return asked.granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Sets the notification to go off at `at` (Unix seconds), or now; replaces one not yet shown. */
function schedule(content: { title: string; body: string }, at?: number) {
  Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: { ...content, sound: 'default', data: { kind: 'leave-now' } },
    trigger: at === undefined ? null : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at * 1000 },
  }).catch(() => {});
}

function cancel() {
  Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID).catch(() => {});
}

export interface LeaveAlert {
  watch: LeaveWatch | null;
  plan: LeavePlan | null;
  /** The clock the plan was worked out at, in Unix seconds. */
  now: number;
  /** The last walk time picked, offered first next time. */
  walk: number;
  notifyState: NotifyState;
  start: (watch: Omit<LeaveWatch, 'created' | 'told' | 'notifyAt'>) => void;
  stop: () => void;
}

/**
 * Keeps one "should I run?" alert going. While the app is open it asks for the station's arrivals now and
 * then and works out when to leave. Each time that changes, the notification is set again for the new
 * time, so it still comes when the app is in the background or closed, from the last times it heard.
 */
export function useLeaveAlert(active: boolean): LeaveAlert {
  const [loaded, setLoaded] = useState(false);
  const [watch, setWatch] = useState<LeaveWatch | null>(null);
  const [walk, setWalk] = useState(parseWalk(null));
  const [directions, setDirections] = useState<ArrivalDirection[] | null>(null);
  const [now, setNow] = useState(nowS);
  const [notifyState, setNotifyState] = useState<NotifyState>('undetermined');

  const plan = watch && directions ? planLeave(watch, directions, now) : null;
  const planRef = useRef(plan);
  planRef.current = plan;

  // An alert set before the app was closed carries on.
  useEffect(() => {
    AsyncStorage.multiGet([LEAVE_WATCH_KEY, WALK_MINUTES_KEY])
      .then(([[, saved], [, walked]]) => {
        setWatch(parseWatch(saved, nowS()));
        setWalk(parseWalk(walked));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    void permission(false).then(setNotifyState);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (watch ? AsyncStorage.setItem(LEAVE_WATCH_KEY, JSON.stringify(watch)) : AsyncStorage.removeItem(LEAVE_WATCH_KEY)).catch(() => {});
  }, [watch, loaded]);

  // The station's arrival times, fresher as leaving gets close; nothing while the app is in the background.
  const watchKey = watch && `${watch.line}|${watch.station.lat},${watch.station.lon}|${watch.toward.join('/')}|${watch.created}`;
  useEffect(() => {
    if (!watch || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchArrivals(watch.line, { lat: watch.station.lat, lon: watch.station.lon }, controller.signal)
        .then((r) => setDirections(r.directions))
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, pollMs(planRef.current, nowS()));
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [watchKey, active]);

  // A different alert starts from no arrivals, not the last one's.
  useEffect(() => setDirections(null), [watchKey]);

  // The countdown, between fetches.
  useEffect(() => {
    if (!watch || !active) return;
    setNow(nowS());
    const timer = setInterval(() => setNow(nowS()), 5_000);
    return () => clearInterval(timer);
  }, [watch !== null, active]);

  // Set the notification ahead for when to leave, and again whenever that time moves.
  useEffect(() => {
    if (!watch || watch.told || !plan || notifyState !== 'granted') return;
    const set = watch.notifyAt;
    if (plan.kind === 'none') {
      // Nothing left to catch: a notification set for one that's gone would be wrong.
      if (set && set.at > nowS()) {
        cancel();
        setWatch({ ...watch, notifyAt: undefined });
      }
      return;
    }
    if (plan.kind !== 'wait' || !plan.arrival) return;
    const at = plan.leaveAt - HEADS_UP_S;
    if (set && set.vehicleId === plan.vehicleId && Math.abs(set.at - at) < 15) return;
    // It already went off: being told again would only confuse.
    if (set && set.at <= nowS()) return;
    schedule(leaveMessage(watch, plan.arrival, at), at);
    setWatch({ ...watch, notifyAt: { vehicleId: plan.vehicleId, at } });
  }, [watch, plan?.kind, plan?.kind !== 'none' && plan?.vehicleId, plan?.kind !== 'none' && plan?.leaveAt, notifyState]);

  // Time to go: say so once (unless the notification set ahead already did), then keep the alert up
  // until that vehicle has come.
  useEffect(() => {
    if (!watch) return;
    if (watchDone(watch, plan, now)) {
      if (!watch.told) cancel();
      setWatch(null);
      return;
    }
    if (plan?.kind !== 'leave' || watch.told || !plan.arrival) return;
    const set = watch.notifyAt;
    const wentOff = set !== undefined && set.vehicleId === plan.vehicleId && set.at <= now;
    setWatch({ ...watch, told: { vehicleId: plan.vehicleId, time: plan.time } });
    if (wentOff) return;
    if (notifyState === 'granted') schedule(leaveMessage(watch, plan.arrival, now));
    else cancel();
    if (active) Vibration.vibrate([0, 300, 150, 300]);
  }, [watch, plan?.kind, plan?.kind !== 'none' && plan?.time, now]);

  const start: LeaveAlert['start'] = (next) => {
    cancel();
    setWalk(next.walkMinutes);
    AsyncStorage.setItem(WALK_MINUTES_KEY, String(next.walkMinutes)).catch(() => {});
    setDirections(null);
    setNow(nowS());
    setWatch({ ...next, created: nowS() });
    void permission(true).then(setNotifyState);
  };

  const stop = () => {
    cancel();
    setWatch(null);
  };

  return { watch, plan, now, walk, notifyState, start, stop };
}

/** Calls `onOpen` when one of the alert's notifications is tapped. */
export function useLeaveNotificationTap(onOpen: () => void) {
  const latest = useRef(onOpen);
  latest.current = onOpen;
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      if (r.notification.request.content.data?.kind === 'leave-now') latest.current();
    });
    return () => sub.remove();
  }, []);
}
