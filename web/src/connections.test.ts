import { describe, expect, it } from 'vitest';
import type { ConnectionDirection, RouteInfo, StopConnections } from './api';
import { connectionHeading, connectionLines, connectionSummary, describeConnection } from './connections';

const T = 1_700_000_000;
const way = (over: Partial<ConnectionDirection> = {}): ConnectionDirection => ({ destinations: ['Pelham Bay Park'], changeSeconds: 120, ...over });
const route = (key: string, name: string): RouteInfo => ({ key, feed: key.split(':')[0], agency: 'MTA', mode: 'subway', id: name, name });
const routes = new Map([route('mta-subway:6', '6'), route('mta-subway:4', '4'), route('mta-subway:7X', '7X')].map((r) => [r.key, r]));

describe('describeConnection', () => {
  it('says how long you wait when there is time to change', () => {
    expect(describeConnection(way({ catch: { time: T + 240, vehicleId: 'v1' } }), T)).toEqual({
      status: 'connects',
      text: '4 min wait',
      vehicleId: 'v1',
    });
  });

  it('calls it tight when it comes before the change is done, with the next one', () => {
    const view = describeConnection(way({ catch: { time: T + 60, vehicleId: 'v1' }, next: { time: T + 480 } }), T);
    expect(view).toEqual({ status: 'tight', text: 'Tight: 1 min to change', note: 'Next one: 8 min wait', vehicleId: 'v1' });
    expect(describeConnection(way({ catch: { time: T + 10 } }), T).text).toBe('Tight: as you arrive');
  });

  it('mentions a near miss, but not one long gone', () => {
    expect(describeConnection(way({ catch: { time: T + 600 }, missed: { time: T - 70 } }), T).note).toBe('Just misses one by 1 min');
    expect(describeConnection(way({ catch: { time: T + 600 }, missed: { time: T - 10 } }), T).note).toBe('Just misses one');
    expect(describeConnection(way({ catch: { time: T + 600 }, missed: { time: T - 280 } }), T).note).toBeUndefined();
  });

  it('says when none is listed after you get there yet', () => {
    expect(describeConnection(way(), T)).toEqual({ status: 'none', text: 'None listed yet' });
  });
});

describe('connection lines', () => {
  const stop: StopConnections = {
    stopId: '631',
    name: 'Grand Central-42 St',
    time: T,
    lines: [
      { line: 'mta-subway:6', directions: [way({ catch: { time: T + 60 } }), way({ destinations: ['Brooklyn Bridge-City Hall'], catch: { time: T + 300 } })] },
      { line: 'mta-subway:4', directions: [] },
      { line: 'unknown:9', directions: [way()] },
    ],
  };

  it('lists the known lines in badge order and counts the tight ones', () => {
    expect(connectionLines(stop, routes).map((l) => l.route.name)).toEqual(['4', '6']);
    expect(connectionSummary(stop, routes)).toBe('1 line · 1 tight');
    expect(connectionSummary({ ...stop, lines: [stop.lines[1]] }, routes)).toBe('Nothing on the way yet');
  });

  it('names where a way goes', () => {
    expect(connectionHeading(way({ destinations: ['Woodlawn', 'Crown Hts-Utica Av'] }))).toBe('To Woodlawn / Crown Hts-Utica Av');
    expect(connectionHeading(way({ destinations: [] }))).toBe('On the way');
  });
});
