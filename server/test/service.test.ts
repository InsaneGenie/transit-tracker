import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FeedConfig } from '../src/feeds.js';
import { decodeFeed, snapshotFromFeed } from '../src/realtime.js';
import { createApiServer } from '../src/server.js';
import { blocksAtWork, gapKind, gapsAlong, lineService, runsOn, serviceDays } from '../src/service.js';
import { buildStaticIndex, timeInLine, type GtfsFiles } from '../src/static-gtfs.js';
import { VehicleStore } from '../src/store.js';
import { encodeFeed, gtfs } from './fixtures.js';

// Tuesday 14 November 2023, 5:13:20 PM in New York.
const T = 1_700_000_000;
const AT = 17 * 3600 + 13 * 60 + 20;

describe('serviceDays', () => {
  it("gives New York's date, weekday and time, and yesterday's for trips past midnight", () => {
    const [today, yesterday] = serviceDays(T);
    expect(today).toEqual({ date: '20231114', weekday: 1, seconds: AT });
    expect(yesterday).toEqual({ date: '20231113', weekday: 0, seconds: AT + 86400 });
  });

  it('keeps yesterday right across a clock change', () => {
    // 12:30 AM on Monday 4 November 2024, the night the clocks went back an hour.
    const [today, yesterday] = serviceDays(Date.UTC(2024, 10, 4, 5, 30) / 1000);
    expect(today).toMatchObject({ date: '20241104', weekday: 0, seconds: 1800 });
    expect(yesterday.date).toBe('20241103');
  });
});

describe('runsOn', () => {
  const weekdays = { days: 0b0011111, start: '20231101', end: '20231130', added: new Set(['20231118']), removed: new Set(['20231123']) };
  const day = (date: string, weekday: number) => ({ date, weekday, seconds: 0 });
  it('follows the calendar and its exceptions', () => {
    expect(runsOn(weekdays, day('20231114', 1))).toBe(true);
    expect(runsOn(weekdays, day('20231119', 6))).toBe(false);
    expect(runsOn(weekdays, day('20231123', 3))).toBe(false); // Thanksgiving taken out
    expect(runsOn(weekdays, day('20231118', 5))).toBe(true); // a Saturday added
    expect(runsOn(weekdays, day('20231201', 4))).toBe(false); // after the schedule ends
    expect(runsOn(undefined, day('20231114', 1))).toBe(false);
  });
});

describe('timeInLine', () => {
  it('reads a time from its column without splitting the line', () => {
    expect(timeInLine('t1,08:05:00,08:06:00,A,1', 2)).toBe(8 * 3600 + 360);
    expect(timeInLine('t1,25:01:30,,A', 1)).toBe(25 * 3600 + 90);
    expect(timeInLine('t1, 8:05:00 ,x', 1)).toBe(8 * 3600 + 300);
    expect(timeInLine('t1,,08:00:00', 1)).toBeUndefined();
    expect(timeInLine('"t,1",08:00:00', 1)).toBe(8 * 3600);
    expect(timeInLine('t1', 3)).toBeUndefined();
  });
});

/**
 * Route M1 runs south from A to C (direction 0, its busier way, so its station list) and back. At 5:13 PM
 * on a Tuesday:
 * - n1 (5:00, block 1) has its bus; n2 (5:03, block 2) has none: a ghost bus.
 * - s0 (4:00, block 3) is still out, late, so s1 (5:05, block 3) isn't missing, just waiting for it.
 * - s2 (5:06, block 4) has no bus, though one is already on block 4's later trip s3: still missing.
 * - n3 (5:10) only just left, so its bus may still be pulling in.
 * - sat1 is a Saturday trip, and late1 (24:30 to 25:30) ran last night.
 */
