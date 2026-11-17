import { describe, expect, it } from 'vitest';
import { parseSeen, serializeSeen, tipText } from './tips';

describe('tips', () => {
  it('round-trips the dismissed tips', () => {
    expect([...parseSeen(serializeSeen(new Set(['vehicle', 'line'])))]).toEqual(['vehicle', 'line']);
  });
  it('treats missing or broken storage as nothing seen', () => {
    expect(parseSeen(null).size).toBe(0);
    expect(parseSeen('not json').size).toBe(0);
    expect(parseSeen('{"a":1}').size).toBe(0);
  });
  it('names what runs on the line', () => {
    expect(tipText('line', { noun: 'buses' })).toContain('The buses move');
  });
  it('says press and hold on touch screens only', () => {
    expect(tipText('myLines', { touch: true })).toContain('Press and hold');
    expect(tipText('myLines')).not.toContain('Press and hold');
  });
});
