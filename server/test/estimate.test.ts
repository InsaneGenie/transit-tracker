import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { estimatePosition, projectFix } from '../src/estimate.js';
import { nearestOnPath, Polyline } from '../src/geo.js';
import type { TripState } from '../src/realtime.js';
import { buildStaticIndex } from '../src/static-gtfs.js';
import { files, gtfs, indexPromise } from './fixtures.js';

const T = 1_700_000_000;

const trip = (stops: TripState['stops'], extra: Partial<TripState> = {}): TripState => ({
  tripId: 'x',
  routeId: '1',
  stops,
  ...extra,
});

describe('estimatePosition', () => {
  it('keeps a train in the station while the feed says it is standing there, though its departure time has passed', async () => {
    const index = await indexPromise;
    const stops = [
      { stopId: 'B', arrival: T - 60, departure: T - 30 },
      { stopId: 'C', arrival: T + 120 },
    ];
    const standing = trip(stops, { status: 'STOPPED_AT', statusStopId: 'B', statusAge: 5 });
    expect(estimatePosition(standing, T, index)).toMatchObject({ stopId: 'B', status: 'STOPPED_AT', lat: 40.79 });
    // Not confirmed for a minute: it has left.
    const left = trip(stops, { status: 'STOPPED_AT', statusStopId: 'B', statusAge: 60 });
    expect(estimatePosition(left, T, index)).toMatchObject({ stopId: 'C', status: 'IN_TRANSIT_TO' });
  });

  it('moves along the shape, not in a straight line', async () => {
    const index = await indexPromise;
    // Left A at T, due at B at T+120. Halfway along the dog-leg is its far corner.
    const pos = estimatePosition(trip([{ stopId: 'B', arrival: T + 60 }]), T, index);
    expect(pos?.status).toBe('IN_TRANSIT_TO');
    expect(pos?.stopId).toBe('B');
    expect(pos!.lon).toBeGreaterThan(-73.95); // east of the straight line between A and B
  });

  it('uses the previous stop time from the feed when it is still listed', async () => {
    const index = await indexPromise;
    const pos = estimatePosition(
      trip([
        { stopId: 'B', arrival: T - 100, departure: T - 90 },
        { stopId: 'C', arrival: T + 90 },
      ]),
      T,
      index,
    );
    // Halfway between B and C on the straight final leg.
    expect(pos?.lat).toBeCloseTo(40.785, 3);
    expect(pos?.lon).toBeCloseTo(-73.95, 5);
    expect(pos?.bearing).toBeCloseTo(180, 0);
  });

  it('follows the track when the usual way into the next stop is from the other direction', async () => {
    // Three trips run C -> B -> A to the two running A -> B, so the usual hop into B is from C.
    const index = await buildStaticIndex((name) => {
      const extra: Record<string, string> = {
        'trips.txt': `1,r1,wk,s2\n1,r2,wk,s2\n1,r3,wk,s2\n`,
        'shapes.txt': `s2,0,40.78,-73.95\ns2,1,40.79,-73.95\ns2,2,40.79,-73.94\ns2,3,40.80,-73.94\ns2,4,40.80,-73.95\n`,
        'stop_times.txt':
          `r1,C,09:00:00,09:00:00,1\nr1,B,09:03:00,09:03:00,2\nr1,A,09:05:00,09:05:00,3\n` +
          `r2,C,10:00:00,10:00:00,1\nr2,B,10:03:00,10:03:00,2\nr2,A,10:05:00,10:05:00,3\n` +
          `r3,C,11:00:00,11:00:00,1\nr3,B,11:03:00,11:03:00,2\nr3,A,11:05:00,11:05:00,3\n`,
      };
      return name in extra ? Readable.from([gtfs[name] + extra[name]]) : files(name);
    });
    expect(index.segments.get('1|B')?.fromStopId).toBe('C');
    const pos = estimatePosition(
      trip([
        { stopId: 'A', departure: T - 60 },
        { stopId: 'B', arrival: T + 60 },
      ]),
      T,
      index,
    );
    expect(pos!.lon).toBeGreaterThan(-73.95); // on the dog-leg, not cutting straight from A to B
  });

  it('keeps a train at its first stop until it leaves, instead of out on the line heading in', async () => {
    const index = await indexPromise;
    // The usual way into B is from A, but a trip that starts at B lists B with only a departure time.
    const starts = trip([{ stopId: 'B', departure: T + 60 }, { stopId: 'C', arrival: T + 200 }]);
    expect(estimatePosition(starts, T, index)).toMatchObject({ stopId: 'B', status: 'STOPPED_AT', lat: 40.79 });
    expect(estimatePosition(starts, T - 3600, index)).toBeNull();
    // A feed that keeps passed stops lists a running train's earlier stops, so a first stop ahead is its start.
    const kept = trip([{ stopId: 'B', arrival: T + 60, departure: T + 60 }]);
    expect(estimatePosition(kept, T, index, true)).toMatchObject({ stopId: 'B', status: 'STOPPED_AT' });
    expect(estimatePosition(kept, T, index)?.status).toBe('IN_TRANSIT_TO');
  });

  it("follows another line's track when a train is rerouted onto it", async () => {
    // Route 2 runs D -> C, D being off route 1, along a shape that dog-legs east. Nothing is scheduled
    // into D, so only the track itself says how a train rerouted from C to D gets there.
    const index = await buildStaticIndex((name) => {
      const extra: Record<string, string> = {
        'stops.txt': `D,Delta,40.77,-73.95\n`,
        'routes.txt': `2,2,Test Other,00933C\n`,
        'trips.txt': `2,o1,wk,s3\n`,
        'shapes.txt': `s3,0,40.77,-73.95\ns3,1,40.77,-73.94\ns3,2,40.78,-73.94\ns3,3,40.78,-73.95\n`,
        'stop_times.txt': `o1,D,09:00:00,09:00:00,1\no1,C,09:03:00,09:03:00,2\n`,
      };
      return name in extra ? Readable.from([gtfs[name] + extra[name]]) : files(name);
    });
    const pos = estimatePosition(
      trip([
        { stopId: 'C', departure: T - 60 },
        { stopId: 'D', arrival: T + 60 },
      ]),
      T,
      index,
    );
    expect(pos!.lon).toBeGreaterThan(-73.95); // on route 2's dog-leg, not straight down from C
  });

  it('holds a train at a stop while it dwells', async () => {
    const index = await indexPromise;
    const pos = estimatePosition(trip([{ stopId: 'B', arrival: T - 10, departure: T + 20 }]), T, index);
    expect(pos).toMatchObject({ stopId: 'B', status: 'STOPPED_AT', lat: 40.79 });
  });

  it('trusts the feed when it says the train is stopped', async () => {
    const index = await indexPromise;
    const pos = estimatePosition(
      trip([{ stopId: 'C', arrival: T + 30 }], { status: 'STOPPED_AT', statusStopId: 'C' }),
      T,
      index,
    );
    expect(pos).toMatchObject({ stopId: 'C', status: 'STOPPED_AT' });
  });

  it('skips trips that have finished or have not started', async () => {
    const index = await indexPromise;
    expect(estimatePosition(trip([{ stopId: 'C', arrival: T - 5 }]), T, index)).toBeNull();
    expect(estimatePosition(trip([{ stopId: 'A', departure: T + 3600 }]), T, index)).toBeNull();
  });

  it('shows a train waiting at its first stop just before it leaves', async () => {
    const index = await indexPromise;
    expect(estimatePosition(trip([{ stopId: 'A', departure: T + 60 }]), T, index)).toMatchObject({
      stopId: 'A',
      status: 'STOPPED_AT',
    });
  });
});

