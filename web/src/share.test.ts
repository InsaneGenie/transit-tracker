import { describe, expect, it } from 'vitest';
import { parseShare, shareTitle, shareUrl, withoutShare } from './share';

describe('share links', () => {
  it('round-trips a train, a line and a station', () => {
    const targets = [
      { vehicle: 'mta-subway:123_5..S', line: 'mta-subway:5' },
      { line: 'mta-bus:M15+' },
      { line: 'mta-subway:A', station: 'A38' },
    ];
    for (const t of targets) expect(parseShare(new URL(shareUrl('https://x.test/', t)).search)).toEqual(t);
    expect(shareUrl('https://x.test', { line: 'mta-subway:A', station: 'A38' })).toBe('https://x.test/?line=mta-subway:A&station=A38');
  });

  it('ignores links to nothing', () => {
    expect(parseShare('')).toBeNull();
    expect(parseShare('?theme=dark')).toBeNull();
    expect(parseShare('?line=nonsense')).toBeNull();
    expect(parseShare('?vehicle=v1&line=nonsense')).toEqual({ vehicle: 'v1' });
  });

  it('keeps other settings once opened', () => {
    expect(withoutShare('https://x.test/?theme=dark&line=mta-subway:A')).toBe('/?theme=dark');
    expect(withoutShare('https://x.test/?vehicle=v1')).toBe('/');
  });

  it('says what it shows', () => {
    expect(shareTitle({ vehicle: { name: '5', mode: 'subway', to: 'Flatbush Av' } })).toBe('The 5 train to Flatbush Av');
    expect(shareTitle({ vehicle: { name: 'M15', mode: 'bus' } })).toBe('The M15 bus');
    expect(shareTitle({ line: { name: 'M15', mode: 'bus' } })).toBe('The M15 bus line');
    expect(shareTitle({ line: { name: 'A', mode: 'subway' }, station: 'Fulton St' })).toBe('Fulton St on the A line');
  });
});
