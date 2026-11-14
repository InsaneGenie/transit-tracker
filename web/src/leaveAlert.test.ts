import { describe, expect, it } from 'vitest';
import type { Arrival, ArrivalDirection, Vehicle } from './api';
import {
  alertStatus,
  arrivingIn,
  DEFAULT_WALK,
  leaveIn,
  leaveMessage,
  parseWalk,
  parseWatch,
  planLeave,
  pollMs,
  sameDirection,
  watchDone,
  watchedDirection,
  watchLabel,
  type LeaveWatch,
} from './leaveAlert';

const NOW = 1_800_000_000;

const vehicle = (id: string, over: Partial<Vehicle> = {}): Vehicle => ({
  id,
  feed: 'mta-subway',
  agency: 'MTA',
  mode: 'subway',
  routeId: '5',
  routeName: '5',
  lat: 40.7,
  lon: -73.9,
  source: 'estimated',
  stopName: '23 St',
  status: 'IN_TRANSIT_TO',
  ...over,
});

const arrival = (id: string, inSeconds: number, over: Partial<Vehicle> = {}): Arrival => ({
  vehicle: vehicle(id, over),
  time: NOW + inSeconds,
  stopsAway: 2,
  destination: 'Wakefield-241 St',
});

const north = (...arrivals: Arrival[]): ArrivalDirection => ({ destinations: ['Wakefield-241 St', 'Nereid Av'], arrivals });
const south = (...arrivals: Arrival[]): ArrivalDirection => ({ destinations: ['Flatbush Av-Brooklyn College'], arrivals });

const watch = (over: Partial<LeaveWatch> = {}): LeaveWatch => ({
  line: 'subway:5',
  name: '5',
  mode: 'subway',
  station: { stopId: '635', name: '14 St-Union Sq', lat: 40.7347, lon: -73.9907 },
  toward: ['Wakefield-241 St'],
  walkMinutes: 5,
  created: NOW - 60,
  ...over,
});

describe('watchedDirection', () => {
  it('picks the direction sharing the most destinations', () => {
    const dirs = [south(arrival('s', 60)), north(arrival('n', 60))];
    expect(watchedDirection(dirs, ['Wakefield-241 St'])).toBe(dirs[1]);
    expect(watchedDirection(dirs, ['Somewhere else'])).toBeUndefined();
  });

  it('matches an unnamed direction only to an unnamed watch', () => {
    const unnamed: ArrivalDirection = { destinations: [], arrivals: [arrival('x', 60)] };
    expect(watchedDirection([south(arrival('s', 60)), unnamed], [])).toBe(unnamed);
    expect(sameDirection([], [])).toBe(true);
    expect(sameDirection(['A'], [])).toBe(false);
    expect(sameDirection(['A', 'B'], ['B'])).toBe(true);
  });
});

describe('planLeave', () => {
  it('waits for the first vehicle you can still reach, leaving your walk time before it', () => {
    // 2 min away is too soon for a 5 min walk; 12 min away is the one.
    const plan = planLeave(watch(), [north(arrival('a', 120), arrival('b', 720))], NOW);
    expect(plan).toMatchObject({ kind: 'wait', vehicleId: 'b', time: NOW + 720, leaveAt: NOW + 420 });
    expect(leaveIn(plan, NOW)).toBe('Leave in 7 min');
  });

  it('says leave once leaving is 30 s off or less', () => {
    expect(planLeave(watch(), [north(arrival('a', 330))], NOW).kind).toBe('leave');
    expect(planLeave(watch(), [north(arrival('a', 331))], NOW).kind).toBe('wait');
  });

  it('still counts a vehicle you would reach a minute late, but not later', () => {
    expect(planLeave(watch(), [north(arrival('a', 240))], NOW)).toMatchObject({ kind: 'leave', vehicleId: 'a' });
    expect(planLeave(watch(), [north(arrival('a', 239))], NOW).kind).toBe('none');
  });

  it('ignores the other direction', () => {
    expect(planLeave(watch(), [south(arrival('s', 900))], NOW).kind).toBe('none');
    expect(planLeave(watch(), [], NOW).kind).toBe('none');
  });

  it('follows the vehicle as its arrival time moves with its real position', () => {
    const w = watch();
    expect(planLeave(w, [north(arrival('a', 900))], NOW)).toMatchObject({ kind: 'wait', leaveAt: NOW + 600 });
    // Running late: leave later.
    expect(planLeave(w, [north(arrival('a', 1200))], NOW + 60)).toMatchObject({ kind: 'wait', leaveAt: NOW + 900 });
    // Caught up: leave now.
    expect(planLeave(w, [north(arrival('a', 400))], NOW + 100).kind).toBe('leave');
  });

  it('sticks with the vehicle you were told to leave for, even once it drops off the list', () => {
    const w = watch({ told: { vehicleId: 'a', time: NOW + 300 } });
    expect(planLeave(w, [north(arrival('b', 900), arrival('a', 320))], NOW)).toMatchObject({ kind: 'leave', vehicleId: 'a', time: NOW + 320 });
    const gone = planLeave(w, [north(arrival('b', 900))], NOW + 290);
    expect(gone).toMatchObject({ kind: 'leave', vehicleId: 'a', time: NOW + 300 });
    expect(gone.kind !== 'none' && gone.arrival).toBeUndefined();
  });
});

