import { describe, expect, it } from 'vitest';
import { estimatePosition } from '../src/estimate.js';
import { nearestOnPath } from '../src/geo.js';
import type { TripState } from '../src/realtime.js';
import { indexPromise } from './fixtures.js';

const T = 1_700_000_000;

const trip = (stops: TripState['stops'], extra: Partial<TripState> = {}): TripState => ({
  tripId: 'x',
  routeId: '1',
  stops,
  ...extra,
});

describe('estimatePosition', () => {
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
