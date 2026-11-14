import { mkdtemp, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { FeedConfig } from '../src/feeds.js';
import type { FeedSnapshot, TripState } from '../src/realtime.js';
import { gradeFor, lateness, ReportBook, scheduledGapAt, waitOnSchedule } from '../src/reports.js';
import { addDays, nyDate, reportDay, reportDayStart, scheduledBetween, serviceDayStart, servicesOn } from '../src/schedule.js';
import { createApiServer } from '../src/server.js';
import { buildStaticIndex, type GtfsFiles, type StaticIndex } from '../src/static-gtfs.js';
import { VehicleStore } from '../src/store.js';

const hms = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Line X runs A -> B -> C every 10 minutes from 6:00 to 22:00 (B two minutes after A), every day. A
 * second trip pattern, short trips A -> B, shows the timing stop is the usual trip's middle.
 */
function lineFiles(): GtfsFiles {
  const trips = ['route_id,trip_id,service_id,direction_id,shape_id'];
  const times = ['trip_id,stop_id,arrival_time,departure_time,stop_sequence'];
  for (let s = 6 * 3600, n = 0; s <= 22 * 3600; s += 600, n++) {
    trips.push(`X,x${n},all,0,sx`);
    times.push(`x${n},A,${hms(s)},${hms(s)},1`, `x${n},B,${hms(s + 120)},${hms(s + 120)},2`, `x${n},C,${hms(s + 300)},${hms(s + 300)},3`);
  }
  const files: Record<string, string> = {
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Alpha,40.80,-73.95\nB,Bravo,40.79,-73.95\nC,Charlie,40.78,-73.95\n',
    'routes.txt': 'route_id,route_short_name\nX,X\n',
    'trips.txt': trips.join('\n') + '\n',
    'shapes.txt': 'shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon\nsx,0,40.80,-73.95\nsx,1,40.78,-73.95\n',
    'stop_times.txt': times.join('\n') + '\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nall,1,1,1,1,1,1,1,20260101,20271231\n',
    // No service on Thanksgiving.
    'calendar_dates.txt': 'service_id,date,exception_type\nall,20261126,2\n',
  };
  return (name) => (name in files ? Readable.from([files[name]]) : null);
}

const DATE = '20261116'; // a Monday
const base = serviceDayStart(DATE);

describe('schedule dates', () => {
  it('finds New York dates and service day starts, clock changes included', () => {
    expect(nyDate(Date.UTC(2026, 10, 16, 4, 59) / 1000)).toBe('20261115'); // 11:59 PM EST
    expect(nyDate(Date.UTC(2026, 10, 16, 5, 0) / 1000)).toBe('20261116');
    expect(base).toBe(Date.UTC(2026, 10, 16, 5) / 1000); // midnight EST
    // On the night the clocks go back, GTFS times count from 1 AM daylight time: noon less 12 hours.
    expect(serviceDayStart('20261101')).toBe(Date.UTC(2026, 10, 1, 5) / 1000);
    expect(addDays('20261231', 1)).toBe('20270101');
  });

  it('runs report days from 4 AM to 4 AM', () => {
    expect(reportDayStart(DATE)).toBe(base + 4 * 3600);
    expect(reportDay(base + 4 * 3600)).toBe(DATE);
    expect(reportDay(base + 4 * 3600 - 1)).toBe('20261115');
    expect(reportDay(base + 27 * 3600)).toBe(DATE); // 3 AM the next morning
  });
});

describe('timing points', () => {
  it("times each way's trips at the middle stop of its usual trip, by service", async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    expect(index.timingPoints).toHaveLength(1);
    const point = index.timingPoints[0];
    expect(point).toMatchObject({ routeId: 'X', direction: '0', stopId: 'B', towardStopId: 'C' });
    expect(point.times.get('all')).toHaveLength(97);
    expect(point.times.get('all')![0]).toBe(6 * 3600 + 120);
  });

  it('works the same from a stops-only schedule', async () => {
    const index = await buildStaticIndex(lineFiles(), 'stops', 'gaps');
    expect(index.timingPoints[0]).toMatchObject({ stopId: 'B', towardStopId: 'C' });
    expect(index.timingPoints[0].times.get('all')).toHaveLength(97);
  });

  it('reads the calendar, exceptions included', async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    expect(servicesOn(index.calendar, DATE)).toEqual(new Set(['all']));
    expect(servicesOn(index.calendar, '20261126')).toEqual(new Set());
    expect(servicesOn(index.calendar, '20251231')).toEqual(new Set());
  });

  it('lists scheduled times across midnight', async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    const services = (d: string) => servicesOn(index.calendar, d);
    const times = scheduledBetween(index.timingPoints[0], base + 21.8 * 3600, base + 30 * 3600, services);
    expect(times).toEqual([base + 22 * 3600 + 120 - 600, base + 22 * 3600 + 120]);
    // Thanksgiving has none, and the day after starts at 6 AM.
    const next = scheduledBetween(index.timingPoints[0], serviceDayStart('20261126'), serviceDayStart('20261127') + 7 * 3600, services);
    expect(next[0]).toBe(serviceDayStart('20261127') + 6 * 3600 + 120);
  });
});

