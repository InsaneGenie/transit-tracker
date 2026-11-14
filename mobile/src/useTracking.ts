import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventSubscription } from 'expo';
import type { LiveActivity } from 'expo-widgets';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { ARRIVED_FOR_MS, isOver, staleAfter, trackProps, type TrackProps, type TrackStop } from '../../web/src/tracking';
import { tidyStopName } from '../../web/src/vehicles';
import { fetchVehicleDetail, NotFoundError, signOffLiveActivity, signUpLiveActivity, type VehicleDetail } from './api';
import { widgetModules } from './widgets/native';

const TRACK_KEY = 'transit-tracker:tracking';
/** Opening the Live Activity opens the app on the vehicle it follows. */
export const TRACK_URL = 'nytransitlive://track';
/** How often the followed vehicle is checked while the app is open. */
const POLL_MS = 10_000;
/** A vehicle missing from the feeds this long is given up on, like the server does. */
const LOST_AFTER_MS = 3 * 60_000;
/** A finished Live Activity stays on the Lock Screen this long, so its last word can be read. */
const LINGER_MS = 2 * 60_000;

export interface Badge {
  line: string;
  color: string;
  textColor: string;
}

/** The vehicle followed on the Lock Screen, remembered so the app picks it up again after a restart. */
export interface Tracked {
  activityId: string;
  vehicleId: string;
  stop: TrackStop;
  badge: Badge;
  startedAt: number;
}

function parseTracked(saved: string | null): Tracked | null {
  try {
    const t = JSON.parse(saved ?? 'null');
    if (t && typeof t.activityId === 'string' && typeof t.vehicleId === 'string' && t.stop && t.badge) return t;
  } catch {
    // Unreadable: start afresh.
  }
  return null;
}

