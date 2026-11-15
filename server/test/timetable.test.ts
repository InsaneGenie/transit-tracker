import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { FeedConfig } from '../src/feeds.js';
import { buildStaticIndex, type GtfsFiles } from '../src/static-gtfs.js';
import { addStraightShapes, VehicleStore } from '../src/store.js';
import { loadTimetable, serviceDayStart, tripsAt } from '../src/timetable.js';

// Like NYC DOT's Staten Island Ferry file: two terminals, no shapes, weekday and weekend services.
const ferryGtfs = (calendar = { start: '20260101', end: '20261231' }): Record<string, string> => ({
  'stops.txt': `stop_id,stop_name,stop_lat,stop_lon
WH,Whitehall Terminal,40.7013,-74.0132
SG,St. George Terminal,40.6437,-74.0736
`,
  'routes.txt': `route_id,agency_id,route_short_name,route_long_name,route_type
SIF,DOT,,Staten Island Ferry,4
`,
  'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
WKD,1,1,1,1,1,0,0,${calendar.start},${calendar.end}
SAT,0,0,0,0,0,1,0,${calendar.start},${calendar.end}
SUN,0,0,0,0,0,0,1,${calendar.start},${calendar.end}
`,
  'calendar_dates.txt': `service_id,date,exception_type
WKD,20261126,2
SUN,20261126,1
`,
  'trips.txt': `route_id,service_id,trip_id,direction_id
SIF,SAT,sat-2230,0
SIF,SAT,sat-2400,0
SIF,SAT,sat-2300-back,1
SIF,WKD,wkd-0800,0
SIF,SUN,sun-0800,0
`,
  'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence
sat-2230,22:30:00,22:30:00,WH,1
sat-2230,22:55:00,22:55:00,SG,2
sat-2400,24:30:00,24:30:00,SG,2
sat-2400,24:00:00,24:00:00,WH,1
sat-2300-back,23:00:00,23:00:00,SG,1
sat-2300-back,23:25:00,23:25:00,WH,2
wkd-0800,08:00:00,08:00:00,WH,1
wkd-0800,08:25:00,08:25:00,SG,2
sun-0800,08:00:00,08:00:00,WH,1
sun-0800,08:25:00,08:25:00,SG,2
`,
});

const filesOf = (gtfs: Record<string, string>): GtfsFiles => (name) => (name in gtfs ? Readable.from([gtfs[name]]) : null);

/** Unix seconds of a New York wall-clock time in November 2026 (Eastern Standard Time, UTC-5). */
const nyNov = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour + 5, minute) / 1000;

