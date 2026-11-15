import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BikeStore, feedUrls, parseStationInformation, parseStationStatus } from '../src/bikes.js';
import type { FeedConfig } from '../src/feeds.js';
import { decodeFeed, linkTripsByVehicle, snapshotFromFeed } from '../src/realtime.js';
import { createApiServer } from '../src/server.js';
import { VehicleStore } from '../src/store.js';
import { encodeFeed, indexPromise } from './fixtures.js';

const T = 1_700_000_000;

const ferry: FeedConfig = {
  id: 'test-ferry',
  agency: 'Test Ferry',
  mode: 'ferry',
  realtimeUrls: ['https://example.test/ferry/vehicles', 'https://example.test/ferry/trips'],
  staticUrls: ['https://example.test/ferry.zip'],
  optional: true,
  matchTripsByVehicle: true,
  pollSeconds: 30,
};
const train: FeedConfig = {
  id: 'test-train',
  agency: 'Test Transit',
  mode: 'subway',
  realtimeUrls: ['https://example.test/train'],
  staticUrls: ['https://example.test/train.zip'],
  pollSeconds: 30,
};

// A boat whose position doesn't name its trip, with the trip's update in a separate feed naming the boat.
const ferryVehicles = encodeFeed([
  { id: 'v1', vehicle: { vehicle: { id: 'boat-7' }, position: { latitude: 40.795, longitude: -73.95 }, timestamp: T } },
]);
const ferryTrips = encodeFeed([
  {
    id: 'u1',
    tripUpdate: {
      trip: { tripId: 'f1', routeId: '1' },
      vehicle: { id: 'boat-7' },
      stopTimeUpdate: [
        { stopId: 'B', arrival: { time: T + 60 } },
        { stopId: 'C', arrival: { time: T + 240 } },
      ],
    },
  },
  // The same boat's next trip, which it hasn't started.
  {
    id: 'u2',
    tripUpdate: {
      trip: { tripId: 'f2', routeId: '1' },
      vehicle: { id: 'boat-7' },
      stopTimeUpdate: [
        { stopId: 'C', departure: { time: T + 900 } },
        { stopId: 'A', arrival: { time: T + 1500 } },
      ],
    },
  },
]);
const trainFeed = encodeFeed([
  { id: '1', tripUpdate: { trip: { tripId: 'tA', routeId: '1' }, stopTimeUpdate: [{ stopId: 'C', arrival: { time: T + 90 } }] } },
]);

function ferryStore(fail: { ferry?: boolean } = {}) {
  return new VehicleStore(
    [train, ferry],
    {},
    async (url) => {
      if (url.includes('/ferry/') && fail.ferry) throw new Error('ferry feed down');
      const bytes = url.includes('/ferry/vehicles') ? ferryVehicles : url.includes('/ferry/trips') ? ferryTrips : trainFeed;
      return snapshotFromFeed(decodeFeed(bytes), T);
    },
    () => indexPromise,
  );
}