/** Updating the Lock Screen while the app is open costs nothing, so it's kept fresher than pushes are. */
function worthUpdating(before: TrackProps | null, after: TrackProps): boolean {
  if (!before) return true;
  if (before.phase !== after.phase || before.stopsAway !== after.stopsAway || before.where !== after.where) return true;
  if (before.gps !== after.gps || (before.arrival ?? 0) !== (after.arrival ?? 0)) return true;
  return after.updatedAt - before.updatedAt >= 60_000;
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Following a train or bus on the Lock Screen with a Live Activity: starting and stopping it, keeping it
 * up to date while the app is open, and signing it up with the server, which updates it while the app is
 * closed. Only one is followed at a time.
 */
export function useTracking(active: boolean) {
  const factory = widgetModules()?.TrackActivity ?? null;
  // Live Activities are an iPhone thing; iPads don't show them.
  const supported = factory !== null && !(Platform.OS === 'ios' && Platform.isPad);
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const instance = useRef<LiveActivity<TrackProps> | null>(null);
  const last = useRef<TrackProps | null>(null);
  const token = useRef<string | null>(null);
  const tokenSub = useRef<EventSubscription | null>(null);
  const trackedRef = useRef<Tracked | null>(null);
  trackedRef.current = tracked;

  const signUp = useCallback((t: Tracked) => {
    if (!token.current) return;
    signUpLiveActivity({ token: token.current, vehicleId: t.vehicleId, stop: t.stop, badge: t.badge, startedAt: t.startedAt }).catch(
      () => {},
    );
  }, []);

  // Push tokens arrive a moment after the Live Activity starts, and can change while it runs.
  const watchToken = useCallback(
    (activity: LiveActivity<TrackProps>, t: Tracked) => {
      tokenSub.current?.remove();
      token.current = null;
      tokenSub.current = activity.addPushTokenListener((e) => {
        if (e.activityId !== t.activityId || e.pushToken === token.current) return;
        token.current = e.pushToken;
        signUp(t);
      });
      activity
        .getPushToken()
        .then((tok) => {
          if (tok && tok !== token.current && trackedRef.current?.activityId === t.activityId) {
            token.current = tok;
            signUp(t);
          }
        })
        .catch(() => {});
    },
    [signUp],
  );

  /** Forgets the followed vehicle, here and on the server. */
  const forget = useCallback(() => {
    tokenSub.current?.remove();
    tokenSub.current = null;
    if (token.current) signOffLiveActivity(token.current).catch(() => {});
    token.current = null;
    instance.current = null;
    last.current = null;
    setTracked(null);
    AsyncStorage.removeItem(TRACK_KEY).catch(() => {});
  }, []);

  /** Ends the Live Activity showing `final`, or at once without it. */
  const finish = useCallback(
    (final?: TrackProps) => {
      const activity = instance.current;
      forget();
      if (!activity) return;
      const ended = final
        ? activity.end({ after: new Date(Date.now() + LINGER_MS) }, final, new Date())
        : activity.end('immediate');
      ended.catch(() => {});
    },
    [forget],
  );

  // After a restart, pick up the Live Activity left running, and end any strays.
  useEffect(() => {
    if (!factory) return;
    let cancelled = false;
    AsyncStorage.getItem(TRACK_KEY)
      .then((saved) => {
        if (cancelled) return;
        const t = parseTracked(saved);
        let running: LiveActivity<TrackProps>[] = [];
        try {
          running = factory.getInstances();
        } catch {
          running = [];
        }
        const mine = t ? running.find((a) => a.getId() === t.activityId) : undefined;
        for (const a of running) if (a !== mine) a.end('immediate').catch(() => {});
        if (t && mine) {
          instance.current = mine;
          setTracked(t);
          watchToken(mine, t);
        } else if (saved !== null) {
          AsyncStorage.removeItem(TRACK_KEY).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [factory, watchToken]);

  // Coming back to the app: the Live Activity may have been swiped away, and the server may have restarted.
  useEffect(() => {
    const t = trackedRef.current;
    if (!active || !factory || !t) return;
    let running: LiveActivity<TrackProps>[] = [];
    try {
      running = factory.getInstances();
    } catch {
      return;
    }
    if (!running.some((a) => a.getId() === t.activityId)) forget();
    else signUp(t);
  }, [active, factory, forget, signUp]);

  // Keep it up to date while the app is open.
  useEffect(() => {
    if (!active || !tracked) return;
    const controller = new AbortController();
    let missingSince: number | null = null;
    let arrivedAt: number | null = null;
    const load = () =>
      fetchVehicleDetail(tracked.vehicleId, controller.signal)
        .then((detail) => {
          missingSince = null;
          const now = Date.now();
          const props = trackProps(detail, tracked.stop, { ...tracked.badge, tidy: tidyStopName }, tracked.startedAt, now);
          arrivedAt = props.phase === 'arrived' ? (arrivedAt ?? now) : null;
          if (isOver(props.phase) || (arrivedAt !== null && now - arrivedAt >= ARRIVED_FOR_MS)) return finish(props);
          if (!worthUpdating(last.current, props)) return;
          instance.current
            ?.update(props, new Date(staleAfter(props)))
            .then(() => {
              last.current = props;
            })
            // Gone from the Lock Screen: swiped away, or iOS ended it.
            .catch(() => forget());
        })
        .catch((err: unknown) => {
          if (!(err instanceof NotFoundError)) return;
          const now = Date.now();
          missingSince ??= now;
          if (now - missingSince > LOST_AFTER_MS && last.current) finish({ ...last.current, phase: 'lost', updatedAt: now });
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active, tracked, finish, forget]);

  /** Starts following a vehicle to a station on the Lock Screen, in place of any followed before. */
  const start = useCallback(
    (detail: VehicleDetail, stop: TrackStop, badge: Badge) => {
      if (!factory) return;
      const startedAt = Date.now();
      const props = trackProps(detail, stop, { ...badge, tidy: tidyStopName }, startedAt, startedAt);
      if (isOver(props.phase)) return;
      finish();
      let activity: LiveActivity<TrackProps>;
      try {
        activity = factory.start(props, TRACK_URL, new Date(staleAfter(props)));
      } catch (err) {
        Alert.alert(
          "Couldn't show it on the Lock Screen",
          /not supported|enabled|authoriz/i.test(describe(err))
            ? 'Live Activities are turned off for NY Transit Live. Turn them on in Settings, NY Transit Live, Live Activities.'
            : describe(err),
        );
        return;
      }
      const t: Tracked = { activityId: activity.getId(), vehicleId: detail.vehicle.id, stop, badge, startedAt };
      instance.current = activity;
      last.current = props;
      setTracked(t);
      AsyncStorage.setItem(TRACK_KEY, JSON.stringify(t)).catch(() => {});
      watchToken(activity, t);
    },
    [factory, finish, watchToken],
  );

  const stop = useCallback(() => finish(), [finish]);

  return { supported, tracked, start, stop };
}
