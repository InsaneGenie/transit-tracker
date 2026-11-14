import type { Arrival, ArrivalDirection, Mode, UpcomingStop } from './api';
import { displayName, tidyStopName } from './names';

/**
 * "Should I run?" alerts: pick a station and a direction, say how long your walk there takes, and you are
 * told when to leave so you reach the platform or stop just before the next train or bus you can still
 * catch. It goes by the live arrival times, which follow where each vehicle really is, not the timetable.
 * Shared by the site and the iPhone app.
 */

/** Walk times offered, in minutes. */
export const WALK_CHOICES = [2, 5, 8, 10, 15, 20, 30];
export const DEFAULT_WALK = 5;
export const LEAVE_WATCH_KEY = 'transit-tracker:leave-alert';
export const WALK_MINUTES_KEY = 'transit-tracker:walk-minutes';

/** You're told this many seconds before you'd have to leave, to get out the door. */
export const HEADS_UP_S = 30;
/** A vehicle you'd reach a minute late still counts: you can hurry, and they often wait a little. */
const LATE_OK_S = 60;
/** A forgotten alert ends by itself. */
const MAX_AGE_S = 2 * 3600;
/** After you were told to leave, the alert stays up until that vehicle has come and gone. */
const AFTER_ARRIVAL_S = 60;

export interface LeaveWatch {
  /** The line's route key, e.g. "subway:5". */
  line: string;
  /** The line's name as shown, e.g. "5" or "M15". */
  name: string;
  mode: Mode;
  /** The station, with what its card shows (transfers, step-free access) for opening it again. */
  station: Pick<UpcomingStop, 'stopId' | 'name' | 'transfers' | 'access' | 'accessNote'> & { lat: number; lon: number };
  /** Where the watched direction's trips end, as the arrivals list names them. */
  toward: string[];
  walkMinutes: number;
  /** When it was set, in Unix seconds. */
  created: number;
  /** Set once you've been told to leave, for that vehicle. */
  told?: { vehicleId: string; time: number };
  /**
   * The app's notification waiting to go off, set ahead so it still comes while the app is closed: for
   * which vehicle, and when (Unix seconds).
   */
  notifyAt?: { vehicleId: string; at: number };
}

/** What a station's arrivals list needs to set an alert for one of its directions. */
export interface LeaveControls {
  /** The destinations of the direction with an alert on at this station, or null. */
  watching: string[] | null;
  /** Its countdown, e.g. "Leave in 6 min · train in 11 min". */
  status?: string;
  /** The walk time picked last time. */
  walk: number;
  onStart: (toward: string[], walkMinutes: number) => void;
  onStop: () => void;
}

export type LeavePlan =
  /**
   * The vehicle you can catch, when it reaches the station and when to leave for it. `arrival` is
   * missing only once you were told to leave and that vehicle has dropped off the list.
   */
  | { kind: 'wait' | 'leave'; vehicleId: string; time: number; leaveAt: number; arrival?: Arrival }
  /** Nothing on the way that you can still reach in time. */
  | { kind: 'none' };

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;

/** Whether an arrivals direction is the one being watched. */
export function sameDirection(destinations: string[], toward: string[]): boolean {
  if (!toward.length) return !destinations.length;
  return overlap(destinations, toward) > 0;
}

/** The watched direction among the station's arrivals: the one sharing the most destinations. */
export function watchedDirection(directions: ArrivalDirection[], toward: string[]): ArrivalDirection | undefined {
  let best: ArrivalDirection | undefined;
  let bestShared = 0;
  for (const d of directions) {
    if (!toward.length) {
      if (!d.destinations.length) return d;
      continue;
    }
    const shared = overlap(d.destinations, toward);
    if (shared > bestShared) {
      best = d;
      bestShared = shared;
    }
  }
  return best;
}

/** What to do now: wait, leave, or nothing to catch. `now` is in Unix seconds. */
export function planLeave(watch: LeaveWatch, directions: ArrivalDirection[], now: number): LeavePlan {
  const walk = watch.walkMinutes * 60;
  const direction = watchedDirection(directions, watch.toward);
  // Once told to leave, you're on your way to that one, even after it drops off the list.
  if (watch.told) {
    const { vehicleId, time } = watch.told;
    const arrival = direction?.arrivals.find((a) => a.vehicle.id === vehicleId);
    const at = arrival?.time ?? time;
    return { kind: 'leave', vehicleId, time: at, leaveAt: at - walk, arrival };
  }
  const arrival = direction?.arrivals.find((a) => a.time - walk >= now - LATE_OK_S);
  if (!arrival) return { kind: 'none' };
  const leaveAt = arrival.time - walk;
  const kind = leaveAt - now <= HEADS_UP_S ? 'leave' : 'wait';
  return { kind, vehicleId: arrival.vehicle.id, time: arrival.time, leaveAt, arrival };
}