describe('waits', () => {
  it('allows a quarter over the scheduled gap, and never less than two minutes', () => {
    expect(waitOnSchedule(600 * 1.25, 600)).toBe(true);
    expect(waitOnSchedule(600 * 1.25 + 1, 600)).toBe(false);
    expect(waitOnSchedule(240 + 120, 240)).toBe(true);
    expect(waitOnSchedule(240 + 121, 240)).toBe(false);
  });

  it("takes the schedule's average gap around a moment", () => {
    const s = [0, 240, 720, 960, 1440, 1680].map((x) => x + 10_000); // 4 and 8 minutes, alternating
    expect(scheduledGapAt(s, 10_800)).toBe(336);
    expect(scheduledGapAt([0, 3 * 3600], 100)).toBeUndefined();
    expect(scheduledGapAt([0, 1800], 100)).toBe(1800);
  });

  it('grades on a stricter scale for rail', () => {
    expect(gradeFor('gaps', 85)).toBe('A');
    expect(gradeFor('gaps', 70)).toBe('C');
    expect(gradeFor('gaps', 54)).toBe('F');
    expect(gradeFor('ontime', 92)).toBe('B');
    expect(gradeFor('ontime', 79)).toBe('F');
  });
});

/** A subway feed listing each trip of line X with its next stops; a train drops a stop once it leaves it. */
function snapshot(at: number, trips: { id: string; atB: number }[]): FeedSnapshot {
  return {
    fetchedAt: at,
    gps: [],
    trips: trips
      .filter((t) => at < t.atB + 30)
      .map((t): TripState => ({ tripId: t.id, routeId: 'X', stops: [{ stopId: 'B', arrival: t.atB }, { stopId: 'C', arrival: t.atB + 180 }] })),
  };
}

/** Polls every 20 seconds from `from` to `to`, skipping polls in `gaps`. */
function run(book: ReportBook, index: StaticIndex, from: number, to: number, trips: { id: string; atB: number }[], gaps: [number, number][] = []) {
  for (let at = from; at <= to; at += 20) {
    if (gaps.some(([a, b]) => at >= a && at < b)) continue;
    book.observe('sub', 'subway', 20, snapshot(at, trips), index);
  }
}

