import { parse } from 'csv-parse';
import type { TripState } from './realtime.js';
import { parseGtfsTime, type GtfsFiles } from './static-gtfs.js';

/**
 * A schedule's trips with their stop times and the days they run, for a feed with no realtime data (the
 * Staten Island Ferry publishes only a timetable). Its trips are listed as if a realtime feed had sent
 * them, so boats are placed along their way exactly like trains placed from predicted times.
 */
export interface Timetable {
  trips: TimetableTrip[];
  /** Weekdays each service runs on, Sunday first, and the dates (YYYYMMDD) it is in effect. */
  services: Map<string, { days: boolean[]; start: string; end: string }>;
  /** Dates a service is added on (true) or taken off (false), by `${serviceId}|${date}`. */
  exceptions: Map<string, boolean>;
}

export interface TimetableTrip {
  tripId: string;
  routeId: string;
  serviceId: string;
  /** Seconds after the service day's start, in stop order. */
  stops: { stopId: string; arrival?: number; departure?: number }[];
}

type Row = Record<string, string>;

async function* rows(files: GtfsFiles, name: string): AsyncGenerator<Row> {
  const input = files(name);
  if (!input) return;
  yield* input.pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }));
}

const DAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Reads every trip and stop time. Only for small schedules: a ferry's, not a bus network's. */
export async function loadTimetable(files: GtfsFiles): Promise<Timetable> {
  const services: Timetable['services'] = new Map();
  for await (const r of rows(files, 'calendar.txt')) {
    services.set(r.service_id, { days: DAY_COLUMNS.map((d) => r[d] === '1'), start: r.start_date, end: r.end_date });
  }
  const exceptions: Timetable['exceptions'] = new Map();
  for await (const r of rows(files, 'calendar_dates.txt')) {
    if (r.exception_type === '1' || r.exception_type === '2') exceptions.set(`${r.service_id}|${r.date}`, r.exception_type === '1');
  }
  const byId = new Map<string, TimetableTrip & { seqs: number[] }>();
  for await (const r of rows(files, 'trips.txt')) {
    byId.set(r.trip_id, { tripId: r.trip_id, routeId: r.route_id, serviceId: r.service_id, stops: [], seqs: [] });
  }
  for await (const r of rows(files, 'stop_times.txt')) {
    const trip = byId.get(r.trip_id);
    if (!trip) continue;
    trip.stops.push({ stopId: r.stop_id, arrival: parseGtfsTime(r.arrival_time), departure: parseGtfsTime(r.departure_time) });
    trip.seqs.push(Number(r.stop_sequence));
  }
  const trips: TimetableTrip[] = [];
  for (const { seqs, ...trip } of byId.values()) {
    const order = seqs.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]);
    // Times only some stops have are left out, but a trip needs a time at both ends to be placed.
    const stops = order.map(([, i]) => trip.stops[i]).filter((s) => s.arrival !== undefined || s.departure !== undefined);
    if (stops.length >= 2) trips.push({ ...trip, stops });
  }
  return { trips, services, exceptions };
}

const TIME_ZONE = 'America/New_York';
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** New York's wall clock at a moment, as [year, month (1-12), day, hour, minute, second]. */
function wallClock(unixSeconds: number): number[] {
  const p = Object.fromEntries(parts.formatToParts(new Date(unixSeconds * 1000)).map((x) => [x.type, x.value]));
  return [p.year, p.month, p.day, p.hour, p.minute, p.second].map(Number);
}

/**
 * When a service day's times count from, in Unix seconds: GTFS measures them from noon minus 12 hours,
 * which is midnight except on the days the clocks change.
 */
export function serviceDayStart(year: number, month: number, day: number): number {
  const noonUtc = Date.UTC(year, month - 1, day, 12) / 1000;
  const [y, mo, d, h, mi, s] = wallClock(noonUtc);
  const offset = Date.UTC(y, mo - 1, d, h, mi, s) / 1000 - noonUtc;
  return noonUtc - offset - 12 * 3600;
}

const ymd = (y: number, m: number, d: number) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;

/** Whether a service runs on a date. A schedule whose dates have all run out keeps its weekly pattern. */
function runs(t: Timetable, serviceId: string, date: string, weekday: number, expired: boolean): boolean {
  const exception = t.exceptions.get(`${serviceId}|${date}`);
  if (exception !== undefined) return exception;
  const s = t.services.get(serviceId);
  if (!s || !s.days[weekday]) return false;
  return expired || (date >= s.start && date <= s.end);
}

/** Trips are listed from this long before they leave, so a boat waits at its slip before it sails. */
const LISTED_BEFORE_S = 30 * 60;

/**
 * The trips running around `now` (or about to), as a realtime feed would list them: yesterday's service
 * day too, since its trips can run past midnight.
 */
export function tripsAt(t: Timetable, now: number): TripState[] {
  const [year, month, day] = wallClock(now);
  const out: TripState[] = [];
  for (const back of [1, 0]) {
    const date = new Date(Date.UTC(year, month - 1, day - back));
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    const key = ymd(y, m, d);
    const start = serviceDayStart(y, m, d);
    const weekday = date.getUTCDay();
    // Every dated service has ended (the published file is out of date), so keep to its weekly pattern.
    const expired = t.services.size > 0 && [...t.services.values()].every((s) => s.end && s.end < key);
    const running = new Map<string, boolean>();
    for (const trip of t.trips) {
      let on = running.get(trip.serviceId);
      if (on === undefined) running.set(trip.serviceId, (on = runs(t, trip.serviceId, key, weekday, expired)));
      if (!on) continue;
      const first = trip.stops[0];
      const last = trip.stops[trip.stops.length - 1];
      const leaves = start + (first.departure ?? first.arrival)!;
      const ends = start + (last.arrival ?? last.departure)!;
      if (now < leaves - LISTED_BEFORE_S || now > ends) continue;
      out.push({
        tripId: trip.tripId,
        routeId: trip.routeId,
        stops: trip.stops.map((s) => ({
          stopId: s.stopId,
          arrival: s.arrival === undefined ? undefined : start + s.arrival,
          departure: s.departure === undefined ? undefined : start + s.departure,
        })),
      });
    }
  }
  return out;
}