describe('timetable', () => {
  it('counts service day times from midnight New York time, including the day the clocks change', () => {
    expect(serviceDayStart(2026, 11, 14)).toBe(Date.UTC(2026, 10, 14, 5) / 1000);
    expect(serviceDayStart(2026, 7, 4)).toBe(Date.UTC(2026, 6, 4, 4) / 1000);
    // Clocks go back at 2 AM on Nov 1: GTFS counts from noon minus 12 hours, which is 1 AM daylight time.
    expect(serviceDayStart(2026, 11, 1)).toBe(Date.UTC(2026, 10, 1, 5) / 1000);
  });

  it("lists the trips running now, and a boat about to leave, from today's service", async () => {
    const t = await loadTimetable(filesOf(ferryGtfs()));
    expect(t.trips).toHaveLength(5);
    // Saturday Nov 14, 10:40 PM: the 10:30 is crossing and the 11:00 back is waiting to leave. The midnight
    // boat is listed from 11:30.
    expect(tripsAt(t, nyNov(14, 22, 40)).map((x) => x.tripId).sort()).toEqual(['sat-2230', 'sat-2300-back']);
    const trips = tripsAt(t, nyNov(14, 23, 40));
    expect(trips.map((x) => x.tripId)).toEqual(['sat-2400']);
    expect(tripsAt(t, nyNov(14, 22, 31)).map((x) => x.tripId)).toContain('sat-2230');
    const crossing = tripsAt(t, nyNov(14, 22, 31)).find((x) => x.tripId === 'sat-2230')!;
    expect(crossing.stops).toEqual([
      { stopId: 'WH', arrival: nyNov(14, 22, 30), departure: nyNov(14, 22, 30) },
      { stopId: 'SG', arrival: nyNov(14, 22, 55), departure: nyNov(14, 22, 55) },
    ]);
    // Stops come in sequence order whatever order the file lists them in.
    expect(trips.find((x) => x.tripId === 'sat-2400')!.stops.map((s) => s.stopId)).toEqual(['WH', 'SG']);
  });

  it("keeps last night's boats running past midnight", async () => {
    const t = await loadTimetable(filesOf(ferryGtfs()));
    // Sunday 12:10 AM is Saturday's 24:10.
    const trips = tripsAt(t, nyNov(15, 0, 10));
    expect(trips.map((x) => x.tripId)).toEqual(['sat-2400']);
    expect(trips[0].stops[0].departure).toBe(nyNov(15, 0, 0));
  });

  it('follows weekdays, weekends and holidays', async () => {
    const t = await loadTimetable(filesOf(ferryGtfs()));
    expect(tripsAt(t, nyNov(16, 8, 10)).map((x) => x.tripId)).toEqual(['wkd-0800']); // Monday
    expect(tripsAt(t, nyNov(15, 8, 10)).map((x) => x.tripId)).toEqual(['sun-0800']); // Sunday
    // Thanksgiving, a Thursday, runs the Sunday timetable.
    expect(tripsAt(t, nyNov(26, 8, 10)).map((x) => x.tripId)).toEqual(['sun-0800']);
  });

  it('keeps to the weekly pattern once every date in the file has run out', async () => {
    const t = await loadTimetable(filesOf(ferryGtfs({ start: '20240101', end: '20250901' })));
    expect(tripsAt(t, nyNov(16, 8, 10)).map((x) => x.tripId)).toEqual(['wkd-0800']);
    // A file still partly in date is taken at its word.
    const current = await loadTimetable(filesOf(ferryGtfs({ start: '20270101', end: '20271231' })));
    expect(tripsAt(current, nyNov(16, 8, 10))).toEqual([]);
  });

  it('places the boats, marked as scheduled, and draws the line though the file has no shapes', async () => {
    const config: FeedConfig = {
      id: 'si-ferry',
      agency: 'Staten Island Ferry',
      mode: 'ferry',
      realtimeUrls: [],
      staticUrls: ['https://example.test/siferry.zip'],
      timetable: true,
      optional: true,
      pollSeconds: 30,
    };
    let now = nyNov(14, 22, 42);
    const store = new VehicleStore(
      [config],
      {},
      async () => {
        throw new Error('a timetable feed fetches nothing');
      },
      async () => {
        const files = filesOf(ferryGtfs());
        const index = await buildStaticIndex(files);
        index.timetable = await loadTimetable(files);
        addStraightShapes(index);
        return index;
      },
      () => now,
    );
    await store.pollAll();
    expect(store.status()[0].lastError).toBe('timetable not loaded yet');
    await store.loadStatic();
    await store.pollAll();
    expect(store.ready()).toBe(true);
    const boats = store.vehicles(now);
    const crossing = boats.find((b) => b.tripId === 'sat-2230')!;
    expect(crossing).toMatchObject({ mode: 'ferry', source: 'estimated', scheduled: true, status: 'IN_TRANSIT_TO', stopId: 'SG' });
    // Halfway across the harbor: 12 of 25 minutes.
    expect(crossing.lat).toBeCloseTo(40.7013 + (40.6437 - 40.7013) * (12 / 25), 2);
    // The 11:00 back hasn't left St. George: not out on the water heading in.
    expect(boats.map((b) => b.tripId)).toEqual(['sat-2230']);
    now = nyNov(14, 22, 57);
    await store.pollAll();
    expect(store.vehicles(now).find((b) => b.tripId === 'sat-2300-back')).toMatchObject({ status: 'STOPPED_AT', stopId: 'SG', lat: 40.6437 });
    now = nyNov(14, 22, 42);
    await store.pollAll();
    expect(store.detail(crossing.id, now)?.upcoming.map((u) => u.name)).toEqual(['St. George Terminal']);
    expect(store.status()[0]).toMatchObject({ timetableTrips: 5, estimatedTrips: 2 });
    const [line] = store.routePaths(['ferry']);
    expect(line.paths[0]).toHaveLength(2);
    expect(store.routeLines(['si-ferry:SIF'])[0]?.stops.map((s) => s.name)).toEqual(['Whitehall Terminal', 'St. George Terminal']);
    // After the last crossing lands, no boat is left out on the water.
    now = nyNov(15, 0, 31);
    await store.pollAll();
    expect(store.vehicles(now)).toEqual([]);
  });
});
