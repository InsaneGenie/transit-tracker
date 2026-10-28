import { describe, expect, it } from 'vitest';
import type { Vehicle } from './api';
import {
  colorFor,
  formatEta,
  interpolate,
  textColorFor,
  tidyStopName,
  toFeatureCollection,
} from './vehicles';

const v = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: 'mta-subway:1',
  feed: 'mta-subway',
  agency: 'MTA',
  mode: 'subway',
  lat: 40.7,
  lon: -73.9,
  source: 'estimated',
  ...over,
});

describe('colors', () => {
  it('uses the route color, falling back to one per mode', () => {
    expect(colorFor(v({ routeColor: 'EE352E' }))).toBe('#EE352E');
    expect(colorFor(v({ mode: 'bus' }))).toBe('#2563eb');
  });

  it('picks dark text on light route colors', () => {
    expect(textColorFor('#FCCC0A')).toBe('#111111'); // N/Q/R/W yellow
    expect(textColorFor('#0039A6')).toBe('#ffffff'); // A/C/E blue
  });
});

describe('toFeatureCollection', () => {
  it('turns vehicles into map points with display properties', () => {
    const fc = toFeatureCollection([v({ routeName: 'MTA NYCT_M15', bearing: 90 })]);
    expect(fc.features[0].geometry.coordinates).toEqual([-73.9, 40.7]);
    expect(fc.features[0].properties).toMatchObject({ label: 'M15', bearing: 90, hasBearing: true, estimated: true });
  });
});

describe('interpolate', () => {
  it('moves part of the way to the new position', () => {
    const prev = new Map([['mta-subway:1', v({ lat: 40.7, lon: -73.9 })]]);
    const [mid] = interpolate(prev, [v({ lat: 40.71, lon: -73.91 })], 0.5);
    expect(mid.lat).toBeCloseTo(40.705);
    expect(mid.lon).toBeCloseTo(-73.905);
  });

  it('snaps new vehicles and big jumps', () => {
    const prev = new Map([['mta-subway:1', v({ lat: 40.0 })]]);
    expect(interpolate(prev, [v({ lat: 40.7 })], 0.5)[0].lat).toBe(40.7);
    expect(interpolate(new Map(), [v()], 0.1)[0].lat).toBe(40.7);
  });
});

describe('formatEta', () => {
  it('reads like a departure board', () => {
    expect(formatEta(1000 + 20, 1000)).toBe('Now');
    expect(formatEta(1000 + 5 * 60, 1000)).toBe('5 min');
    expect(formatEta(undefined)).toBe('');
  });
});

describe('tidyStopName', () => {
  it('title-cases all-caps bus stop names and leaves others alone', () => {
    expect(tidyStopName('WILLIS AV/E 138 ST')).toBe('Willis Av/E 138 St');
    expect(tidyStopName('34 ST-HERALD SQ')).toBe('34 St-Herald Sq');
    expect(tidyStopName('Times Sq-42 St')).toBe('Times Sq-42 St');
  });
});
