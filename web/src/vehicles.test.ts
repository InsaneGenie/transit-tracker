import { describe, expect, it } from 'vitest';
import type { RouteInfo, Vehicle } from './api';
import {
  colorFor,
  formatEta,
  interpolate,
  legendGroups,
  transferLines,
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
    expect(fc.features[0].properties).toMatchObject({ routeKey: 'mta-subway:', label: 'M15', bearing: 90, hasBearing: true, estimated: true });
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

describe('legendGroups', () => {
  const r = (over: Partial<RouteInfo>): RouteInfo => ({
    key: `f:${over.id}`,
    feed: 'f',
    agency: 'MTA New York City Transit',
    mode: 'subway',
    id: '?',
    name: over.id ?? '?',
    ...over,
  });

  it('groups subway lines that share a color, in natural order', () => {
    const groups = legendGroups(
      [r({ id: '3', color: 'EE352E' }), r({ id: 'A', color: '0039A6' }), r({ id: '1', color: 'ee352e' }), r({ id: '2', color: 'EE352E' })],
      'subway',
    );
    expect(groups.map((g) => [g.color, g.routes.map((x) => x.name)])).toEqual([
      ['#EE352E', ['1', '2', '3']],
      ['#0039A6', ['A']],
    ]);
  });

  it('groups rail lines by railroad and lists buses in number order', () => {
    const rail = legendGroups(
      [
        r({ id: 'b', mode: 'rail', agency: 'Metro-North Railroad', name: 'Hudson' }),
        r({ id: 'a', mode: 'rail', agency: 'Long Island Rail Road', name: 'Babylon Branch' }),
      ],
      'rail',
    );
    expect(rail.map((g) => g.title)).toEqual(['Long Island Rail Road', 'Metro-North Railroad']);
    const bus = legendGroups([r({ id: 'M15', mode: 'bus' }), r({ id: 'M2', mode: 'bus' })], 'bus');
    expect(bus[0].routes.map((x) => x.name)).toEqual(['M2', 'M15']);
  });

  it('groups buses by borough, with express buses on their own', () => {
    const names = ['QM2', 'Q58', 'Bx12', 'B44-SBS', 'BxM1', 'SIM1', 'S40', 'M15', 'X27', 'BEDLOOP', 'BX92'];
    const groups = legendGroups(names.map((id) => r({ id, mode: 'bus' })), 'bus');
    expect(groups.map((g) => [g.title, g.routes.map((x) => x.name)])).toEqual([
      ['Bronx', ['Bx12', 'BX92']],
      ['Brooklyn', ['B44-SBS']],
      ['Manhattan', ['M15']],
      ['Queens', ['Q58']],
      ['Staten Island', ['S40']],
      ['Express', ['BxM1', 'QM2', 'SIM1', 'X27']],
      ['Shuttles and other', ['BEDLOOP']],
    ]);
  });
});

describe('transferLines', () => {
  const route = (name: string, mode: RouteInfo['mode'] = 'subway'): RouteInfo => ({
    key: `f:${name}`,
    feed: 'f',
    agency: 'MTA',
    mode,
    id: name,
    name,
  });

  it('sorts the lines and drops express variants of lines already listed', () => {
    const routes = new Map(['7', '7X', 'N', '1', 'FX'].map((n) => [`f:${n}`, route(n)]));
    expect(transferLines(['f:N', 'f:7X', 'f:7', 'f:1', 'f:FX', 'f:missing'], routes).map((r) => r.name)).toEqual([
      '1',
      '7',
      'FX',
      'N',
    ]);
    expect(transferLines(undefined, routes)).toEqual([]);
  });
});
