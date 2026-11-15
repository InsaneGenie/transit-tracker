import { describe, expect, it } from 'vitest';
import type { LineService, LineVehicle } from './api';
import { ghostSummary, missingTripText, spacingSummary, stripMarks, tidyHeadsign } from './ghosts';

const service = (scheduled: number, missing: number): LineService => ({
  scheduled,
  missing: Array.from({ length: missing }, (_, i) => ({ tripId: `t${i}`, start: 0, end: 1 })),
  headways: {},
});

const v = (id: string, at: number, gap?: LineVehicle['gap']) => ({ vehicle: { id }, at, heading: 1, gap }) as LineVehicle;

describe('ghost buses', () => {
  it('says how many scheduled buses are missing', () => {
    expect(ghostSummary(service(18, 3)).text).toBe('3 of 18 scheduled buses missing');
    expect(ghostSummary(service(18, 0)).text).toBe('All 18 scheduled buses are running');
    expect(ghostSummary(service(1, 0)).text).toBe('The 1 scheduled bus is running');
    expect(ghostSummary(service(0, 0)).text).toBe('No buses are scheduled out right now');
  });

  it('tidies headsigns', () => {
    expect(tidyHeadsign('SELECT BUS SERVICE SOUTH FERRY via 2 AV')).toBe('South Ferry via 2 Av');
    expect(tidyHeadsign('LTD WASHINGTON HEIGHTS GW BRIDGE')).toBe('Ltd Washington Heights Gw Bridge');
    expect(tidyHeadsign('Downtown')).toBe('Downtown');
  });

  it('says when a missing trip was due', () => {
    const start = Date.UTC(2026, 10, 14, 20, 0) / 1000;
    const { title, when } = missingTripText({ tripId: 't', start, end: start + 3600, headsign: 'SOUTH FERRY' }, start + 12 * 60);
    expect(title).toMatch(/^\d{1,2}:00\s?[AP]M trip to South Ferry$/);
    expect(when).toBe('due out 12 min ago');
    expect(missingTripText({ tripId: 't', start, end: start + 7200 }, start + 70 * 60).when).toMatch(/still no bus$/);
  });
});

describe('bunching', () => {
  it('sums up how the buses one way are spaced', () => {
    const going = [v('a', 1, { aheadId: 'b', meters: 50, minutes: 0.3, kind: 'bunched' }), v('b', 1.5, { aheadId: 'c', meters: 5000, minutes: 21, kind: 'long' }), v('c', 9)];
    expect(spacingSummary(going, 8)).toEqual({ text: '2 buses bunched · 21 min gap (due every 8 min)', color: '#ea580c' });
    expect(spacingSummary([v('a', 1, { aheadId: 'b', meters: 900, minutes: 6 }), v('b', 3)], 7)?.text).toBe('Evenly spaced (due every 7 min)');
    expect(spacingSummary([v('a', 1), v('b', 3)], 7)).toBeUndefined();
  });

  it('marks bunches as one stretch, and long gaps between their two buses', () => {
    const going = [
      v('a', 2, { aheadId: 'b', meters: 40, minutes: 0.2, kind: 'bunched' }),
      v('b', 2.5, { aheadId: 'c', meters: 60, minutes: 0.3, kind: 'bunched' }),
      v('c', 3, { aheadId: 'd', meters: 6000, minutes: 25, kind: 'long' }),
      v('d', 10),
    ];
    const marks = stripMarks(going, (x) => 20 - x.at);
    expect(marks).toEqual([
      { key: 'gap-c', kind: 'long', from: 10, to: 17, label: '25 min gap' },
      { key: 'bunch-a', kind: 'bunched', from: 17, to: 18, label: '3 bunched' },
    ]);
  });
});
