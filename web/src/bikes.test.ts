import { describe, expect, it } from 'vitest';
import type { BikeDock, RouteInfo } from './api';
import { bikeArea, bikesText, covers, dockColor, docksText, updatedText, BIKE_COLOR, BIKE_EMPTY_COLOR } from './bikes';
import { shareTitle } from './share';
import { legendGroups, MODE_LABELS, vehicleNoun } from './vehicles';
import { vehicleCount } from './lines';

const dock = (d: Partial<BikeDock>): BikeDock => ({ id: 'd', name: 'Dock', lat: 40.76, lon: -73.98, bikes: 5, docks: 10, renting: true, returning: true, ...d });

describe('Citi Bike docks', () => {
  it('asks for a padded area around the view, never more than the server lists', () => {
    const view: [number, number, number, number] = [-74, 40.75, -73.98, 40.76];
    const area = bikeArea(view);
    expect(area[0]).toBeCloseTo(-74.01);
    expect(area[2]).toBeCloseTo(-73.97);
    expect(area[1]).toBeCloseTo(40.745);
    expect(covers(area, view)).toBe(true);
    expect(covers(area, [-74.02, 40.75, -73.98, 40.76])).toBe(false);
    const wide = bikeArea([-74.1, 40.7, -73.9, 40.8]);
    expect(wide[2] - wide[0]).toBeLessThanOrEqual(0.28 + 1e-9);
    // Already wider than that: asked for as it is, and the server says to zoom in.
    expect(bikeArea([-74.3, 40.5, -73.7, 40.9])).toEqual([-74.3, 40.5, -73.7, 40.9]);
  });

  it('says what a dock has in words', () => {
    expect(bikesText(dock({ bikes: 12, ebikes: 3 }))).toBe('12 bikes, 3 electric');
    expect(bikesText(dock({ bikes: 1, ebikes: 1 }))).toBe('1 bike, all electric');
    expect(bikesText(dock({ bikes: 0 }))).toBe('No bikes right now');
    expect(bikesText(dock({ renting: false }))).toBe('Not lending bikes right now');
    expect(docksText(dock({ docks: 1 }))).toBe('1 open dock');
    expect(docksText(dock({ docks: 0 }))).toBe('No open docks right now');
    expect(docksText(dock({ returning: false }))).toBe('Not taking returns right now');
    expect(dockColor(dock({}))).toBe(BIKE_COLOR);
    expect(dockColor(dock({ bikes: 0 }))).toBe(BIKE_EMPTY_COLOR);
    expect(dockColor(dock({ renting: false }))).toBe(BIKE_EMPTY_COLOR);
    const now = Date.parse('2026-11-14T12:00:00Z');
    expect(updatedText('2026-11-14T11:57:00Z', now)).toBe('Updated 3 min ago');
    expect(updatedText('2026-11-14T12:00:10Z', now)).toBe('Updated just now');
    expect(updatedText(undefined, now)).toBe('');
  });
});

describe('ferries', () => {
  it('have their own words, label and list', () => {
    expect(vehicleNoun('ferry')).toBe('ferry');
    expect(vehicleNoun('ferry', true)).toBe('ferries');
    expect(vehicleCount(2, 'ferry')).toBe('2 ferries');
    expect(MODE_LABELS.ferry).toBe('Ferry');
    expect(shareTitle({ vehicle: { name: 'ER', mode: 'ferry', to: 'Wall St/Pier 11' } })).toBe('The ER ferry to Wall St/Pier 11');
    expect(shareTitle({ line: { name: 'East River', mode: 'ferry' } })).toBe('The East River ferry route');
    const route = (id: string, name: string): RouteInfo => ({ key: `nyc-ferry:${id}`, feed: 'nyc-ferry', agency: 'NYC Ferry', mode: 'ferry', id, name });
    const groups = legendGroups([route('SB', 'South Brooklyn'), route('ER', 'East River')], 'ferry');
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('NYC Ferry');
    expect(groups[0].routes.map((r) => r.id)).toEqual(['ER', 'SB']);
  });
});
