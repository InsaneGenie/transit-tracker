import { describe, expect, it } from 'vitest';
import { TIMELINE_MINUTES, widgetDirections, widgetPropsAt, widgetTimeline, type WidgetStationArrivals } from './widgetTimeline';

// 12:00:30, so entries fall on the minute after it.
const FETCHED = Date.UTC(2026, 10, 14, 17, 0, 30);
const sec = (ms: number) => ms / 1000;
const station: WidgetStationArrivals = {
  id: 'mta-subway:1|137',
  badge: '1',
  color: '#ee352e',
  textColor: '#ffffff',
  mode: 'subway',
  station: 'Chambers St',
  directions: [
    {
      to: 'Van Cortlandt Park - 242 St',
      arrivals: [
        { time: sec(FETCHED + 20_000), stopsAway: 0 },
        { time: sec(FETCHED + 6 * 60_000), stopsAway: 3 },
        { time: sec(FETCHED + 12 * 60_000), stopsAway: 6 },
        { time: sec(FETCHED + 18 * 60_000), stopsAway: 9 },
      ],
    },
    { to: 'South Ferry', arrivals: [{ time: sec(FETCHED + 4 * 60_000), stopsAway: 2 }] },
  ],
};

describe('widgetPropsAt', () => {
  it('shows the next three each way in minutes', () => {
    const p = widgetPropsAt([station], FETCHED, FETCHED);
    expect(p.state).toBe('ok');
    expect(p.stations[0].round).toBe(true);
    expect(p.stations[0].directions).toEqual([
      { to: 'Van Cortlandt Park - 242 St', minutes: [0, 6, 12], away: 'Next stop' },
      { to: 'South Ferry', minutes: [4], away: '2 stops away' },
    ]);
  });

  it('counts down as time passes and drops what has gone', () => {
    const p = widgetPropsAt([station], FETCHED, FETCHED + 5 * 60_000);
    expect(p.stations[0].directions[0]).toEqual({ to: 'Van Cortlandt Park - 242 St', minutes: [1, 7, 13], away: '' });
    // South Ferry's only train is gone, so that way isn't listed.
    expect(p.stations[0].directions).toHaveLength(1);
  });

  it('says the times are too old after an hour', () => {
    expect(widgetPropsAt([station], FETCHED, FETCHED + TIMELINE_MINUTES * 60_000)).toEqual({ stations: [], updatedAt: FETCHED, state: 'old' });
  });

  it('asks for a station when none are saved', () => {
    expect(widgetPropsAt([], FETCHED, FETCHED).state).toBe('empty');
  });
});

describe('widgetTimeline', () => {
  it('has an entry now, one on each minute for an hour, then one saying the times are old', () => {
    const entries = widgetTimeline([station], FETCHED);
    expect(entries[0].date).toBe(FETCHED);
    expect(entries[1].date).toBe(FETCHED + 30_000);
    expect(entries.at(-2)!.date).toBe(FETCHED + 59.5 * 60_000);
    expect(entries.at(-1)).toEqual({ date: FETCHED + 60 * 60_000, props: { stations: [], updatedAt: FETCHED, state: 'old' } });
    expect(entries).toHaveLength(62);
    for (let i = 1; i < entries.length; i++) expect(entries[i].date).toBeGreaterThan(entries[i - 1].date);
  });

  it('keeps nulls out, since iOS cannot store them', () => {
    const json = JSON.stringify(widgetTimeline([station], FETCHED));
    expect(json).not.toContain('null');
  });
});

describe('widgetDirections', () => {
  it('names each way by where it is going', () => {
    const d = widgetDirections(
      [
        { destinations: ['INWOOD - 207 ST', 'Far Rockaway'], arrivals: [{ time: 1, stopsAway: 2 }] },
        { destinations: [], arrivals: [] },
      ],
      (s) => s.toLowerCase(),
    );
    expect(d).toEqual([
      { to: 'inwood - 207 st / far rockaway', arrivals: [{ time: 1, stopsAway: 2 }] },
      { to: 'On the way', arrivals: [] },
    ]);
  });
});
