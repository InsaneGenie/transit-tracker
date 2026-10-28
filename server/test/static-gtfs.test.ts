import { describe, expect, it } from 'vitest';
import { buildStaticIndex, mergeIndexes, parseGtfsTime } from '../src/static-gtfs.js';
import { files, indexPromise } from './fixtures.js';

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
});