describe('ferries', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it("matches a boat's position to the trip naming it, so it shows once with its landings", async () => {
    const store = ferryStore();
    await store.loadStatic();
    await store.pollAll();
    const boats = store.vehicles(T).filter((v) => v.mode === 'ferry');
    expect(boats).toHaveLength(1);
    expect(boats[0]).toMatchObject({ id: 'test-ferry:boat-7', tripId: 'f1', routeId: '1', source: 'gps' });
    const detail = store.detail('test-ferry:boat-7', T)!;
    expect(detail.upcoming.map((u) => u.name)).toEqual(['Bravo', 'Charlie']);
  });

  it('links positions to trips only for feeds that ask for it', () => {
    const snap = linkTripsByVehicle({
      fetchedAt: T,
      gps: [
        { vehicleId: 'a', lat: 1, lon: 1 },
        { vehicleId: 'b', tripId: 'known', lat: 1, lon: 1 },
        { vehicleId: 'c', lat: 1, lon: 1 },
      ],
      trips: [
        { tripId: 'known', vehicleId: 'b', stops: [] },
        { tripId: 'later', vehicleId: 'a', routeId: 'R', stops: [{ stopId: 'x', arrival: T + 500 }] },
        { tripId: 'now', vehicleId: 'a', routeId: 'R', stops: [{ stopId: 'y', arrival: T + 100 }] },
      ],
    });
    expect(snap.gps.map((g) => g.tripId)).toEqual(['now', 'known', undefined]);
    expect(snap.gps[0].routeId).toBe('R');
  });

  it("is only sent to clients that ask for ferries, so older apps don't get a mode they can't draw", async () => {
    const store = ferryStore();
    await store.loadStatic();
    await store.pollAll();
    const server = createApiServer(store, () => T).listen(0);
    close = () => server.close();
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const modes = (r: { vehicles: { mode: string }[] }) => r.vehicles.map((v) => v.mode).sort();
    expect(modes(await (await fetch(`${base}/api/vehicles`)).json())).toEqual(['subway']);
    expect(modes(await (await fetch(`${base}/api/vehicles?extra=ferry`)).json())).toEqual(['ferry', 'subway']);
    expect(modes(await (await fetch(`${base}/api/vehicles?mode=ferry`)).json())).toEqual(['ferry']);
    const routes = async (q: string) =>
      ((await (await fetch(`${base}/api/routes${q}`)).json()).routes as { mode: string }[]).map((r) => r.mode);
    expect(await routes('')).not.toContain('ferry');
    expect(await routes('?extra=ferry')).toContain('ferry');
    const paths = (await (await fetch(`${base}/api/route-paths?modes=subway,rail,ferry`)).json()).lines as { mode: string }[];
    expect(paths.map((p) => p.mode).sort()).toEqual(['ferry', 'subway']);
  });

  it("doesn't hold the site back from being ready while the ferry feed is down", async () => {
    const store = ferryStore({ ferry: true });
    await store.loadStatic();
    expect(store.ready()).toBe(false);
    await store.pollAll();
    expect(store.ready()).toBe(true);
    expect(store.status().find((s) => s.id === 'test-ferry')?.lastError).toContain('ferry feed down');
  });
});

const information = {
  data: {
    stations: [
      { station_id: 'd1', name: 'W 52 St & 6 Ave', lat: 40.7616, lon: -73.9789, capacity: 40 },
      { station_id: 'd2', name: [{ text: 'Broadway & W 60 St', language: 'en' }], lat: 40.7697, lon: -73.9819 },
      { station_id: 'far', name: 'Far Away', lat: 40.6, lon: -73.9 },
      { station_id: 'bad', name: 'No place' },
    ],
  },
};
const status = (bikes = 7) => ({
  data: {
    stations: [
      { station_id: 'd1', num_bikes_available: bikes, num_ebikes_available: 2, num_docks_available: 30, is_installed: 1, is_renting: 1, is_returning: 1 },
      { station_id: 'd2', num_bikes_available: 0, num_docks_available: 19, is_installed: true, is_renting: false, is_returning: true },
      { station_id: 'far', num_bikes_available: 3, num_docks_available: 3, is_installed: true },
      { station_id: 'gone', num_bikes_available: 3, num_docks_available: 3, is_installed: false },
    ],
  },
});
const discovery = {
  data: {
    en: {
      feeds: [
        { name: 'station_information', url: 'https://bikes.test/info.json' },
        { name: 'station_status', url: 'https://bikes.test/status.json' },
      ],
    },
  },
};
const MIDTOWN: [number, number, number, number] = [-74.0, 40.75, -73.97, 40.78];

function bikeStore(answers: { status?: () => unknown; fail?: boolean } = {}) {
  const asked: string[] = [];
  let now = 1_700_000_000_000;
  const store = new BikeStore(
    async (url) => {
      asked.push(url);
      if (answers.fail) throw new Error('bikes down');
      if (url.endsWith('gbfs.json')) return discovery;
      if (url.endsWith('info.json')) return information;
      return (answers.status ?? status)();
    },
    'https://bikes.test/gbfs.json',
    () => now,
  );
  return { store, asked, advance: (ms: number) => (now += ms) };
}

