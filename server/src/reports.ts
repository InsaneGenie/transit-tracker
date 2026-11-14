/**
 * Daily report cards for each line, worked out from the live feeds the server already reads.
 *
 * Subway and bus lines are judged by how evenly they come, the way the MTA judges them itself ("wait
 * assessment"): each line has one stop in its middle each way, every train or bus passing it is noted,
 * and each gap between two is compared with the schedule's gap at that time. Rail lines run to a
 * timetable, so theirs says how many trains reached the end of the line on time (within 5:59, the
 * LIRR's and Metro-North's own rule).
 *
 * Only a few numbers are kept per trip, the cards are worked out when someone opens a line, and a day's
 * cards are boiled down to a summary once it is over, so the server stays as light as it was.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Mode } from './feeds.js';
import type { FeedSnapshot, TripState } from './realtime.js';
import {
  addDays,
  lowerBound,
  reportDay,
  reportDayStart,
  scheduledBetween,
  serviceDayStart,
  servicesOn,
  type TimingPoint,
  type TripEnd,
} from './schedule.js';
import type { StaticIndex } from './static-gtfs.js';

/** What a line's card judges it by. */
export type ReportKind = 'gaps' | 'ontime';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** One way along a subway or bus line on one day. */
export interface DirectionReport {
  /** Where the line's usual trip this way ends. */
  toward?: string;
  /** The stop the trips were timed at. */
  at?: string;
  /** Trips seen passing it, and how many the schedule had while the server was watching. */
  trips: number;
  scheduled: number;
  /** Gaps between two trips compared with the schedule, and how many were no longer than they should be. */
  waits: number;
  waitsOnSchedule: number;
  /** The middle gap between trips, the schedule's middle gap, and the longest, in seconds. */
  typicalGap?: number;
  scheduledGap?: number;
  longestGap?: number;
  /** When the longest gap began, in Unix seconds. */
  longestGapAt?: number;
  /** Most trips missed the stop (planned work, usually), so this way doesn't count toward the grade. */
  skipped?: boolean;
}

export interface DayReport {
  /** YYYY-MM-DD. A day runs from 4 AM to 4 AM. */
  date: string;
  /** Still going: the card fills in as the day goes on. */
  today: boolean;
  /** How long the server was watching the line's feed that day, in hours. */
  watchedHours: number;
  /** Out of 100: waits on schedule (subway, bus) or trains on time (rail). Left out when there's too little to go on. */
  score?: number;
  grade?: Grade;
  /** Why there's no grade, when there isn't one. */
  note?: 'too-little-data' | 'skipped-stop';
  /** Subway and bus. */
  directions?: DirectionReport[];
  /** Rail: trains that reached the end of the line while watched, how many on time, how late the late ones were (seconds). */
  trains?: number;
  onTime?: number;
  averageLate?: number;
  worstLate?: number;
}

export interface LineReport {
  key: string;
  kind: ReportKind;
  /** Newest first, today included. */
  days: DayReport[];
}

/** A trip within this many seconds of its scheduled time at the end of the line is on time (5:59). */
export const ON_TIME_S = 359;

/**
 * A wait is on schedule when it's no more than a quarter longer than the schedule's gap at that time, and
 * never short of two minutes over, since a pass is only known to within a poll or so.
 */
export function waitOnSchedule(gap: number, scheduledGap: number): boolean {
  return gap <= Math.max(scheduledGap * 1.25, scheduledGap + 120);
}

/** The schedule's gap at a moment is its average gap within this many seconds either side. */
const SCHEDULE_WINDOW_S = 20 * 60;

/** No scheduled trip for this long, and a gap isn't judged: the line wasn't meant to be running. */
const UNSCHEDULED_S = 2 * 3600;

/** Fewer gaps or trains than these and a card has no grade. */
const MIN_WAITS = 10;
const MIN_TRAINS = 5;

/** Fewer than this share of the scheduled trips seen at the timing stop, and the line likely skipped it. */
const MIN_RUN_SHARE = 0.5;

