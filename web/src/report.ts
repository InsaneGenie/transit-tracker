/**
 * A line's daily report card, as /api/report sends it, and the words for it. The app shows the same card
 * from these same helpers.
 */
import type { Mode } from './api';
import { tidyStopName } from './vehicles';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Subway and bus lines are judged by how evenly they come; rail lines by how many trains were on time. */
export type ReportKind = 'gaps' | 'ontime';

export interface DirectionReport {
  toward?: string;
  at?: string;
  trips: number;
  scheduled: number;
  waits: number;
  waitsOnSchedule: number;
  /** Seconds. */
  typicalGap?: number;
  scheduledGap?: number;
  longestGap?: number;
  /** Unix seconds. */
  longestGapAt?: number;
}

export interface DayReport {
  /** YYYY-MM-DD; a day runs 4 AM to 4 AM. */
  date: string;
  today: boolean;
  watchedHours: number;
  score?: number;
  grade?: Grade;
  note?: 'too-little-data' | 'skipped-stop';
  directions?: DirectionReport[];
  trains?: number;
  onTime?: number;
  /** Seconds. */
  averageLate?: number;
  worstLate?: number;
}

export interface LineReport {
  key: string;
  kind: ReportKind;
  /** Newest first. */
  days: DayReport[];
}

export const GRADE_COLORS: Record<Grade, string> = {
  A: '#16a34a',
  B: '#65a30d',
  C: '#ca8a04',
  D: '#ea580c',
  F: '#dc2626',
};

/** "6 min", "1 hr 5 min", "under a minute". */
export function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
}

/** "Today", or the weekday for an earlier day: "Thu". */
export function dayLabel(day: DayReport): string {
  if (day.today) return 'Today';
  return new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

/** "Thursday, Nov 13", for the heading of an earlier day's card. */
export function dayTitle(day: DayReport): string {
  if (day.today) return 'Today so far';
  return new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The card's one line: its score, or why it has none. */
export function headline(kind: ReportKind, day: DayReport, mode: Mode): string {
  if (day.score !== undefined) return kind === 'ontime' ? `${day.score}% of trains on time` : `${day.score}% of waits on schedule`;
  if (day.note === 'skipped-stop') {
    const at = day.directions?.find((d) => d.at)?.at;
    return `Not graded: most ${mode === 'bus' ? 'buses' : 'trains'} skipped ${at ? tidyStopName(at) : "the stop they're timed at"}`;
  }
  return day.today ? 'Not enough to go on yet today' : 'Not enough to go on that day';
}

export function watchedText(day: DayReport): string {
  const hours = day.watchedHours >= 10 ? Math.round(day.watchedHours) : day.watchedHours;
  return `From ${hours} ${hours === 1 ? 'hour' : 'hours'} of live data${day.today ? ' so far' : ''}`;
}

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** One way along a subway or bus line: a title and its facts, one per line. */
export function directionLines(d: DirectionReport, mode: Mode): { title: string; lines: string[] } {
  const noun = mode === 'bus' ? 'buses' : 'trains';
  const at = d.at ? tidyStopName(d.at) : 'the middle of the line';
  const lines = [d.scheduled ? `${d.trips} of ${d.scheduled} scheduled ${noun} passed ${at}` : `${d.trips} ${noun} passed ${at}`];
  if (d.typicalGap !== undefined) {
    lines.push(`Usual wait ${duration(d.typicalGap)}${d.scheduledGap !== undefined ? ` (scheduled ${duration(d.scheduledGap)})` : ''}`);
  }
  if (d.longestGap !== undefined) lines.push(`Longest wait ${duration(d.longestGap)}${d.longestGapAt ? `, from ${clock(d.longestGapAt)}` : ''}`);
  if (d.waits) lines.push(`${d.waitsOnSchedule} of ${d.waits} waits on schedule`);
  return { title: d.toward ? `Toward ${tidyStopName(d.toward)}` : 'One way', lines };
}

/** A rail line's facts, one per line. */
export function trainLines(day: DayReport): string[] {
  if (!day.trains) return [];
  const lines = [`${day.onTime ?? 0} of ${day.trains} ${day.trains === 1 ? 'train' : 'trains'} on time`];
  if (day.averageLate !== undefined) lines.push(`Late trains were ${duration(day.averageLate)} late on average`);
  if (day.worstLate !== undefined) lines.push(`Latest: ${duration(day.worstLate)} late`);
  return lines;
}

/** How the card is worked out, in a sentence or two. */
export function explainer(kind: ReportKind, mode: Mode): string {
  if (kind === 'ontime') {
    return "A train is on time when it reaches the end of the line within 5 minutes 59 seconds of the timetable, the LIRR's and Metro-North's own rule. Days run 4 AM to 4 AM.";
  }
  const noun = mode === 'bus' ? 'buses' : 'trains';
  return `Counted from the live ${noun} at one stop in the middle of the line each way. A wait is on schedule when it's no more than a quarter longer than the schedule's gap, with at least 2 minutes to spare. Days run 4 AM to 4 AM.`;
}
