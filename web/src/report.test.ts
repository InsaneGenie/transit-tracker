import { describe, expect, it } from 'vitest';
import { dayLabel, dayTitle, directionLines, duration, headline, trainLines, watchedText, type DayReport } from './report';

const day: DayReport = { date: '2026-11-13', today: false, watchedHours: 19.6 };

describe('report card words', () => {
  it('says how long, in minutes and hours', () => {
    expect(duration(20)).toBe('under a minute');
    expect(duration(330)).toBe('6 min');
    expect(duration(3600)).toBe('1 hr');
    expect(duration(3900)).toBe('1 hr 5 min');
  });

  it('names the day', () => {
    expect(dayLabel(day)).toBe('Fri');
    expect(dayTitle(day)).toBe('Friday, Nov 13');
    expect(dayLabel({ ...day, today: true })).toBe('Today');
    expect(watchedText(day)).toBe('From 20 hours of live data');
    expect(watchedText({ ...day, today: true, watchedHours: 1 })).toBe('From 1 hour of live data so far');
  });

  it('heads the card with its score, or why there is none', () => {
    expect(headline('gaps', { ...day, score: 78, grade: 'B' }, 'subway')).toBe('78% of waits on schedule');
    expect(headline('ontime', { ...day, score: 93, grade: 'B' }, 'rail')).toBe('93% of trains on time');
    expect(headline('gaps', { ...day, today: true, note: 'too-little-data' }, 'bus')).toBe('Not enough to go on yet today');
    const skipped: DayReport = { ...day, note: 'skipped-stop', directions: [{ at: '59 St-Columbus Circle', trips: 2, scheduled: 90, waits: 0, waitsOnSchedule: 0 }] };
    expect(headline('gaps', skipped, 'subway')).toBe('Not graded: most trains skipped 59 St-Columbus Circle');
  });

  it("lists one way's numbers", () => {
    const d = directionLines(
      { toward: 'Inwood-207 St', at: 'Chambers St', trips: 120, scheduled: 124, waits: 110, waitsOnSchedule: 88, typicalGap: 400, scheduledGap: 360, longestGap: 1260 },
      'subway',
    );
    expect(d.title).toBe('Toward Inwood-207 St');
    expect(d.lines).toEqual([
      '120 of 124 scheduled trains passed Chambers St',
      'Usual wait 7 min (scheduled 6 min)',
      'Longest wait 21 min',
      '88 of 110 waits on schedule',
    ]);
  });

  it("lists a rail line's numbers", () => {
    expect(trainLines({ ...day, trains: 40, onTime: 37, averageLate: 540, worstLate: 1320 })).toEqual([
      '37 of 40 trains on time',
      'Late trains were 9 min late on average',
      'Latest: 22 min late',
    ]);
    expect(trainLines({ ...day, trains: 1, onTime: 1 })).toEqual(['1 of 1 train on time']);
  });
});
