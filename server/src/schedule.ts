/**
 * Calendars and timetables kept from the schedules for the line report cards: which services run each day,
 * when each line is due at one stop in its middle, and when rail trips are due at the end of the line.
 */

export const ZONE = 'America/New_York';

/** Which days each service of a schedule runs. Dates are YYYYMMDD, as GTFS writes them. */
export interface ServiceCalendar {
  /** From calendar.txt: the weekdays it runs (bit 0 is Sunday, bit 6 Saturday) between two dates. */
  weekly: Map<string, { days: number; start: string; end: string }>;
  /** From calendar_dates.txt: services added or taken away on a date. */
  added: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
}

export const emptyCalendar = (): ServiceCalendar => ({ weekly: new Map(), added: new Map(), removed: new Map() });

/**
 * One stop in the middle of a line, one way, where its trips are counted for the report card. A stop
 * mid-line is passed by nearly every trip, unlike either end, where short trips start or finish.
 */
export interface TimingPoint {
  routeId: string;
  /** The schedule's direction_id, which may be blank. */
  direction: string;
  stopId: string;
  /** Where the line's usual trip this way ends, as a stop id. */
  towardStopId?: string;
  /** When trips are due here, by service id, as seconds from the start of the service day, sorted. */
  times: Map<string, number[]>;
}

/** When a rail trip is due at the end of its run, on the days of any of `serviceIds`. */
export interface TripEnd {
  routeId: string;
  serviceIds: string[];
  stopId: string;
  /** Seconds from the start of the service day. */
  seconds: number;
}

const weekday = (date: string) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8))).getUTCDay();

export function servicesOn(calendar: ServiceCalendar, date: string): Set<string> {
  const day = 1 << weekday(date);
  const out = new Set<string>();
  for (const [id, s] of calendar.weekly) if (s.days & day && date >= s.start && date <= s.end) out.add(id);
  for (const id of calendar.added.get(date) ?? []) out.add(id);
  for (const id of calendar.removed.get(date) ?? []) out.delete(id);
  return out;
}

/** A date `days` after another. */
export function addDays(date: string, days: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + days));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

const dateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** New York's wall clock at a moment, as if it were UTC, in Unix seconds. */
function wallClock(t: number): number {
  const p = Object.fromEntries(dateParts.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000;
}

/** The date in New York at a moment, as YYYYMMDD. */
export function nyDate(t: number): string {
  const d = new Date(wallClock(t) * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The moment GTFS times on a date count from: noon in New York less twelve hours, which is midnight on
 * every day but the two when the clocks change.
 */
export function serviceDayStart(date: string): number {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), 12) / 1000;
  const noon = guess - (wallClock(guess) - guess);
  return noon - 12 * 3600;
}

/** A report card's day runs from 4 AM to 4 AM, so the last trains of the night count with the evening before. */
export const DAY_STARTS_S = 4 * 3600;

export const reportDayStart = (date: string) => serviceDayStart(date) + DAY_STARTS_S;

/** The report card day a moment belongs to. */
export function reportDay(t: number): string {
  const date = nyDate(t);
  return t < reportDayStart(date) ? addDays(date, -1) : date;
}

/** The first index in a sorted list whose value is at least `value`. */
export function lowerBound(sorted: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Every time a timing point's trips were due from `from` up to `to` (Unix seconds), sorted. `services`
 * says which services run on a date, so callers can keep the answers.
 */
export function scheduledBetween(point: TimingPoint, from: number, to: number, services: (date: string) => Set<string>): number[] {
  const out: number[] = [];
  // Trips listed under a date can run past 24:00 into the next day or two.
  for (let date = addDays(nyDate(from), -2), last = nyDate(to); date <= last; date = addDays(date, 1)) {
    const base = serviceDayStart(date);
    const running = services(date);
    for (const [service, times] of point.times) {
      if (!running.has(service)) continue;
      for (let i = lowerBound(times, from - base); i < times.length && times[i] + base < to; i++) out.push(times[i] + base);
    }
  }
  return out.sort((a, b) => a - b);
}
