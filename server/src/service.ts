import type { RouteTrips, Service, Timetable } from './static-gtfs.js';

/**
 * Ghost buses and bunching: how a bus line's service on the road compares with its schedule.
 *
 * A ghost bus is a trip the schedule says is under way that no bus is running: none reports that trip, and
 * none is still finishing the trip before it on the same block (that bus is just late).
 */

/** A scheduled trip with no bus behind it. */
export interface MissingTrip {
  tripId: string;
  /** When it was due to leave its first stop, Unix seconds. */
  start: number;
  /** When it was due at its last stop, Unix seconds. */
  end: number;
  /** Where it was headed, as the schedule words it. */
  headsign?: string;
  /** 1 when it runs toward the end of the line's station list, -1 toward the start. */
  heading?: 1 | -1;
}

/** How a line is running against its schedule right now. */
export interface LineService {
  /** Trips the schedule has out on the road now (given a few minutes to get going). */
  scheduled: number;
  /** Of those, how many have no bus. */
  missing: MissingTrip[];
  /** About how often a bus is due each way, in minutes, from how many trips are scheduled out now. */
  headways: { forward?: number; back?: number };
  /** How long a trip takes from end to end, in minutes, as scheduled (the middle of the trips out now). */
  tripMinutes?: number;
}

/** A trip this late leaving with no bus is missing; before that its bus may just be getting going, in seconds. */
export const MISSING_AFTER_S = 5 * 60;

/** The parts of a moment that a schedule needs: the service day's date, its weekday and the time of day. */
export interface ServiceDay {
  /** YYYYMMDD. */
  date: string;
  /** Monday is 0, Sunday 6. */
  weekday: number;
  /** Seconds after the day's midnight. A trip past midnight is on yesterday's schedule, at 24:00 and up. */
  seconds: number;
}

const nyParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Today and yesterday in New York at `now` (Unix seconds), as the schedule counts them. */
export function serviceDays(now: number): [today: ServiceDay, yesterday: ServiceDay] {
  const part = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const at = nyParts.formatToParts(new Date(now * 1000));
  const seconds = Number(part(at, 'hour')) * 3600 + Number(part(at, 'minute')) * 60 + Number(part(at, 'second'));
  const today = { date: `${part(at, 'year')}${part(at, 'month')}${part(at, 'day')}`, weekday: WEEKDAYS.indexOf(part(at, 'weekday')), seconds };
  // Noon yesterday is the day before whatever the clocks did overnight.
  const before = nyParts.formatToParts(new Date((now - seconds + 12 * 3600 - 86400) * 1000));
  const yesterday = {
    date: `${part(before, 'year')}${part(before, 'month')}${part(before, 'day')}`,
    weekday: WEEKDAYS.indexOf(part(before, 'weekday')),
    seconds: seconds + 86400,
  };
  return [today, yesterday];
}

export function runsOn(service: Service | undefined, day: ServiceDay): boolean {
  if (!service) return false;
  if (service.removed.has(day.date)) return false;
  if (service.added.has(day.date)) return true;
  return (service.days & (1 << day.weekday)) !== 0 && service.start <= day.date && day.date <= service.end;
}

/** Each timetable's services that run on each of the days, by their index in `serviceIds`. */
export function servicesOn(timetable: Timetable, days: ServiceDay[]): boolean[][] {
  return days.map((day) => timetable.serviceIds.map((id) => runsOn(timetable.services.get(id), day)));
}

/** Calls `fn` for each trip of a route that is scheduled out on the road at the time of `days`. */
function eachScheduled(
  trips: RouteTrips,
  running: boolean[][],
  days: ServiceDay[],
  fn: (i: number, day: ServiceDay) => void,
  margin = 0,
): void {
  for (let i = 0; i < trips.tripIds.length; i++) {
    const start = trips.start[i];
    if (start < 0) continue;
    for (let d = 0; d < days.length; d++) {
      const t = days[d].seconds;
      if (start - margin <= t && t < trips.end[i] + margin && running[d][trips.service[i]]) {
        fn(i, days[d]);
        break;
      }
    }
  }
}

/** What every bus reporting in says about the whole feed's schedule at once. */
export interface AtWork {
  /** Every block with a bus at work on it now, by timetable, with when its earliest trip with a bus was due out (Unix seconds). */
  blocks: Map<number, number>[];
  /** Trips scheduled out now, past MISSING_AFTER_S, across every route, and how many of them have a bus at work on them. */
  scheduled: number;
  running: number;
}

/**
 * Which blocks have a bus at work on them now: the bus doing a block's earlier trip late still counts for
 * the block's next trip. `covered` holds the trips a bus reports it is running.
 */
export function blocksAtWork(timetables: Timetable[], covered: Set<string>, now: number): AtWork {
  const days = serviceDays(now);
  let scheduled = 0;
  let running = 0;
  const runs = timetables.map((timetable) => servicesOn(timetable, days));
  const blocks = timetables.map((timetable, t) => {
    const blocks = new Map<number, number>();
    for (const trips of timetable.routes.values()) {
      // A late bus is at most a couple of hours behind.
      eachScheduled(trips, runs[t], days, (i, day) => {
        const block = trips.block[i];
        if (block < 0 || !covered.has(trips.tripIds[i])) return;
        const start = Math.floor(now) - day.seconds + trips.start[i];
        blocks.set(block, Math.min(blocks.get(block) ?? Infinity, start));
      }, 2 * 3600);
    }
    return blocks;
  });
  timetables.forEach((timetable, t) => {
    for (const trips of timetable.routes.values()) {
      eachScheduled(trips, runs[t], days, (i, day) => {
        if (day.seconds - trips.start[i] < MISSING_AFTER_S) return;
        scheduled++;
        if (covered.has(trips.tripIds[i]) || lateOnBlock(blocks[t], trips, i, Math.floor(now) - day.seconds)) running++;
      });
    }
  });
  return { blocks, scheduled, running };
}