export function gradeFor(kind: ReportKind, score: number): Grade {
  // Rail riders expect nearly every train on time; the MTA's subway waits are on schedule about three in four times.
  const steps = kind === 'ontime' ? [95, 90, 85, 80] : [85, 75, 65, 55];
  const grades: Grade[] = ['A', 'B', 'C', 'D'];
  const i = steps.findIndex((s) => score >= s);
  return i < 0 ? 'F' : grades[i];
}

/** A trip's pass vanished from the feed this close to when it was due, and it counts as having passed. */
const IMMINENT_S = 60;

/** A pass waiting to happen: when the trip was last said to be due there, and when the feed last listed it. */
interface Pending {
  key: string;
  line: string;
  time: number;
  seen: number;
  trip: TripState;
}

/** A trip still listed this long after it was due at a stop isn't taken to have just passed it. */
const STALE_S = 5 * 60;

/** Polls further apart than this, and the time between them doesn't count as watched. */
const MIN_WATCH_GAP_S = 180;

/** Trips counted already are remembered this long after the feed last listed them, so none counts twice. */
const DONE_KEPT_S = 3 * 3600;

/** Days of finished cards kept. */
const DAYS_KEPT = 7;

/** A finished day is summed up this long after it ends, once trips running late have passed. */
const SUMMARY_DELAY_S = 3600;

/** What one day's raw notes look like on disk and in memory. */
interface DayData {
  /** Per feed, the stretches of time its polls were coming in, as [from, to] Unix seconds. */
  watched: Record<string, [number, number][]>;
  /** Per timing point (`${feed}|${routeId}|${direction}|${stopId}`), when trips passed it. */
  passes: Record<string, number[]>;
  /** Per rail line (`${feed}:${routeId}`), each train's [arrival, seconds late]. */
  arrivals: Record<string, [number, number][]>;
  /** Feeds already summed up for this day. */
  summed?: string[];
}

interface Book {
  version: 1;
  days: Record<string, DayData>;
  summaries: Record<string, Record<string, DayReport>>;
  /** Trips counted already, with when the feed last listed them. */
  done: Record<string, number>;
}

const emptyBook = (): Book => ({ version: 1, days: {}, summaries: {}, done: {} });

const pointKey = (feed: string, p: TimingPoint) => `${feed}|${p.routeId}|${p.direction}|${p.stopId}`;

const dashed = (date: string) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The parts of `spans` inside [from, to). */
function clip(spans: [number, number][] | undefined, from: number, to: number): [number, number][] {
  return (spans ?? []).flatMap(([a, b]): [number, number][] => {
    const s = Math.max(a, from);
    const e = Math.min(b, to);
    return e > s ? [[s, e]] : [];
  });
}

/** Lookups made once per schedule. */
interface IndexLookups {
  /** `${routeId}|${stopId}` to the timing point there. */
  pointAt: Map<string, TimingPoint>;
  /** Each route's timing points. */
  routePoints: Map<string, TimingPoint[]>;
  /** Which services run on a date. */
  services: (date: string) => Set<string>;
}

const lookups = new WeakMap<StaticIndex, IndexLookups>();

function lookupsFor(index: StaticIndex): IndexLookups {
  let found = lookups.get(index);
  if (found) return found;
  const pointAt = new Map<string, TimingPoint>();
  const routePoints = new Map<string, TimingPoint[]>();
  for (const p of index.timingPoints) {
    // A stop that is the timing stop both ways (rare: the middle of a loop) counts for one only.
    if (!pointAt.has(`${p.routeId}|${p.stopId}`)) pointAt.set(`${p.routeId}|${p.stopId}`, p);
    routePoints.set(p.routeId, [...(routePoints.get(p.routeId) ?? []), p]);
  }
  const cache = new Map<string, Set<string>>();
  const services = (date: string) => {
    let s = cache.get(date);
    if (!s) cache.set(date, (s = servicesOn(index.calendar, date)));
    return s;
  };
  lookups.set(index, (found = { pointAt, routePoints, services }));
  return found;
}