const schedule: Record<string, string> = {
  ...gtfs,
  'routes.txt': 'route_id,route_short_name\nM1,M1\n',
  'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id
M1,wk,n1,CHARLIE,0,1,s1
M1,wk,n2,CHARLIE,0,2,s1
M1,wk,s0,ALPHA,1,3,s1
M1,wk,s1,ALPHA,1,3,s1
M1,wk,s2,ALPHA,1,4,s1
M1,wk,s3,ALPHA,1,4,s1
M1,wk,n3,CHARLIE,0,5,s1
M1,wk,n4,CHARLIE,0,6,s1
M1,sat,sat1,CHARLIE,0,7,s1
M1,wk,late1,CHARLIE,0,8,s1
`,
  'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence
n1,17:00:00,17:00:00,A,1
n1,17:20:00,17:20:00,B,2
n1,17:40:00,17:40:00,C,3
n2,17:03:00,17:03:00,A,1
n2,17:43:00,17:43:00,C,2
s0,16:00:00,16:00:00,C,1
s0,17:00:00,17:00:00,A,2
s1,17:05:00,17:05:00,C,1
s1,17:45:00,17:45:00,A,2
s2,17:06:00,17:06:00,C,1
s2,17:46:00,17:46:00,A,2
s3,18:00:00,18:00:00,C,1
s3,18:40:00,18:40:00,A,2
n3,17:10:00,17:10:00,A,1
n3,17:50:00,17:50:00,C,2
n4,18:30:00,18:30:00,A,1
n4,19:10:00,19:10:00,C,2
sat1,17:00:00,17:00:00,A,1
sat1,17:40:00,17:40:00,C,2
late1,24:30:00,24:30:00,A,1
late1,25:30:00,25:30:00,C,2`,
  'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
wk,1,1,1,1,1,0,0,20231101,20231130
sat,0,0,0,0,0,1,0,20231101,20231130
`,
};
const filesOf = (gtfsFiles: Record<string, string>): GtfsFiles => (name) => (name in gtfsFiles ? Readable.from([gtfsFiles[name]]) : null);

describe('lineService', () => {
  const at = async (now: number, covered: string[], extra: Record<string, string> = {}) => {
    const index = await buildStaticIndex(filesOf({ ...schedule, ...extra }), 'stops');
    const set = new Set(covered);
    const work = blocksAtWork(index.busSchedules, set, now);
    return { work, service: lineService(index.busSchedules, 'M1', set, work.blocks, now) };
  };

  it('reads when each trip runs from the first and last of its stop times', async () => {
    const index = await buildStaticIndex(filesOf(schedule), 'stops');
    const trips = index.busSchedules[0].routes.get('M1')!;
    const i = trips.tripIds.indexOf('n1');
    expect([trips.start[i], trips.end[i], trips.direction[i]]).toEqual([17 * 3600, 17 * 3600 + 2400, 0]);
    expect(trips.headsigns[trips.headsign[i]]).toBe('CHARLIE');
    // The station list comes from the busier way, south (direction 0).
    expect(trips.listedDirection).toBe(0);
  });

  it('finds scheduled trips with no bus, but not ones whose bus is late on its last trip', async () => {
    const { service, work } = await at(T, ['n1', 's0', 's3']);
    expect(service?.missing.map((m) => m.tripId)).toEqual(['n2', 's2']);
    expect(service?.missing[0]).toEqual({ tripId: 'n2', start: T - AT + 17 * 3600 + 180, end: T - AT + 17 * 3600 + 2580, headsign: 'CHARLIE', heading: 1 });
    // n1, n2, s1, s2 are due out; n3 has only just left.
    expect(service?.scheduled).toBe(4);
    expect([work.scheduled, work.running]).toEqual([4, 2]);
    // Five trips out (n3 counted), 40 minutes each: three south is a bus every 13, two north every 20.
    expect(service?.headways).toEqual({ forward: 13, back: 20 });
    expect(service?.tripMinutes).toBe(40);
  });

  it("counts last night's trips still running after midnight", async () => {
    // 12:45 AM Wednesday.
    const now = T - AT + 86400 + 45 * 60;
    expect((await at(now, [])).service?.missing.map((m) => m.tripId)).toEqual(['late1']);
    expect((await at(now, ['late1'])).service?.missing).toEqual([]);
  });

  it('skips days the service is taken out of the schedule', async () => {
    const { service } = await at(T, [], { 'calendar_dates.txt': 'service_id,date,exception_type\nwk,20231114,2\nsat,20231114,1\n' });
    expect(service?.missing.map((m) => m.tripId)).toEqual(['sat1']);
  });

  it('knows nothing of routes the schedule lacks', async () => {
    const index = await buildStaticIndex(filesOf(schedule), 'stops');
    expect(lineService(index.busSchedules, 'nope', new Set(), [], T)).toBeUndefined();
  });
});

describe('gaps between buses', () => {
  it('marks bunched buses and long gaps against how often they are due', () => {
    expect(gapKind(1, 8)).toBe('bunched');
    expect(gapKind(2, 8)).toBe('bunched');
    expect(gapKind(3, 8)).toBeUndefined();
    expect(gapKind(16, 8)).toBe('long');
    expect(gapKind(9, 4)).toBeUndefined(); // twice the headway, but under 10 minutes
    expect(gapKind(0.5, undefined)).toBe('bunched');
    expect(gapKind(30, undefined)).toBeUndefined();
    expect(gapKind(undefined, 8)).toBeUndefined();
  });

  it('measures each bus to the one ahead, leaving out buses waiting at the ends', () => {
    const gaps = gapsAlong(
      [
        { id: 'c', along: 3000, atEnd: false },
        { id: 'a', along: 400, atEnd: false },
        { id: 'b', along: 500, atEnd: false },
        { id: 'end', along: 9000, atEnd: true },
      ],
      250,
      8,
    );
    expect(gaps.get('a')).toEqual({ aheadId: 'b', meters: 100, minutes: 0.4, kind: 'bunched' });
    expect(gaps.get('b')).toEqual({ aheadId: 'c', meters: 2500, minutes: 10 });
    expect(gaps.has('c')).toBe(false);
    expect(gaps.has('end')).toBe(false);
  });
});

describe('VehicleStore.lineService', () => {
  const busFeed: FeedConfig = {
    id: 'bus',
    agency: 'Test Bus',
    mode: 'bus',
    realtimeUrls: ['https://example.test/vehiclePositions'],
    staticUrls: ['https://example.test/bus.zip'],
    staticDetail: 'stops',
    agencyPrefixedIds: true,
    pollSeconds: 30,
  };
  /** A bus on a trip, with its next stops. */
  const bus = (id: string, tripId: string, lat: number, next: string[]) => [
    { id, vehicle: { vehicle: { id: `MTA NYCT_${id}` }, trip: { tripId, routeId: 'M1' }, position: { latitude: lat, longitude: -73.95 } } },
    {
      id: `${id}-times`,
      tripUpdate: {
        trip: { tripId, routeId: 'M1' },
        vehicle: { id: `MTA NYCT_${id}` },
        stopTimeUpdate: next.map((stopId, i) => ({ stopId, arrival: { time: T + 120 * (i + 1) } })),
      },
    },
  ];
  const storeWith = (entities: ReturnType<typeof bus>[], fetchedAt = T) =>
    new VehicleStore([busFeed], {}, async () => snapshotFromFeed(decodeFeed(encodeFeed(entities.flat())), fetchedAt), () =>
      buildStaticIndex(filesOf(schedule), 'stops'),
    );

  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('serves ghost buses and gaps with the line page vehicles', async () => {
    // One bus heading south, and two heading north bunched between Charlie and Bravo.
    const store = storeWith([bus('1', 'n1', 40.795, ['B', 'C']), bus('2', 's0', 40.785, ['B', 'A']), bus('3', 's3', 40.7845, ['B', 'A'])]);
    await store.loadStatic();
    await store.pollAll();
    const server = createApiServer(store, () => T).listen(0);
    close = () => server.close();
    const body = await (await fetch(`http://localhost:${(server.address() as AddressInfo).port}/api/line-vehicles?line=bus:M1`)).json();
    expect(body.service.missing.map((m: { tripId: string }) => m.tripId)).toEqual(['n2', 's2']);
    const byId = Object.fromEntries(body.vehicles.map((v: { vehicle: { id: string } }) => [v.vehicle.id, v]));
    expect(byId['bus:MTA NYCT_3'].gap).toMatchObject({ aheadId: 'bus:MTA NYCT_2', kind: 'bunched' });
    expect(byId['bus:MTA NYCT_2'].gap).toBeUndefined();
  });

  it('calls no bus missing when too few are reporting to trust the feed', async () => {
    const store = storeWith([bus('1', 'n1', 40.785, ['C'])]);
    await store.loadStatic();
    await store.pollAll();
    // Only n1 of n1, n2, s1, s2 has a bus.
    expect(store.lineService('bus:M1', T)).toBeUndefined();
  });

  it('calls no bus missing from an old feed', async () => {
    const store = storeWith([bus('1', 'n1', 40.785, ['C']), bus('2', 's0', 40.795, ['A'])], T - 600);
    await store.loadStatic();
    await store.pollAll();
    expect(store.lineService('bus:M1', T)).toBeUndefined();
  });
});