describe('Citi Bike docks', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('reads the feed list, names and counts from GBFS 2 and 3 styles', () => {
    expect(feedUrls(discovery)).toEqual({ station_information: 'https://bikes.test/info.json', station_status: 'https://bikes.test/status.json' });
    expect(feedUrls({ data: { feeds: [{ name: 'station_status', url: 'https://v3/status' }] } })).toEqual({ station_status: 'https://v3/status' });
    expect(feedUrls(null)).toEqual({});
    const info = parseStationInformation(information);
    expect(info.get('d2')?.name).toBe('Broadway & W 60 St');
    expect(info.has('bad')).toBe(false);
    const counts = parseStationStatus(status());
    expect(counts.get('d1')).toEqual({ bikes: 7, ebikes: 2, docks: 30, renting: true, returning: true });
    expect(counts.get('d2')).toMatchObject({ bikes: 0, renting: false });
    expect(counts.has('gone')).toBe(false);
    expect(parseStationStatus({ data: { stations: [{ station_id: 'v3', num_vehicles_available: 4, num_docks_available: 1 }] } }).get('v3')).toMatchObject({ bikes: 4 });
  });

  it('lists the docks in an area, and asks the feed again only once a minute', async () => {
    const { store, asked, advance } = bikeStore();
    const first = await store.docks(MIDTOWN);
    expect(first.docks.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(first.docks[0]).toMatchObject({ name: 'W 52 St & 6 Ave', bikes: 7, ebikes: 2, docks: 30 });
    expect(asked).toEqual(['https://bikes.test/gbfs.json', 'https://bikes.test/info.json', 'https://bikes.test/status.json']);
    await store.docks(MIDTOWN);
    expect(asked).toHaveLength(3);
    advance(61_000);
    // Answered at once with the counts in hand while fresher ones load.
    await store.docks(MIDTOWN);
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.slice(3)).toEqual(['https://bikes.test/status.json']);
  });

  it('keeps the last counts through a failed update, and drops them once too old', async () => {
    let fail = false;
    const { store, advance } = bikeStore({
      status: () => {
        if (fail) throw new Error('hiccup');
        return status();
      },
    });
    expect((await store.docks(MIDTOWN)).docks).toHaveLength(2);
    fail = true;
    advance(61_000);
    await store.docks(MIDTOWN);
    await new Promise((r) => setTimeout(r, 0));
    expect((await store.docks(MIDTOWN)).docks).toHaveLength(2);
    expect(store.health().lastError).toBe('hiccup');
    advance(15 * 60_000);
    expect((await store.docks(MIDTOWN)).docks).toEqual([]);
  });

  it('serves docks for street-level areas only', async () => {
    const { store } = bikeStore();
    const server = createApiServer(ferryStore(), () => T, undefined, undefined, store).listen(0);
    close = () => server.close();
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const near = await (await fetch(`${base}/api/bikes?bbox=${MIDTOWN.join(',')}`)).json();
    expect(near.docks.map((d: { id: string }) => d.id)).toEqual(['d1', 'd2']);
    expect(near.updatedAt).toBeTypeOf('string');
    const city = await (await fetch(`${base}/api/bikes?bbox=-74.3,40.5,-73.7,40.9`)).json();
    expect(city).toEqual({ zoomIn: true, docks: [] });
    expect((await fetch(`${base}/api/bikes`)).status).toBe(400);
    expect((await (await fetch(`${base}/api/health`)).json()).bikes).toMatchObject({ docks: 3 });
  });

  it('answers with no docks when the feed is down', async () => {
    const { store } = bikeStore({ fail: true });
    expect(await store.docks(MIDTOWN)).toEqual({ docks: [] });
    expect(store.health().lastError).toBe('bikes down');
  });
});