describe('watchDone', () => {
  it('ends a minute after the vehicle you were told about arrives', () => {
    const w = watch({ told: { vehicleId: 'a', time: NOW } });
    expect(watchDone(w, null, NOW + 60)).toBe(false);
    expect(watchDone(w, null, NOW + 61)).toBe(true);
    // Running late keeps it up longer.
    const later = planLeave(w, [north(arrival('a', 200))], NOW + 100);
    expect(watchDone(w, later, NOW + 100)).toBe(false);
  });

  it('keeps waiting until told, but not forever', () => {
    expect(watchDone(watch(), null, NOW + 3600)).toBe(false);
    expect(watchDone(watch(), null, NOW + 3 * 3600)).toBe(true);
  });
});

describe('messages', () => {
  it('says where the vehicle is and how long until it reaches the station', () => {
    const msg = leaveMessage(watch(), arrival('a', 330, { stopName: '23 St' }), NOW);
    expect(msg.title).toBe('Leave now for the 5 train');
    expect(msg.body).toBe("The 5 to Wakefield-241 St reaches 14 St-Union Sq in 6 min. It's heading to 23 St. Your walk is 5 min.");
  });

  it('says run when you are already a little late', () => {
    expect(leaveMessage(watch(), arrival('a', 260), NOW).title).toBe('Run for the 5 train');
  });

  it('names buses as buses', () => {
    const bus = watch({ name: 'M15', mode: 'bus', toward: [] });
    const msg = leaveMessage(bus, arrival('a', 300, { status: 'STOPPED_AT', stopName: '1 Av/E 14 St' }), NOW);
    expect(msg.title).toBe('Leave now for the M15 bus');
    expect(msg.body).toContain("It's at 1 Av/E 14 St.");
    expect(watchLabel(bus)).toBe('M15');
    expect(watchLabel(watch())).toBe('5 to Wakefield-241 St');
  });

  it('sums up the countdown with the vehicle it is for', () => {
    expect(alertStatus(watch(), null, NOW)).toBe('Checking the arrivals…');
    expect(alertStatus(watch(), { kind: 'none' }, NOW)).toBe('Waiting for a train you can make');
    expect(alertStatus(watch(), { kind: 'wait', vehicleId: 'a', time: NOW + 720, leaveAt: NOW + 420 }, NOW)).toBe('Leave in 7 min · train in 12 min');
    expect(alertStatus(watch({ mode: 'bus' }), { kind: 'leave', vehicleId: 'a', time: NOW + 10, leaveAt: NOW - 290 }, NOW)).toBe('Leave now · bus arriving now');
    expect(arrivingIn(NOW + 3 * 3600, NOW)).toMatch(/^at /);
  });

  it('counts down and says when nothing can be caught', () => {
    expect(leaveIn({ kind: 'none' }, NOW)).toBe('Nothing to catch yet');
    expect(leaveIn({ kind: 'wait', vehicleId: 'a', time: NOW + 400, leaveAt: NOW + 40 }, NOW)).toBe('Leave in 1 min');
  });
});

describe('saved alerts', () => {
  it('reads back a good alert and drops broken or old ones', () => {
    const w = watch();
    expect(parseWatch(JSON.stringify(w), NOW)).toEqual(w);
    expect(parseWatch(null, NOW)).toBeNull();
    expect(parseWatch('{', NOW)).toBeNull();
    expect(parseWatch(JSON.stringify({ line: 'subway:5' }), NOW)).toBeNull();
    expect(parseWatch(JSON.stringify(watch({ created: NOW - 3 * 3600 })), NOW)).toBeNull();
  });

  it('reads back a walk time, or the default', () => {
    expect(parseWalk('10')).toBe(10);
    expect(parseWalk('7')).toBe(DEFAULT_WALK);
    expect(parseWalk(null)).toBe(DEFAULT_WALK);
  });

  it('asks for arrivals more often as leaving gets close', () => {
    expect(pollMs(null, NOW)).toBe(60_000);
    expect(pollMs({ kind: 'wait', vehicleId: 'a', time: NOW + 2000, leaveAt: NOW + 1700 }, NOW)).toBe(60_000);
    expect(pollMs({ kind: 'wait', vehicleId: 'a', time: NOW + 600, leaveAt: NOW + 300 }, NOW)).toBe(30_000);
  });
});