export interface ReportOptions {
  /** Where the notes are kept between restarts; none keeps them in memory only. */
  file?: string;
  /** How often they are written, in ms. */
  saveEveryMs?: number;
}

/** The default place for the notes, beside the downloaded schedules. */
export const REPORTS_FILE = path.resolve(import.meta.dirname, '../data/reports.json');

export class ReportBook {
  private book: Book = emptyBook();
  private pending = new Map<string, Pending>();
  /** Today's cards, reused for a minute, by line. */
  private recent = new Map<string, { at: number; report: DayReport | null }>();
  private dirty = false;
  private timer?: NodeJS.Timeout;

  constructor(private options: ReportOptions = {}) {}

  /** Reads the notes left by the last run, if any. */
  async load(): Promise<void> {
    if (!this.options.file) return;
    try {
      const saved = JSON.parse(await readFile(this.options.file, 'utf8')) as Book;
      if (saved?.version === 1 && saved.days && saved.summaries && saved.done) this.book = saved;
    } catch {
      // First run, or a file from an older version: start afresh.
    }
  }

  /** Writes the notes now and then, so a restart keeps the day so far. */
  start(): void {
    if (!this.options.file || this.timer) return;
    this.timer = setInterval(() => void this.save(), this.options.saveEveryMs ?? 5 * 60 * 1000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async save(): Promise<void> {
    if (!this.options.file || !this.dirty) return;
    this.dirty = false;
    const tmp = `${this.options.file}.tmp`;
    try {
      await mkdir(path.dirname(this.options.file), { recursive: true });
      await writeFile(tmp, JSON.stringify(this.book));
      await rename(tmp, this.options.file);
    } catch (err) {
      this.dirty = true;
      console.warn(`report cards: could not save (${(err as Error).message})`);
    }
  }

  private day(date: string): DayData {
    return (this.book.days[date] ??= { watched: {}, passes: {}, arrivals: {} });
  }

  /** Notes that a feed was being watched up to `at`, from its last poll if that was recent enough. */
  private watch(feed: string, at: number, pollSeconds: number): void {
    const gap = Math.max(MIN_WATCH_GAP_S, pollSeconds * 3);
    const date = reportDay(at);
    const spans = (this.day(date).watched[feed] ??= []);
    const last = spans.at(-1);
    if (last && at - last[1] <= gap && at >= last[1]) {
      last[1] = at;
      return;
    }
    // Watching ran on from the day before: that day's watch runs to its end, and this one's from its start.
    const start = reportDayStart(date);
    const before = this.book.days[addDays(date, -1)]?.watched[feed]?.at(-1);
    if (!last && before && at - before[1] <= gap) {
      before[1] = start;
      spans.push([start, at]);
    } else spans.push([at, at]);
  }

  /**
   * Takes in a feed's latest poll. Call it only with polls where every URL answered, so each stretch
   * marked as watched really was.
   */
  observe(feed: string, mode: Mode, pollSeconds: number, snapshot: FeedSnapshot, index: StaticIndex | undefined): void {
    if (!index) return;
    const now = snapshot.fetchedAt;
    this.watch(feed, now, pollSeconds);
    this.dirty = true;
    const kind: ReportKind = mode === 'rail' ? 'ontime' : 'gaps';
    const { pointAt } = lookupsFor(index);
    // A bus trip with no bus on it may never run, so only trips with a bus count.
    const tracked = mode === 'bus' ? new Set(snapshot.gps.flatMap((g) => (g.tripId ? [g.tripId] : []))) : undefined;

    const seen = new Set<string>();
    const note = (key: string, line: string, time: number | undefined, trip: TripState) => {
      if (time === undefined) return;
      seen.add(key);
      if (key in this.book.done) {
        this.book.done[key] = now;
        return;
      }
      const p = { key, line, time, seen: now, trip };
      if (time > now) this.pending.set(key, p);
      // Due a while ago and still listed: either it passed before this server was watching (a restart),
      // or the feed is holding on to a trip gone stale (the subway's sometimes keeps one for hours).
      else if (time < now - STALE_S) this.book.done[key] = now;
      else this.record(feed, kind, index, p, time);
    };

    for (const trip of snapshot.trips) {
      if (!trip.routeId || (tracked && !trip.vehicleId && !tracked.has(trip.tripId))) continue;
      const line = `${feed}:${trip.routeId}`;
      if (kind === 'ontime') {
        const last = trip.stops.at(-1);
        if (last) note(`${feed}|${trip.tripId}|end`, line, last.arrival ?? last.departure, trip);
        continue;
      }
      for (const stop of trip.stops) {
        const point = pointAt.get(`${trip.routeId}|${stop.stopId}`);
        if (point) note(`${feed}|${trip.tripId}|${point.stopId}`, pointKey(feed, point), stop.arrival ?? stop.departure, trip);
      }
    }

    // Gone from the feed: passed, if it was about due; otherwise it was cancelled or turned back early.
    const prefix = `${feed}|`;
    for (const [key, p] of this.pending) {
      if (!key.startsWith(prefix) || seen.has(key)) continue;
      if (p.time <= now + IMMINENT_S) this.record(feed, kind, index, p, Math.min(p.time, now));
      else this.pending.delete(key);
    }
    for (const [key, at] of Object.entries(this.book.done)) {
      if (key.startsWith(prefix) && now - at > DONE_KEPT_S) delete this.book.done[key];
    }
    this.sumUp(feed, kind, index, now);
  }

  private record(feed: string, kind: ReportKind, index: StaticIndex, p: Pending, time: number): void {
    this.pending.delete(p.key);
    this.book.done[p.key] = p.seen;
    const day = this.day(reportDay(time));
    if (kind === 'gaps') {
      (day.passes[p.line] ??= []).push(time);
      return;
    }
    const late = lateness(index, p.trip, time);
    if (late !== undefined) (day.arrivals[p.line] ??= []).push([time, late]);
  }

  /** Sums up days that ended a while ago, keeping their cards and letting go of the notes behind them. */
  private sumUp(feed: string, kind: ReportKind, index: StaticIndex, now: number): void {
    for (const date of Object.keys(this.book.days)) {
      const data = this.book.days[date];
      if (now < reportDayStart(addDays(date, 1)) + SUMMARY_DELAY_S || data.summed?.includes(feed)) continue;
      const cards = (this.book.summaries[date] ??= {});
      for (const line of this.linesOf(feed, kind, index, data)) {
        const report = this.compute(line, kind, index, date, false);
        if (report) cards[line] = report;
      }
      delete data.watched[feed];
      for (const key of Object.keys(data.passes)) if (key.startsWith(`${feed}|`)) delete data.passes[key];
      for (const key of Object.keys(data.arrivals)) if (key.startsWith(`${feed}:`)) delete data.arrivals[key];
      data.summed = [...(data.summed ?? []), feed];
      if (!Object.keys(data.watched).length) delete this.book.days[date];
    }
    const oldest = addDays(reportDay(now), -DAYS_KEPT);
    for (const date of Object.keys(this.book.summaries)) if (date < oldest) delete this.book.summaries[date];
    // Notes of a feed that stopped being polled would otherwise never be let go.
    for (const date of Object.keys(this.book.days)) if (date < oldest) delete this.book.days[date];
  }

  /** The lines of a feed with anything noted on a day. */
  private linesOf(feed: string, kind: ReportKind, index: StaticIndex, data: DayData): string[] {
    if (kind === 'ontime') return Object.keys(data.arrivals).filter((k) => k.startsWith(`${feed}:`));
    if (!data.watched[feed]?.length) return [];
    return [...lookupsFor(index).routePoints.keys()].map((r) => `${feed}:${r}`);
  }

  /** A line's cards, today's first. `index` is its feed's schedule. */
  report(key: string, mode: Mode, index: StaticIndex | undefined, now = Date.now() / 1000): LineReport {
    const kind: ReportKind = mode === 'rail' ? 'ontime' : 'gaps';
    const days: DayReport[] = [];
    const today = reportDay(now);
    for (let i = 0; i <= DAYS_KEPT; i++) {
      const date = addDays(today, -i);
      const summary = this.book.summaries[date]?.[key];
      if (summary) {
        days.push(summary);
        continue;
      }
      if (!index || !this.book.days[date] || this.book.days[date].summed?.includes(key.slice(0, key.indexOf(':')))) continue;
      const live = i === 0 ? this.cachedToday(key, kind, index, date, now) : this.compute(key, kind, index, date, false);
      if (live) days.push(live);
    }
    return { key, kind, days };
  }

  private cachedToday(key: string, kind: ReportKind, index: StaticIndex, date: string, now: number): DayReport | null {
    const hit = this.recent.get(key);
    if (hit && now - hit.at < 60 && hit.report?.date === dashed(date)) return hit.report;
    const report = this.compute(key, kind, index, date, true);
    this.recent.set(key, { at: now, report });
    if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value!);
    return report;
  }

  /** Works out one line's card for one day from that day's notes. */
  private compute(key: string, kind: ReportKind, index: StaticIndex, date: string, today: boolean): DayReport | null {
    const data = this.book.days[date];
    const feed = key.slice(0, key.indexOf(':'));
    const routeId = key.slice(key.indexOf(':') + 1);
    const from = reportDayStart(date);
    const to = reportDayStart(addDays(date, 1));
    const watched = clip(data?.watched[feed], from, to);
    const watchedSeconds = watched.reduce((n, [a, b]) => n + b - a, 0);
    if (!data || watchedSeconds <= 0) return null;
    const base: DayReport = { date: dashed(date), today, watchedHours: Math.round((watchedSeconds / 3600) * 10) / 10 };
    const inWatch = (t: number) => watched.some(([a, b]) => t >= a && t <= b);

    if (kind === 'ontime') {
      const arrivals = (data.arrivals[key] ?? []).filter(([t]) => inWatch(t));
      if (!arrivals.length) return null;
      const late = arrivals.map(([, l]) => l).filter((l) => l > ON_TIME_S);
      const onTime = arrivals.length - late.length;
      const report: DayReport = {
        ...base,
        trains: arrivals.length,
        onTime,
        averageLate: late.length ? Math.round(late.reduce((a, b) => a + b, 0) / late.length) : undefined,
        worstLate: late.length ? Math.max(...late) : undefined,
      };
      return withGrade(report, kind, arrivals.length >= MIN_TRAINS ? (onTime / arrivals.length) * 100 : undefined, 'too-little-data');
    }

    const { routePoints, services } = lookupsFor(index);
    const points = routePoints.get(routeId) ?? [];
    if (!points.length) return null;
    const directions: DirectionReport[] = [];
    for (const point of points) {
      const passes = (data.passes[pointKey(feed, point)] ?? []).filter(inWatch).sort((a, b) => a - b);
      // Reaching back and ahead of the day too, for the schedule's gap at its first and last trips.
      const schedule = scheduledBetween(point, from - UNSCHEDULED_S, to + UNSCHEDULED_S, services);
      const scheduled = watched.reduce((n, [a, b]) => n + lowerBound(schedule, b + 1) - lowerBound(schedule, a), 0);
      const gaps: number[] = [];
      const scheduledGaps: number[] = [];
      let waitsOnSchedule = 0;
      let longest: [number, number] | undefined;
      for (let i = 1; i < passes.length; i++) {
        const [a, b] = [passes[i - 1], passes[i]];
        // A gap with a stretch unwatched inside it can't be told from a missed trip.
        if (!watched.some(([s, e]) => a >= s && b <= e)) continue;
        const sg = scheduledGapAt(schedule, a);
        if (sg === undefined) continue;
        const gap = b - a;
        gaps.push(gap);
        scheduledGaps.push(sg);
        if (waitOnSchedule(gap, sg)) waitsOnSchedule++;
        if (!longest || gap > longest[0]) longest = [gap, a];
      }
      if (!passes.length && !scheduled) continue;
      const stopName = (id?: string) => (id ? index.stops.get(id)?.name : undefined);
      directions.push({
        toward: stopName(point.towardStopId),
        at: stopName(point.stopId),
        trips: passes.length,
        scheduled,
        waits: gaps.length,
        waitsOnSchedule,
        typicalGap: round(median(gaps)),
        scheduledGap: round(median(scheduledGaps)),
        longestGap: longest?.[0],
        longestGapAt: longest?.[1],
        // Most trips missing at the timing stop means the line ran another way (planned work), not that it
        // ran badly; its waits there would say little.
        ...(scheduled >= MIN_WAITS && passes.length < scheduled * MIN_RUN_SHARE && { skipped: true }),
      });
    }
    if (!directions.length) return null;
    const graded = directions.filter((d) => !d.skipped);
    const waits = graded.reduce((n, d) => n + d.waits, 0);
    const ok = graded.reduce((n, d) => n + d.waitsOnSchedule, 0);
    const report: DayReport = { ...base, directions };
    if (!graded.length) return { ...report, note: 'skipped-stop' };
    return withGrade(report, kind, waits >= MIN_WAITS ? (ok / waits) * 100 : undefined, 'too-little-data');
  }
}

const round = (n: number | undefined) => (n === undefined ? undefined : Math.round(n));

function withGrade(report: DayReport, kind: ReportKind, score: number | undefined, otherwise: DayReport['note']): DayReport {
  if (score === undefined) return { ...report, note: otherwise };
  const rounded = Math.round(score);
  return { ...report, score: rounded, grade: gradeFor(kind, rounded) };
}

/**
 * The schedule's gap at a moment: its average gap over the trips due within SCHEDULE_WINDOW_S either side,
 * or else the gap the moment falls in. Undefined when no trip is due for a long while either side.
 */
export function scheduledGapAt(schedule: number[], at: number): number | undefined {
  const lo = lowerBound(schedule, at - SCHEDULE_WINDOW_S);
  const hi = lowerBound(schedule, at + SCHEDULE_WINDOW_S + 1) - 1;
  if (hi - lo >= 2) return (schedule[hi] - schedule[lo]) / (hi - lo);
  const next = lowerBound(schedule, at + 1);
  const before = schedule[next - 1];
  const after = schedule[next];
  if (before === undefined || after === undefined || after - before > UNSCHEDULED_S) return undefined;
  return after - before;
}

/** Trips due at the end of the line more than this far from when one arrived aren't taken to be it. */
const MAX_LATE_S = 3 * 3600;

/**
 * How late a rail trip reached the end of its run, in seconds (negative when early), from its scheduled
 * arrival there. Trips are found by id (the LIRR's match its schedule), or else by line, first stop and
 * start time (Metro-North's). Undefined when the trip isn't in the schedule or ended somewhere else.
 */
export function lateness(index: StaticIndex, trip: TripState, arrivedAt: number): number | undefined {
  const last = trip.stops.at(-1);
  if (!last) return undefined;
  let ends: TripEnd[] = index.tripEnds.get(trip.tripId) ?? [];
  const first = trip.stops[0];
  if (!ends.length && trip.startTime !== undefined && first) ends = index.tripEnds.get(`${trip.routeId}|${first.stopId}|${trip.startTime}`) ?? [];
  const day = reportDay(arrivedAt);
  const dates = trip.startDate ? [trip.startDate] : [addDays(day, -1), day, addDays(day, 1)];
  const { services } = lookupsFor(index);
  let best: number | undefined;
  for (const end of ends) {
    if (end.stopId !== last.stopId || (trip.routeId && end.routeId !== trip.routeId)) continue;
    for (const date of dates) {
      const running = services(date);
      if (!end.serviceIds.some((id) => running.has(id))) continue;
      const late = arrivedAt - (serviceDayStart(date) + end.seconds);
      if (Math.abs(late) <= MAX_LATE_S && (best === undefined || Math.abs(late) < Math.abs(best))) best = late;
    }
  }
  return best === undefined ? undefined : Math.round(best);
}