/** Whether the alert is over: you were told and the vehicle has come, or it was forgotten. */
export function watchDone(watch: LeaveWatch, plan: LeavePlan | null, now: number): boolean {
  if (now - watch.created > MAX_AGE_S) return true;
  if (!watch.told) return false;
  const time = plan?.kind === 'leave' ? plan.time : watch.told.time;
  return now > time + AFTER_ARRIVAL_S;
}

/** "train" or "bus". */
export const vehicleNoun = (mode: Mode) => (mode === 'bus' ? 'bus' : 'train');

/** The countdown shown while waiting, e.g. "Leave in 6 min". */
export function leaveIn(plan: LeavePlan, now: number): string {
  if (plan.kind === 'none') return 'Nothing to catch yet';
  if (plan.kind === 'leave') return 'Leave now';
  const minutes = Math.max(1, Math.round((plan.leaveAt - now) / 60));
  return `Leave in ${minutes} min`;
}

/** When the vehicle gets to the station, e.g. "in 12 min". */
export function arrivingIn(time: number, now: number): string {
  const minutes = Math.round((time - now) / 60);
  if (minutes <= 0) return 'arriving now';
  if (minutes < 60) return `in ${minutes} min`;
  return `at ${new Date(time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** The alert's countdown with its vehicle, e.g. "Leave in 6 min · train in 11 min". */
export function alertStatus(watch: LeaveWatch, plan: LeavePlan | null, now: number): string {
  if (!plan) return 'Checking the arrivals…';
  if (plan.kind === 'none') return `Waiting for a ${vehicleNoun(watch.mode)} you can make`;
  return `${leaveIn(plan, now)} · ${vehicleNoun(watch.mode)} ${arrivingIn(plan.time, now)}`;
}

/** Short words for the alert's line, e.g. "5 to Wakefield-241 St". */
export function watchLabel(watch: LeaveWatch): string {
  const toward = watch.toward.map(tidyStopName).join(' / ');
  return toward ? `${watch.name} to ${toward}` : watch.name;
}

/** The notification telling you to go; "Run" when leaving now already makes you a little late. */
export function leaveMessage(watch: LeaveWatch, arrival: Arrival, now: number): { title: string; body: string } {
  const late = arrival.time - watch.walkMinutes * 60 < now - 15;
  const noun = vehicleNoun(watch.mode);
  const minutes = Math.max(0, Math.round((arrival.time - now) / 60));
  const station = watch.station.name ? tidyStopName(watch.station.name) : 'your stop';
  const reaches = minutes <= 0 ? `is reaching ${station} now` : `reaches ${station} in ${minutes} min`;
  const stop = arrival.vehicle.stopName && tidyStopName(arrival.vehicle.stopName);
  const where =
    arrival.vehicle.status === 'STOPPED_AT' && stop ? ` It's at ${stop}.` : stop ? ` It's heading to ${stop}.` : '';
  const toward = watch.toward.length ? ` to ${tidyStopName(watch.toward[0])}` : '';
  return {
    title: `${late ? 'Run' : 'Leave now'} for the ${displayName(watch.name)} ${noun}`,
    body: `The ${displayName(watch.name)}${toward} ${reaches}.${where} Your walk is ${watch.walkMinutes} min.`,
  };
}

/** A saved alert read back, or null when there is none or it's broken or old. */
export function parseWatch(text: string | null, now: number): LeaveWatch | null {
  if (!text) return null;
  try {
    const w = JSON.parse(text) as LeaveWatch;
    const ok =
      typeof w.line === 'string' &&
      typeof w.name === 'string' &&
      typeof w.walkMinutes === 'number' &&
      typeof w.created === 'number' &&
      Array.isArray(w.toward) &&
      typeof w.station?.lat === 'number' &&
      typeof w.station?.lon === 'number';
    return ok && !watchDone(w, null, now) ? w : null;
  } catch {
    return null;
  }
}

/** A saved walk time read back. */
export function parseWalk(text: string | null): number {
  const n = Number(text);
  return WALK_CHOICES.includes(n) ? n : DEFAULT_WALK;
}

/** How often to ask for fresh arrival times while an alert is on: more often as leaving gets close. */
export function pollMs(plan: LeavePlan | null, now: number): number {
  if (!plan || plan.kind === 'none') return 60_000;
  if (plan.kind === 'leave') return 60_000;
  return plan.leaveAt - now > 15 * 60 ? 60_000 : 30_000;
}
