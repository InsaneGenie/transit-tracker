import { describe, expect, it } from 'vitest';
import { MAX_STEPS, pushStep, stepLabel, type PanelStep } from './panelHistory';

const step = (label: string, vehicleId: string | null = null): PanelStep<null> => ({ vehicleId, line: null, station: null, label });

describe('panel history', () => {
  it('names where Back goes', () => {
    expect(stepLabel({ vehicle: { mode: 'subway', routeName: '5' } }, null)).toBe('the 5 train');
    expect(stepLabel({ vehicle: { mode: 'bus', routeId: 'MTA NYCT_M15' } }, { name: 'BROADWAY/W 42 ST' })).toBe('the M15 bus · Broadway/W 42 St');
    expect(stepLabel({ lineKey: 'mta-subway:5' }, { name: 'Fulton St' })).toBe('the 5 line · Fulton St');
  });

  it('remembers each step once, and only the latest ones', () => {
    let h = pushStep([], step('a'));
    h = pushStep(h, step('a'));
    h = pushStep(h, null);
    expect(h.map((s) => s.label)).toEqual(['a']);
    for (let i = 0; i < MAX_STEPS + 5; i++) h = pushStep(h, step(String(i)));
    expect(h).toHaveLength(MAX_STEPS);
    expect(h[h.length - 1].label).toBe(String(MAX_STEPS + 4));
  });
});
