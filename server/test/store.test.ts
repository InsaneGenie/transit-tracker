import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { FeedConfig } from '../src/feeds.js';
import { decodeFeed, snapshotFromFeed } from '../src/realtime.js';
import { createApiServer } from '../src/server.js';
import { VehicleStore } from '../src/store.js';
import { encodeFeed, indexPromise } from './fixtures.js';

const T = 1_700_000_000;

const train: FeedConfig = {
  id: 'test-train',
  agency: 'Test Transit',
  mode: 'subway',
  realtimeUrls: ['https://example.test/train'],
  staticUrl: 'https://example.test/train.zip',
  pollSeconds: 30,
};
const bus: FeedConfig = {
  id: 'test-bus',
  agency: 'Test Bus',
  mode: 'bus',
  realtimeUrls: ['https://example.test/bus'],
  apiKeyEnv: 'TEST_BUS_KEY',
  pollSeconds: 30,
};

const trainFeed = encodeFeed([
  {
    id: '1',
    tripUpdate: { trip: { tripId: 'tA', routeId: '1' }, stopTimeUpdate: [{ stopId: 'C', arrival: { time: T + 90 } }] },
  },
  { id: '2', vehicle: { trip: { tripId: 'tA', routeId: '1' }, stopId: 'C', currentStatus: 2 } },
]);
const busFeed = encodeFeed([
  {
    id: 'b1',
    vehicle: {
      vehicle: { id: 'MTA_1234' },
      trip: { tripId: 'bt', routeId: 'M15' },
      position: { latitude: 40.75, longitude: -73.97, bearing: 90 },
      timestamp: T,
    },
  },
]);

function makeStore(env: Record<string, string> = {}) {
  const requested: string[] = [];
  const store = new VehicleStore(
    [train, bus],
    env,
    async (url) => {
      requested.push(url);
      return snapshotFromFeed(decodeFeed(url.includes('/bus') ? busFeed : trainFeed), T);
    },
    () => indexPromise,
  );
  return { store, requested };
}

describe('snapshotFromFeed', () => {
  it('separates GPS vehicles from trips that need estimating', () => {
    const snap = snapshotFromFeed(decodeFeed(trainFeed), T);
    expect(snap.gps).toEqual([]);
    expect(snap.trips[0]).toMatchObject({ tripId: 'tA', status: 'IN_TRANSIT_TO', statusStopId: 'C' });
    expect(snap.trips[0].stops).toEqual([{ stopId: 'C', arrival: T + 90, departure: undefined }]);

    const busSnap = snapshotFromFeed(decodeFeed(busFeed), T);
    expect(busSnap.gps[0]).toMatchObject({ vehicleId: 'MTA_1234', routeId: 'M15', lat: expect.closeTo(40.75, 5) });
  });
});

describe('VehicleStore', () => {
  it('skips feeds whose API key is missing', async () => {
    const { store, requested } = makeStore();
    await store.loadStatic();
    await store.pollAll();
    expect(requested).toEqual(['https://example.test/train']);
    expect(store.status().find((s) => s.id === 'test-bus')).toMatchObject({
      enabled: false,
      lastError: 'set TEST_BUS_KEY to enable',
    });
  });

  it('combines GPS and estimated vehicles, with route and stop names', async () => {
    const { store, requested } = makeStore({ TEST_BUS_KEY: 'secret' });
    await store.loadStatic();
    await store.pollAll();
    expect(requested).toContain('https://example.test/bus?key=secret');

    const vehicles = store.vehicles(T);
    expect(vehicles).toHaveLength(2);
    expect(vehicles.find((v) => v.mode === 'bus')).toMatchObject({ source: 'gps', routeId: 'M15', bearing: 90 });
    expect(vehicles.find((v) => v.mode === 'subway')).toMatchObject({
      id: 'test-train:tA',
      source: 'estimated',
      routeName: '1',
      routeColor: 'EE352E',
      stopName: 'Charlie',
      status: 'IN_TRANSIT_TO',
    });
  });

  it('keeps the last good data and reports the error when a fetch fails', async () => {
    let fail = false;
    const store = new VehicleStore(
      [train],
      {},
      async () => {
        if (fail) throw new Error('/train returned 503');
        return snapshotFromFeed(decodeFeed(trainFeed), T);
      },
      () => indexPromise,
    );
    await store.loadStatic();
    await store.pollAll();
    fail = true;
    await store.pollAll();
    expect(store.vehicles(T)).toHaveLength(1);
    expect(store.status()[0].lastError).toBe('/train returned 503');
  });
});

