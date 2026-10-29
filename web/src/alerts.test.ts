import { describe, expect, it } from 'vitest';
import { alertLineKey, alertParts, alertTitle, alertWhen, worstSeverity } from './alerts';

describe('alertTitle', () => {
  it('reads the MTA kind as a short sentence', () => {
    expect(alertTitle({ type: 'Delays' })).toBe('Delays');
    expect(alertTitle({ type: 'Planned - Stops Skipped' })).toBe('Stops skipped (planned)');
  });
});

describe('alertParts', () => {
  it('pulls out lines and icons', () => {
    expect(alertParts('Uptown [2][5] trains at 3 Av [accessibility icon].')).toEqual([
      { text: 'Uptown ' },
      { line: '2' },
      { line: '5' },
      { text: ' trains at 3 Av ' },
      { icon: '♿' },
      { text: '.' },
    ]);
  });

  it('drops icons it has no symbol for and leaves plain text alone', () => {
    expect(alertParts('Board here [mystery icon]')).toEqual([{ text: 'Board here ' }]);
    expect(alertParts('No brackets')).toEqual([{ text: 'No brackets' }]);
  });

  it('maps [SIR] to the Staten Island Railway', () => {
    expect(alertLineKey('SIR')).toBe('mta-subway:SI');
    expect(alertLineKey('A')).toBe('mta-subway:A');
  });
});

describe('alertWhen', () => {
  const now = new Date(2026, 9, 29, 8, 0).getTime() / 1000;
  it('says now, until when, or when it starts', () => {
    expect(alertWhen({ active: true, start: now - 60 }, now)).toBe('Now');
    expect(alertWhen({ active: true, start: now - 60, end: now + 365 * 86400 }, now)).toBe('Now');
    expect(alertWhen({ active: true, start: now - 60, end: now + 3600 }, now)).toMatch(/^Now, until 9:00/);
    expect(alertWhen({ active: false, start: now + 86400 }, now)).toMatch(/^Starts tomorrow 8:00/);
  });
});

describe('worstSeverity', () => {
  it('picks the most serious', () => {
    expect(worstSeverity([undefined, 'changes', 'delays'])).toBe('delays');
    expect(worstSeverity([undefined])).toBeUndefined();
  });
});
