import { describe, expect, it } from 'vitest';
import { hasStopAhead, isOver, staleAfter, trackChanged, trackProps, type TrackDetail } from './tracking';

const NOW = 1_800_000_000_000;
const line = { line: 'A', color: '#0039a6', textColor: '#ffffff', tidy: (s: string) => s.replace(/ STATION$/, '') };
const stop = { stopId: 'A31', name: '14 St', lat: 40.7402, lon: -74.0021 };

function detail(upcoming: TrackDetail['upcoming'], vehicle: Partial<TrackDetail['vehicle']> = {}): TrackDetail {
  return {
    vehicle: { id: 'v', mode: 'subway', lat: 40.75, lon: -73.99, source: 'estimated', status: 'IN_TRANSIT_TO', stopId: 'A28', stopName: '34 St', ...vehicle },
    upcoming,
  };
}
const at = (s: number) => NOW / 1000 + s;
const ahead = [
  { stopId: 'A28S', name: '34 St', time: at(60) },
  { stopId: 'A30S', name: '23 St', time: at(150) },
  { stopId: 'A31S', name: '14 St', time: at(240), lat: 40.7402, lon: -74.0021 },
];

describe('trackProps', () => {
  it('counts the stops and time to the station, matching its platform', () => {
    const p = trackProps(detail(ahead), stop, line, NOW - 60_000, NOW);
    expect(p).toMatchObject({ line: 'A', stop: '14 St', stopsAway: 2, arrival: at(240) * 1000, where: 'Heading to 34 St', phase: 'coming', gps: false });
  });

  it('says arriving when due within half a minute, and arrived while standing there', () => {
    const last = [{ ...ahead[2], time: at(20) }];
    expect(trackProps(detail(last), stop, line, NOW, NOW).phase).toBe('arriving');
    const standing = detail(last, { status: 'STOPPED_AT', stopId: 'A31S', stopName: '14 St', lat: 40.7402, lon: -74.0021 });
    const p = trackProps(standing, stop, line, NOW, NOW);
    expect(p.phase).toBe('arrived');
    expect(p.where).toBe('At 14 St');
  });

  it('stays arrived while it stands there past its time, and is over once it moves on', () => {
    const later = [{ stopId: 'A32S', name: 'W 4 St', time: at(90) }];
    const standing = trackProps(detail(later, { status: 'STOPPED_AT', stopId: 'A31S', lat: 40.7402, lon: -74.0021 }), stop, line, NOW, NOW);
    expect(standing.phase).toBe('arrived');
    expect(isOver(standing.phase)).toBe(false);
    const gone = trackProps(detail(later, { status: 'IN_TRANSIT_TO', stopId: 'A32S', stopName: 'W 4 St' }), stop, line, NOW, NOW);
    expect(gone.phase).toBe('gone');
    expect(isOver(gone.phase)).toBe(true);
    expect(gone.arrival).toBeUndefined();
  });

  it('matches a station by place when its ids differ', () => {
    const bus = detail([{ stopId: '401234', name: 'BROADWAY/W 14 ST', time: at(100), lat: 40.7403, lon: -74.0022 }], { mode: 'bus', source: 'gps' });
    expect(hasStopAhead(bus, stop)).toBe(true);
    expect(hasStopAhead(bus, { ...stop, lat: 40.8, lon: -73.9 })).toBe(false);
  });
});

describe('trackChanged', () => {
  const base = trackProps(detail(ahead), stop, line, NOW, NOW);
  it('ignores small drifts in the arrival time', () => {
    expect(trackChanged(null, base)).toBe(true);
    expect(trackChanged(base, { ...base, arrival: base.arrival! + 10_000, updatedAt: NOW + 15_000 })).toBe(false);
    expect(trackChanged(base, { ...base, arrival: base.arrival! + 30_000 })).toBe(true);
  });
  it('sends stop and phase changes, and refreshes every few minutes', () => {
    expect(trackChanged(base, { ...base, stopsAway: 1 })).toBe(true);
    expect(trackChanged(base, { ...base, phase: 'arriving' })).toBe(true);
    expect(trackChanged(base, { ...base, updatedAt: NOW + 5 * 60_000 })).toBe(true);
  });
});

describe('staleAfter', () => {
  it('trusts the content until a little after it is due', () => {
    const p = trackProps(detail(ahead), stop, line, NOW, NOW);
    expect(staleAfter(p)).toBe(Math.max(NOW + 5 * 60_000, p.arrival! + 2 * 60_000));
    expect(staleAfter({ ...p, arrival: undefined })).toBe(NOW + 5 * 60_000);
  });
});