describe('VehicleStore.detail', () => {
  it('lists the stops ahead and the track to them', async () => {
    const store = new VehicleStore(
      [train],
      {},
      async () =>
        snapshotFromFeed(
          decodeFeed(
            encodeFeed([
              {
                id: '1',
                tripUpdate: {
                  trip: { tripId: 'tB', routeId: '1' },
                  stopTimeUpdate: [
                    { stopId: 'A', departure: { time: T - 200 } },
                    { stopId: 'B', arrival: { time: T + 60 } },
                    { stopId: 'C', arrival: { time: T + 240 } },
                  ],
                },
              },
            ]),
          ),
          T,
        ),
      () => indexPromise,
    );
    await store.loadStatic();
    await store.pollAll();
    const detail = store.detail('test-train:tB', T)!;
    expect(detail.routeLongName).toBe('Test Local');
    expect(detail.upcoming.map((u) => [u.name, u.time])).toEqual([
      ['Bravo', T + 60],
      ['Charlie', T + 240],
    ]);
    // Starts at the train, follows the dog-leg into Bravo, then on to Charlie.
    expect(detail.path[0]).toEqual([detail.vehicle.lon, detail.vehicle.lat]);
    expect(detail.path).toContainEqual([-73.94, 40.79]);
    expect(detail.path.at(-1)).toEqual([-73.95, 40.78]);
    expect(store.detail('nope', T)).toBeNull();
  });

  it('shows a vehicle once when it has both GPS and predictions', async () => {
    const both = encodeFeed([
      { id: 't', tripUpdate: { trip: { tripId: 'tC', routeId: '1' }, stopTimeUpdate: [{ stopId: 'C', arrival: { time: T + 30 } }] } },
      { id: 'v', vehicle: { trip: { tripId: 'tC', routeId: '1' }, vehicle: { id: '7' }, position: { latitude: 40.785, longitude: -73.95 } } },
    ]);
    const store = new VehicleStore([train], {}, async () => snapshotFromFeed(decodeFeed(both), T), () => indexPromise);
    await store.loadStatic();
    await store.pollAll();
    expect(store.vehicles(T)).toHaveLength(1);
    const detail = store.detail('test-train:7', T)!;
    expect(detail.vehicle.source).toBe('gps');
    expect(detail.upcoming.map((u) => u.name)).toEqual(['Charlie']);
  });
});

describe('API', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('filters vehicles by map bounds and mode', async () => {
    const { store } = makeStore({ TEST_BUS_KEY: 'k' });
    await store.loadStatic();
    await store.pollAll();
    const server = createApiServer(store, () => T).listen(0);
    close = () => server.close();
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;

    const all = await (await fetch(`${base}/api/vehicles`)).json();
    expect(all.count).toBe(2);
    const midtown = await (await fetch(`${base}/api/vehicles?bbox=-74,40.74,-73.96,40.76`)).json();
    expect(midtown.vehicles.map((v: { routeId: string }) => v.routeId)).toEqual(['M15']);
    const trains = await (await fetch(`${base}/api/vehicles?mode=subway`)).json();
    expect(trains.count).toBe(1);
    expect((await fetch(`${base}/api/vehicles?bbox=nope`)).status).toBe(400);
    expect((await (await fetch(`${base}/api/health`)).json()).feeds).toHaveLength(2);
    const one = await (await fetch(`${base}/api/vehicles/${encodeURIComponent('test-bus:MTA_1234')}`)).json();
    expect(one.vehicle.routeId).toBe('M15');
    expect((await fetch(`${base}/api/vehicles/missing`)).status).toBe(404);
  });
});