describe('nearestOnPath', () => {
  it('finds the closest point between two corners of the path', () => {
    // A curbside stop 15 m east of a street running north.
    const path: [number, number][] = [
      [-73.98, 40.75],
      [-73.98, 40.76],
    ];
    const at = nearestOnPath({ lat: 40.755, lon: -73.98 + 15 / 84_300 }, path);
    expect(at.meters).toBeCloseTo(15, 0);
    expect(at.lat).toBeCloseTo(40.755, 6);
    expect(at.lon).toBeCloseTo(-73.98, 6);
  });
});

describe('projectFix', () => {
  // Reported at T between B and C, 0.005° (about 560 m) short of C.
  const fix = { lat: 40.785, lon: -73.95 };
  const C = { lat: 40.78, lon: -73.95 };
  const track = () => new Polyline([fix, C]);

  it('moves a reported position on toward the next stop, to be there when it is due', async () => {
    const index = await indexPromise;
    const due = trip([{ stopId: 'C', arrival: T + 60, departure: T + 80 }]);
    expect(projectFix(fix, T, due, T + 30, index, track)).toMatchObject({ lat: expect.closeTo(40.7825, 4), stopId: 'C', status: 'IN_TRANSIT_TO' });
    expect(projectFix(fix, T, due, T + 70, index, track)).toMatchObject({ lat: 40.78, status: 'STOPPED_AT' });
    // A newer position nearer the stop counts as further along.
    const nearer = projectFix({ lat: 40.782, lon: -73.95 }, T + 10, due, T + 10.1, index, () => new Polyline([{ lat: 40.782, lon: -73.95 }, C]))!;
    expect(nearer.along).toBeGreaterThan(projectFix(fix, T, due, T + 10, index, track)!.along);
  });

  it('goes no further than it is allowed to', async () => {
    const index = await indexPromise;
    const pos = projectFix(fix, T, trip([{ stopId: 'C', arrival: T + 60 }]), T + 30, index, track, 111);
    expect(pos!.lat).toBeCloseTo(40.784, 4);
  });

  it('leaves a late vehicle where it reported, and one at its stop there until it leaves', async () => {
    const index = await indexPromise;
    const late = trip([{ stopId: 'C', arrival: T - 10, departure: T + 20 }]);
    expect(projectFix(fix, T, late, T + 30, index, track)).toBeNull();
    const near = { lat: 40.7805, lon: -73.95 };
    expect(projectFix(near, T, late, T + 10, index, track)).toMatchObject({ lat: 40.7805, status: 'STOPPED_AT', stopId: 'C' });
  });
});