/** Whether the bus for trip `i` is still out on an earlier trip of its block, running late. */
function lateOnBlock(blocks: Map<number, number> | undefined, trips: RouteTrips, i: number, midnight: number): boolean {
  const block = trips.block[i];
  if (block < 0) return false;
  const earliest = blocks?.get(block);
  return earliest !== undefined && earliest < midnight + trips.start[i];
}

/** The middle value, or undefined for none. */
function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * How a route's service compares with its schedule. `covered` is every trip a bus reports running and
 * `blocks` what blocksAtWork found for them.
 */
export function lineService(
  timetables: Timetable[],
  routeId: string,
  covered: Set<string>,
  blocks: Map<number, number>[],
  now: number,
): LineService | undefined {
  const days = serviceDays(now);
  let scheduled = 0;
  const missing: MissingTrip[] = [];
  const out = { forward: 0, back: 0 };
  const durations: number[] = [];
  let found = false;
  // The station list runs the way its trip did: the first schedule's to list the route (as merging keeps
  // that one's stops first). Without it, direction 0 is taken as toward the end of the list.
  const forwardDirection = timetables.map((x) => x.routes.get(routeId)?.listedDirection).find((d) => d !== undefined) ?? 0;
  timetables.forEach((timetable, t) => {
    const trips = timetable.routes.get(routeId);
    if (!trips) return;
    found = true;
    const running = servicesOn(timetable, days);
    eachScheduled(trips, running, days, (i, day) => {
      const heading = trips.direction[i] === forwardDirection ? 1 : -1;
      out[heading === 1 ? 'forward' : 'back']++;
      durations.push(trips.end[i] - trips.start[i]);
      // Just leaving: its bus may still be pulling in.
      if (day.seconds - trips.start[i] < MISSING_AFTER_S) return;
      scheduled++;
      const tripId = trips.tripIds[i];
      const midnight = Math.floor(now) - day.seconds;
      if (covered.has(tripId) || lateOnBlock(blocks[t], trips, i, midnight)) return;
      const headsign = trips.headsigns[trips.headsign[i]];
      missing.push({
        tripId,
        start: midnight + trips.start[i],
        end: midnight + trips.end[i],
        ...(headsign && { headsign }),
        heading,
      });
    });
  });
  if (!found) return undefined;
  const tripSeconds = median(durations);
  const every = (n: number) => (tripSeconds && n ? Math.max(1, Math.round(tripSeconds / 60 / n)) : undefined);
  missing.sort((a, b) => a.start - b.start);
  return {
    scheduled,
    missing,
    headways: { forward: every(out.forward), back: every(out.back) },
    ...(tripSeconds && { tripMinutes: Math.round(tripSeconds / 60) }),
  };
}

/** The gap from a vehicle to the next one ahead of it going the same way. */
export interface Gap {
  /** The vehicle ahead. */
  aheadId: string;
  meters: number;
  /** About how far behind it is, in minutes, at the line's scheduled pace. */
  minutes?: number;
  /** "bunched" when right behind it, "long" when far more than the usual time between buses. */
  kind?: 'bunched' | 'long';
}

/** Buses closer than this share of the scheduled time between them are bunched. */
const BUNCHED_SHARE = 0.25;
/** Closer than this, in minutes, two buses are bunched however often they run. */
const BUNCHED_MIN = 1;
/** A gap this many times the scheduled time between buses is a long one, and at least LONG_MIN minutes. */
const LONG_SHARE = 2;
const LONG_MIN = 10;

export function gapKind(minutes: number | undefined, headway: number | undefined): Gap['kind'] {
  if (minutes === undefined) return undefined;
  if (minutes <= Math.max(BUNCHED_MIN, headway === undefined ? 0 : headway * BUNCHED_SHARE)) return 'bunched';
  if (headway !== undefined && minutes >= Math.max(LONG_MIN, headway * LONG_SHARE)) return 'long';
  return undefined;
}

/**
 * The gap behind each vehicle going one way, by vehicle id. `along` is each one's distance along the line,
 * in meters, increasing the way they go. Vehicles at either end of the line are left out: buses wait there
 * between trips, side by side.
 */
export function gapsAlong(
  vehicles: { id: string; along: number; atEnd: boolean }[],
  metersPerMinute: number | undefined,
  headway: number | undefined,
): Map<string, Gap> {
  const moving = vehicles.filter((v) => !v.atEnd).sort((a, b) => a.along - b.along);
  const gaps = new Map<string, Gap>();
  for (let i = 0; i + 1 < moving.length; i++) {
    const behind = moving[i];
    const ahead = moving[i + 1];
    const meters = Math.round(ahead.along - behind.along);
    const minutes = metersPerMinute ? Math.round((meters / metersPerMinute) * 10) / 10 : undefined;
    const kind = gapKind(minutes, headway);
    gaps.set(behind.id, { aheadId: ahead.id, meters, ...(minutes !== undefined && { minutes }), ...(kind && { kind }) });
  }
  return gaps;
}
