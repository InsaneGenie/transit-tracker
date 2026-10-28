import { describe, expect, it } from 'vitest';
import { solarElevation, themeFor } from './theme';

describe('solarElevation', () => {
  it('is high at a summer noon in New York and below the horizon at midnight', () => {
    expect(solarElevation(new Date('2026-06-21T16:57:00Z'), 40.73, -73.97)).toBeCloseTo(72.7, 0);
    expect(solarElevation(new Date('2026-06-21T04:57:00Z'), 40.73, -73.97)).toBeLessThan(-20);
  });
});

describe('themeFor', () => {
  it('switches at sunset and sunrise', () => {
    // NYC sunset on 2026-10-28 is about 5:57 pm EDT (21:57 UTC); sunrise about 7:22 am (11:22 UTC).
    expect(themeFor(new Date('2026-10-28T21:30:00Z'), '')).toBe('light');
    expect(themeFor(new Date('2026-10-28T22:30:00Z'), '')).toBe('dark');
    expect(themeFor(new Date('2026-10-29T11:00:00Z'), '')).toBe('dark');
    expect(themeFor(new Date('2026-10-29T11:45:00Z'), '')).toBe('light');
  });

  it('can be forced from the address bar', () => {
    expect(themeFor(new Date('2026-10-28T16:00:00Z'), '?theme=dark')).toBe('dark');
    expect(themeFor(new Date('2026-10-28T03:00:00Z'), '?theme=light')).toBe('light');
  });
});
