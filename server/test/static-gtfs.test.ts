import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildStaticIndex, mergeIndexes, parseGtfsTime } from '../src/static-gtfs.js';
import { files, indexPromise } from './fixtures.js';
import type { GtfsFiles } from '../src/static-gtfs.js';

describe('parseGtfsTime', () => {
  it('handles times past midnight', () => {
    expect(parseGtfsTime('25:01:30')).toBe(25 * 3600 + 90);
    expect(parseGtfsTime('')).toBeUndefined();
  });
});

describe('buildStaticIndex', () => {
  it('reads stops, routes and shapes', async () => {
    const index = await indexPromise;
    expect(index.stops.get('B')).toEqual({ name: 'Bravo', lat: 40.79, lon: -73.95 });
    expect(index.routes.get('1')?.color).toBe('EE352E');
    expect(index.shapes.get('s1')?.points).toHaveLength(5);
    expect(index.routeShapes.get('1')).toEqual(new Set(['s1']));
  });

  it('learns the previous stop and travel time for each stop', async () => {
    const index = await indexPromise;
    expect(index.segments.get('1|B')).toEqual({ fromStopId: 'A', toStopId: 'B', seconds: 120, shapeId: 's1' });
    expect(index.segments.get('*|C')).toMatchObject({ fromStopId: 'B', seconds: 180 });
    expect(index.segments.has('1|A')).toBe(false);
  });
});

describe('stops-only schedules', () => {
  it('skips travel times but keeps stops, shapes and trip shapes', async () => {
    const index = await buildStaticIndex(files, 'stops');
    expect(index.segments.size).toBe(0);
    expect(index.stops.size).toBe(3);
    expect(index.tripShapes.get('t1')).toBe('s1');
  });

  it('merges several schedules into one', async () => {
    const a = await buildStaticIndex(files, 'stops');
    const b = await buildStaticIndex(files, 'stops');
    b.stops = new Map([['Z', { name: 'Zulu', lat: 40, lon: -74 }]]);
    const merged = mergeIndexes([a, b]);
    expect([...merged.stops.keys()]).toEqual(['A', 'B', 'C', 'Z']);
    expect(merged.tripShapes.get('t2')).toBe('s1');
  });

  it('keeps the shapes of a route that runs in several schedules', async () => {
    const a = await buildStaticIndex(files, 'stops');
    const b = await buildStaticIndex(files, 'stops');
    b.routeShapes = new Map([['1', new Set(['s2'])]]);
    expect(mergeIndexes([a, b]).routeShapes.get('1')).toEqual(new Set(['s1', 's2']));
  });
});

describe('transfers', () => {
  // Two stations joined by a passageway: 1 and 2 stop at X, the 7 at Y. The 2 calls at Z only once
  // (overnight), against five times at X, and the 7 never stops at Z.
  const stationFiles: Record<string, string> = {
    'stops.txt': `stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station
X,Times Sq,40.75,-73.98,1,
XN,Times Sq,40.75,-73.98,,X
Y,Times Sq,40.75,-73.98,1,
YN,Times Sq,40.75,-73.98,,Y
Z,Penn,40.75,-73.99,1,
ZN,Penn,40.75,-73.99,,Z
`,
    'trips.txt': `route_id,trip_id,service_id
1,a,wk
2,b,wk
2,c,wk
2,d,wk
2,e,wk
2,g,wk
7,f,wk
`,
    'stop_times.txt': `trip_id,stop_id,arrival_time,departure_time,stop_sequence
a,XN,08:00:00,08:00:00,1
b,XN,08:00:00,08:00:00,1
c,XN,08:00:00,08:00:00,1
d,XN,08:00:00,08:00:00,1
e,XN,08:00:00,08:00:00,1
e,ZN,08:05:00,08:05:00,2
g,XN,08:00:00,08:00:00,1
f,YN,08:00:00,08:00:00,1
`,
    'transfers.txt': `from_stop_id,to_stop_id,transfer_type,min_transfer_time
X,Y,2,180
Y,X,2,180
`,
  };
  const stationGtfs: GtfsFiles = (name) => (name in stationFiles ? Readable.from([stationFiles[name]]) : null);

  it('lists the lines at a platform, including stations joined by a transfer', async () => {
    const index = await buildStaticIndex(stationGtfs);
    expect(index.stopRoutes.get('XN')?.sort()).toEqual(['1', '2', '7']);
    expect(index.stopRoutes.get('Y')?.sort()).toEqual(['1', '2', '7']);
  });

  it('lists the stations each line calls at', async () => {
    const index = await buildStaticIndex(stationGtfs);
    expect(index.routeStations.get('2')).toEqual(['X']);
    expect(index.routeStations.get('7')).toEqual(['Y']);
  });

  it('leaves out lines that only stop now and then', async () => {
    const index = await buildStaticIndex(stationGtfs);
    expect(index.stopRoutes.get('ZN')).toBeUndefined();
  });
});
