import { useEffect, useRef, useState } from 'react';
import { fetchArrivals, type ArrivalDirection } from './api';
import {
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
} from './leaveAlert';

const nowS = () => Date.now() / 1000;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode: the alert still works until the page closes.
  }
}

/** Whether the browser can show notifications, and whether you allowed them. */
export type NotifyState = NotificationPermission | 'unsupported';

const notifyState = (): NotifyState => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

/**
 * The service worker shows the notification: phones' browsers only show them that way, and it can
 * bring the map back when the notification is tapped.
 */
function registerWorker() {
  navigator.serviceWorker?.register('/sw.js').catch(() => {});
}

async function notify(title: string, body: string) {
  if (notifyState() !== 'granted') return;
  const options: NotificationOptions = { body, tag: 'leave-now', icon: '/icon-192.png', requireInteraction: true };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // Fall back to a plain notification.
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // This browser only shows notifications from a service worker, and it isn't ready.
  }
}

/** Two short beeps, for when notifications are off. Needs a sound context made on a tap. */
function beep(ctx: AudioContext | null) {
  if (!ctx) return;
  void ctx.resume().catch(() => {});
  for (const start of [0, 0.3]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + 0.22);
  }
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
 * Keeps one "should I run?" alert going: asks for the station's arrivals now and then, works out when
 * to leave, and tells you with a notification (or a beep, with notifications off). The arrivals are
 * fetched even while the tab is hidden, since that's when the alert matters, but slowly: one small
 * request a minute, every 30 s in the last quarter hour.
 */
export function useLeaveAlert(): LeaveAlert {
  const [watch, setWatch] = useState<LeaveWatch | null>(() => parseWatch(load(LEAVE_WATCH_KEY), nowS()));
  const [walk, setWalk] = useState(() => parseWalk(load(WALK_MINUTES_KEY)));
  // Arrivals with the alert they were fetched for, so a new alert never goes by the last one's.
  const [fetched, setFetched] = useState<{ key: string; directions: ArrivalDirection[] } | null>(null);
  const [now, setNow] = useState(nowS);
  const [permission, setPermission] = useState<NotifyState>(notifyState);
  const audio = useRef<AudioContext | null>(null);

  const watchKey = watch && `${watch.line}|${watch.station.lat},${watch.station.lon}|${watch.toward.join('/')}|${watch.created}`;
  const directions = fetched && fetched.key === watchKey ? fetched.directions : null;
  const plan = watch && directions ? planLeave(watch, directions, now) : null;
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => save(LEAVE_WATCH_KEY, watch && JSON.stringify(watch)), [watch]);

  // A saved alert carries on after a reload, and the worker it notifies through with it.
  useEffect(() => {
    if (watch && permission === 'granted') registerWorker();
    // Only on load.
  }, []);

  // The station's arrival times, fresher as leaving gets close.
  useEffect(() => {
    if (!watch) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchArrivals(watch.line, watch.station, controller.signal)
        .then((r) => setFetched({ key: watchKey!, directions: r.directions }))
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, pollMs(planRef.current, nowS()));
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // The key stands for the parts of the watch that change what to fetch.
  }, [watchKey]);

  // The countdown, between fetches.
  useEffect(() => {
    if (!watch) return;
    setNow(nowS());
    const timer = setInterval(() => setNow(nowS()), 5_000);
    return () => clearInterval(timer);
  }, [watch !== null]);

  // Time to go: say so once, then keep the alert up until that vehicle has come.
  useEffect(() => {
    if (!watch) return;
    if (watchDone(watch, plan, now)) {
      setWatch(null);
      return;
    }
    if (plan?.kind !== 'leave' || watch.told || !plan.arrival) return;
    setWatch({ ...watch, told: { vehicleId: plan.vehicleId, time: plan.time } });
    const { title, body } = leaveMessage(watch, plan.arrival, now);
    if (notifyState() === 'granted') void notify(title, body);
    else beep(audio.current);
    navigator.vibrate?.([300, 150, 300]);
  }, [watch, plan?.kind, plan?.kind !== 'none' && plan?.time, now]);

  // The tab's title says it too, for a tab in the background.
  const leaving = plan?.kind === 'leave';
  useEffect(() => {
    if (!leaving) return;
    const before = document.title;
    document.title = 'Leave now · NY Transit Live';
    return () => {
      document.title = before;
    };
  }, [leaving]);

  const start: LeaveAlert['start'] = (next) => {
    setWalk(next.walkMinutes);
    save(WALK_MINUTES_KEY, String(next.walkMinutes));
    setWatch({ ...next, created: nowS() });
    // Made on the tap, so the beep may play later.
    try {
      audio.current ??= new AudioContext();
    } catch {
      // No sound then.
    }
    if (notifyState() === 'default') {
      void Notification.requestPermission()
        .then((p) => {
          setPermission(p);
          if (p === 'granted') registerWorker();
        })
        .catch(() => {});
    } else if (notifyState() === 'granted') {
      registerWorker();
    }
  };

  const stop = () => setWatch(null);

  return { watch, plan, now, walk, notifyState: permission, start, stop };
}