describe('ReportBook', () => {
  const morning = base + 8 * 3600; // 8 AM

  it('notes each train passing the timing stop once, and judges each wait', async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    const book = new ReportBook();
    // Twelve trains every 10 minutes, then one 15 minutes late (a 25-minute gap), then on again.
    const trips = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, atB: morning + 120 + i * 600 }));
    trips.push({ id: 'late', atB: morning + 120 + 11 * 600 + 1500 }, { id: 'next', atB: morning + 120 + 11 * 600 + 1800 });
    run(book, index, morning, morning + 3 * 3600, trips);

    const report = book.report('sub:X', 'subway', index, morning + 3 * 3600);
    expect(report.kind).toBe('gaps');
    const day = report.days[0];
    expect(day).toMatchObject({ date: '2026-11-16', today: true, watchedHours: 3 });
    expect(day.directions).toHaveLength(1);
    const d = day.directions![0];
    expect(d).toMatchObject({ toward: 'Charlie', at: 'Bravo', trips: 14, waits: 13, waitsOnSchedule: 12, longestGap: 1500 });
    // 18 trains were due at B from 8:00 to 11:00.
    expect(d.scheduled).toBe(18);
    expect(d.typicalGap).toBe(600);
    expect(d.scheduledGap).toBe(600);
    // Only the 25-minute wait was too long; the 5-minute one after it was fine.
    expect(day.score).toBe(92);
    expect(day.grade).toBe('A');
  });

  it("doesn't judge a gap that has an unwatched stretch inside it", async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    const book = new ReportBook();
    const trips = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, atB: morning + 120 + i * 600 }));
    // The feed was down from 8:30 to 8:50, so neither the gap across it nor its scheduled trips count.
    run(book, index, morning, morning + 2 * 3600, trips, [[morning + 1800, morning + 3000]]);
    const d = book.report('sub:X', 'subway', index, morning + 2 * 3600).days[0].directions![0];
    expect(d.waits).toBe(d.trips - 2);
    expect(d.waitsOnSchedule).toBe(d.waits);
    expect(d.scheduled).toBe(10);
  });

  it("doesn't count a train that vanished long before it was due, nor a bus with no bus on it", async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    const book = new ReportBook();
    const now = morning;
    book.observe('sub', 'subway', 20, snapshot(now, [{ id: 'gone', atB: now + 600 }]), index);
    const ghost = (at: number): FeedSnapshot => ({ fetchedAt: at, gps: [], trips: [{ tripId: 'ghost', routeId: 'X', stops: [{ stopId: 'B', arrival: now + 60 }] }] });
    for (let at = now + 20; at <= now + 1200; at += 20) {
      book.observe('sub', 'subway', 20, snapshot(at, []), index);
      book.observe('bus', 'bus', 30, ghost(at), index);
    }
    expect(book.report('sub:X', 'subway', index, now + 1200).days[0].directions![0]).toMatchObject({ trips: 0, scheduled: 2 });
    expect(book.report('bus:X', 'bus', index, now + 1200).days[0].directions![0]).toMatchObject({ trips: 0, scheduled: 2 });
    // With its bus reporting in, the same trip counts.
    const bus = new ReportBook();
    for (let at = now; at <= now + 1200; at += 20) {
      const snap = ghost(at);
      bus.observe('bus', 'bus', 30, at < now + 60 ? { ...snap, gps: [{ vehicleId: '1', tripId: 'ghost', lat: 40.79, lon: -73.95 }] } : { ...snap, trips: [] }, index);
    }
    expect(bus.report('bus:X', 'bus', index, now + 1200).days[0].directions![0].trips).toBe(1);
  });

  it('says a line that mostly skipped its timing stop is not graded', async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    const book = new ReportBook();
    run(book, index, morning, morning + 3 * 3600, [{ id: 'only', atB: morning + 600 }]);
    const day = book.report('sub:X', 'subway', index, morning + 3 * 3600).days[0];
    expect(day.note).toBe('skipped-stop');
    expect(day.grade).toBeUndefined();
  });

  it('sums up a finished day, lets go of its notes, and keeps the card', async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    const book = new ReportBook();
    const trips = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, atB: morning + 120 + i * 600 }));
    run(book, index, morning, morning + 2 * 3600, trips);
    const before = book.report('sub:X', 'subway', index, morning + 2 * 3600).days[0];

    // The next day, past 5 AM.
    const later = reportDayStart(addDays(DATE, 1)) + 2 * 3600;
    book.observe('sub', 'subway', 20, snapshot(later, []), index);
    const report = book.report('sub:X', 'subway', index, later + 20);
    // Nothing to show yet for the new day, which has only just been watched.
    expect(report.days.map((d) => d.date)).toEqual(['2026-11-16']);
    expect(report.days[0]).toEqual({ ...before, today: false });
    // A while later, still the same card, from the summary.
    book.observe('sub', 'subway', 20, snapshot(later + 3600, []), index);
    expect(book.report('sub:X', 'subway', index, later + 3600).days.at(-1)).toEqual({ ...before, today: false });
  });

  it('keeps the day so far through a restart', async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'reports-')), 'reports.json');
    const book = new ReportBook({ file });
    const trips = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, atB: morning + 120 + i * 600 }));
    run(book, index, morning, morning + 3600, trips);
    await book.save();
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);

    const again = new ReportBook({ file });
    await again.load();
    // The same trains, still listed after the restart, aren't counted twice.
    run(again, index, morning + 3600, morning + 3700, trips);
    expect(again.report('sub:X', 'subway', index, morning + 3700).days[0].directions![0].trips).toBe(6);
  });
});

