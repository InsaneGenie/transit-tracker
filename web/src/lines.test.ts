import { describe, expect, it } from 'vitest';
import type { LineVehicle } from './api';
import { lineStatus, towards, vehicleCount } from './lines';

const v = (heading: 1 | -1, destination?: string) => ({ heading, destination, at: 0, vehicle: {} }) as LineVehicle;

describe('lines', () => {
  it('counts vehicles in words', () => {
    expect(vehicleCount(1, 'bus')).toBe('1 bus');
    expect(vehicleCount(3, 'bus')).toBe('3 buses');
    expect(vehicleCount(14, 'subway')).toBe('14 trains');
  });

  it('says how a line is running', () => {
    expect(lineStatus('delays', 5).text).toBe('Delays');
    expect(lineStatus('info', 5).text).toBe('Good service');
    expect(lineStatus(undefined, 0).text).toBe('Not running now');
    expect(lineStatus(undefined, undefined).text).toBe('Good service');
  });

  it('names a direction after where most of its vehicles go, else the end of the line', () => {
    const stops = [{ stopId: 'a', name: 'SOUTH FERRY' }, { stopId: 'b', name: 'Harlem' }];
    expect(towards([v(1, 'Harlem'), v(1, 'Harlem'), v(1, 'Midtown'), v(-1, 'X')], 1, stops)).toBe('Harlem');
    expect(towards([], -1, stops)).toBe('South Ferry');
  });
});
