import { describe, expect, it } from 'vitest';
import { parseGtfsTime } from '../src/static-gtfs.js';
import { indexPromise } from './fixtures.js';

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
  });

  it('learns the previous stop and travel time for each stop', async () => {
    const index = await indexPromise;
    expect(index.segments.get('1|B')).toEqual({ fromStopId: 'A', toStopId: 'B', seconds: 120, shapeId: 's1' });
    expect(index.segments.get('*|C')).toMatchObject({ fromStopId: 'B', seconds: 180 });
    expect(index.segments.has('1|A')).toBe(false);
  });
});