describe('rail on time', () => {
  /** Two LIRR-style trips, ids matching the schedule, and one Metro-North style, found by its start. */
  const railFiles: GtfsFiles = (name) => {
    const files: Record<string, string> = {
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nP,Penn,40.75,-73.99\nJ,Jamaica,40.70,-73.81\nH,Huntington,40.85,-73.40\n',
      'routes.txt': 'route_id,route_short_name\n1,Port Washington\n',
      'trips.txt': 'route_id,service_id,trip_id,direction_id\n1,wk,r1,0\n1,sa,r2,0\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nr1,08:00:00,08:00:00,P,1\nr1,08:20:00,08:20:00,J,2\nr1,09:00:00,09:00:00,H,3\nr2,08:00:00,08:00:00,P,1\nr2,09:10:00,09:10:00,H,2\n',
      'calendar_dates.txt': `service_id,date,exception_type\nwk,${DATE},1\nsa,20261121,1\n`,
    };
    return name in files ? Readable.from([files[name]]) : null;
  };
  const trip = (tripId: string, extra: Partial<TripState> = {}): TripState => ({
    tripId,
    routeId: '1',
    stops: [{ stopId: 'P', departure: base + 8 * 3600 }, { stopId: 'H', arrival: base + 9 * 3600 + 400 }],
    ...extra,
  });

  it('finds how late a train reached the end of the line, by id or by its start', async () => {
    const index = await buildStaticIndex(railFiles, 'full', 'ontime-by-id');
    expect(lateness(index, trip('r1'), base + 9 * 3600 + 400)).toBe(400);
    const byStart = await buildStaticIndex(railFiles, 'full', 'ontime');
    expect(byStart.tripEnds.has('r1')).toBe(false);
    expect(lateness(byStart, trip('3264716', { startTime: 8 * 3600 }), base + 9 * 3600 + 400)).toBe(400);
    // Its start date picks the service: on the Saturday the 8:00 is r2, due at 9:10.
    const saturday = serviceDayStart('20261121');
    expect(lateness(byStart, trip('x', { startTime: 8 * 3600, startDate: '20261121' }), saturday + 9 * 3600 + 400)).toBe(-200);
    // Ending somewhere else (turned back early), it isn't judged.
    expect(lateness(index, { ...trip('r1'), stops: [{ stopId: 'J', arrival: base + 8 * 3600 + 1200 }] }, base + 8 * 3600 + 1200)).toBeUndefined();
  });

  it('counts trains on time within 5:59', async () => {
    const index = await buildStaticIndex(railFiles, 'full', 'ontime-by-id');
    const book = new ReportBook();
    const due = base + 9 * 3600;
    for (let at = due - 600; at <= due + 900; at += 30) {
      const trips = at < due + 400 + 60 ? [trip('r1')] : [];
      book.observe('rail', 'rail', 30, { fetchedAt: at, gps: [], trips }, index);
    }
    const day = book.report('rail:1', 'rail', index, due + 900).days[0];
    expect(day).toMatchObject({ trains: 1, onTime: 0, worstLate: 400, averageLate: 400, note: 'too-little-data' });
  });
});

describe('GET /api/report', () => {
  const line: FeedConfig = { id: 'sub', agency: 'Test', mode: 'subway', realtimeUrls: ['https://example.test/x'], staticUrls: ['x.zip'], pollSeconds: 20 };

  it('sends a line its cards, and says which lines have none', async () => {
    const index = await buildStaticIndex(lineFiles(), 'full', 'gaps');
    const morning = base + 8 * 3600;
    let at = morning;
    const store = new VehicleStore([line], {}, async () => snapshot(at, [{ id: 'a', atB: morning + 60 }]), async () => index);
    store.reports = new ReportBook();
    await store.loadStatic();
    for (; at < morning + 600; at += 20) await store.pollAll();
    const server = createApiServer(store, () => morning + 600).listen(0);
    try {
      const url = `http://localhost:${(server.address() as AddressInfo).port}/api/report`;
      const res = await fetch(`${url}?line=sub:X`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=60');
      const body = await res.json();
      expect(body).toMatchObject({ key: 'sub:X', kind: 'gaps' });
      expect(body.days[0].directions[0]).toMatchObject({ trips: 1, at: 'Bravo' });
      expect((await fetch(`${url}?line=sub:NOPE`)).status).toBe(404);
      expect((await fetch(url)).status).toBe(400);
    } finally {
      server.close();
    }
  });
});
