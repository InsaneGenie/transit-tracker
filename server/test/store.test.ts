import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FeedConfig } from '../src/feeds.js';
import { nearestOnPath } from '../src/geo.js';
import { decodeFeed, snapshotFromFeed } from '../src/realtime.js';
import { createApiServer } from '../src/server.js';
import { VehicleStore } from '../src/store.js';
import { buildStaticIndex, type GtfsFiles } from '../src/static-gtfs.js';
import { encodeFeed, files, gtfs, indexPromise } from './fixtures.js';

const T = 1_700_000_000;

const train: FeedConfig = {
  id: 'test-train',
  agency: 'Test Transit',
  mode: 'subway',
  realtimeUrls: ['https://example.test/train'],
  staticUrls: ['https://example.test/train.zip'],
  pollSeconds: 30,
};
const bus: FeedConfig = {
  id: 'test-bus',
  agency: 'Test Bus',
  mode: 'bus',
  realtimeUrls: ['https://example.test/bus'],
  bearingFromEast: true,
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
      position: { latitude: 40.75, longitude: -73.97, bearing: 30 }, // 30° counter-clockwise from east
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

describe('snapshotFromFeed subway status', () => {
  it('says how long before the feed was published a train was last seen at its station', () => {
    const feed = encodeFeed([
      { id: 't', tripUpdate: { trip: { tripId: 'tS' }, stopTimeUpdate: [{ stopId: 'B', arrival: { time: T - 30 } }] } },
      { id: 'v', vehicle: { trip: { tripId: 'tS' }, stopId: 'B', currentStatus: 1, timestamp: T - 12 } },
    ]);
    expect(snapshotFromFeed(decodeFeed(feed), T).trips[0]).toMatchObject({ status: 'STOPPED_AT', statusStopId: 'B', statusAge: 12 });
  });
});

describe('snapshotFromFeed rail quirks', () => {
  it("matches a Metro-North vehicle, listed under its train number, to its entity's trip", () => {
    const snap = snapshotFromFeed(
      decodeFeed(
        encodeFeed([
          {
            id: '1392',
            tripUpdate: { trip: { tripId: '3248407', routeId: '3' }, stopTimeUpdate: [{ stopId: 'C', arrival: { time: T + 90 } }] },
            vehicle: { trip: { tripId: '1392' }, vehicle: { id: '1392' }, position: { latitude: 40.785, longitude: -73.95 } },
          },
        ]),
      ),
      T,
    );
    expect(snap.gps[0]).toMatchObject({ vehicleId: '1392', tripId: '3248407', routeId: '3' });
  });

  it("takes an LIRR vehicle's route from its trip update", () => {
    const snap = snapshotFromFeed(
      decodeFeed(
        encodeFeed([
          { id: 't', tripUpdate: { trip: { tripId: 'GO_1', routeId: '9' }, stopTimeUpdate: [{ stopId: 'C', arrival: { time: T + 90 } }] } },
          { id: 'v', vehicle: { trip: { tripId: 'GO_1' }, vehicle: { id: '7' }, position: { latitude: 40.785, longitude: -73.95 } } },
        ]),
      ),
      T,
    );
    expect(snap.gps[0]).toMatchObject({ tripId: 'GO_1', routeId: '9' });
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
    expect(vehicles.find((v) => v.mode === 'bus')).toMatchObject({ source: 'gps', routeId: 'M15', bearing: 60 });
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

  it("keeps a URL's last vehicles when only that URL fails", async () => {
    const twoUrls: FeedConfig = { ...bus, apiKeyEnv: undefined, realtimeUrls: ['https://example.test/bus', 'https://example.test/train'] };
    let fail = false;
    const store = new VehicleStore(
      [twoUrls],
      {},
      async (url) => {
        if (fail && url.includes('/bus')) throw new Error('/bus returned 503');
        return snapshotFromFeed(decodeFeed(url.includes('/bus') ? busFeed : trainFeed), T);
      },
      () => indexPromise,
    );
    await store.pollAll();
    expect(store.vehicles(T).map((v) => v.id)).toContain('test-bus:MTA_1234');
    fail = true;
    await store.pollAll();
    expect(store.vehicles(T).map((v) => v.id)).toContain('test-bus:MTA_1234');
    expect(store.status()[0].lastError).toBe('/bus returned 503');
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
    // Starts at the train, on the dog-leg's last stretch into Bravo, then on to Charlie. It is past the
    // dog-leg's last corner, so the line isn't drawn back to it.
    expect(detail.path[0]).toEqual([detail.vehicle.lon, detail.vehicle.lat]);
    expect(detail.vehicle.lon).toBeLessThan(-73.94);
    expect(detail.path).not.toContainEqual([-73.94, 40.79]);
    expect(detail.path).toContainEqual([-73.95, 40.79]);
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

describe('VehicleStore GPS fixes', () => {
  const storeFor = (entities: Parameters<typeof encodeFeed>[0]) =>
    new VehicleStore([train], {}, async () => snapshotFromFeed(decodeFeed(encodeFeed(entities)), T), () => indexPromise);

  it('leaves out a train still reporting a fix after its trip has ended', async () => {
    const store = storeFor([
      { id: 't', tripUpdate: { trip: { tripId: 'tD', routeId: '1' }, stopTimeUpdate: [{ stopId: 'C', arrival: { time: T - 600 } }] } },
      { id: 'v', vehicle: { trip: { tripId: 'tD' }, vehicle: { id: '8' }, position: { latitude: 40.78, longitude: -73.95 }, timestamp: T - 30 } },
    ]);
    await store.loadStatic();
    await store.pollAll();
    expect(store.vehicles(T)).toEqual([]);
  });

  it('estimates a train whose fix is too old, and drops an old fix with nothing to estimate from', async () => {
    const store = storeFor([
      { id: 't', tripUpdate: { trip: { tripId: 'tE', routeId: '1' }, stopTimeUpdate: [
        { stopId: 'B', arrival: { time: T - 100 }, departure: { time: T - 90 } },
        { stopId: 'C', arrival: { time: T + 90 } },
      ] } },
      { id: 'v', vehicle: { trip: { tripId: 'tE' }, vehicle: { id: '9' }, position: { latitude: 40.8, longitude: -73.95 }, timestamp: T - 20 * 60 } },
      { id: 'w', vehicle: { trip: { tripId: 'gone' }, vehicle: { id: '10' }, position: { latitude: 40.8, longitude: -73.95 }, timestamp: T - 20 * 60 } },
    ]);
    await store.loadStatic();
    await store.pollAll();
    const vehicles = store.vehicles(T);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({ tripId: 'tE', source: 'estimated', lat: expect.closeTo(40.785, 3) });
  });
});

describe('VehicleStore GPS positions', () => {
  // One feed per poll, in turn.
  function storeOf(feeds: Parameters<typeof encodeFeed>[0][]) {
    let poll = 0;
    return new VehicleStore(
      [train],
      {},
      async () => snapshotFromFeed(decodeFeed(encodeFeed(feeds[Math.min(poll++, feeds.length - 1)])), T),
      () => indexPromise,
    );
  }
  const at = (lat: number, timestamp: number, tripId = 'tG') => ({
    id: 'v',
    vehicle: { trip: { tripId }, vehicle: { id: '7' }, position: { latitude: lat, longitude: -73.95 }, timestamp },
  });
  const tripG = {
    id: 't',
    tripUpdate: { trip: { tripId: 'tG', routeId: '1' }, stopTimeUpdate: [
      { stopId: 'B', arrival: { time: T - 100 }, departure: { time: T - 90 } },
      { stopId: 'C', arrival: { time: T + 40 } },
    ] },
  };

  it('moves a reported position on along the track toward the next stop', async () => {
    const store = storeOf([[tripG, at(40.788, T - 40)]]);
    await store.loadStatic();
    await store.pollAll();
    // Reported 40 s ago, due at C in 40 s: halfway there.
    expect(store.vehicles(T)[0]).toMatchObject({ source: 'gps', lat: expect.closeTo(40.784, 4), bearing: expect.closeTo(180, 0) });
  });

  it("never pulls a bus back along its route when a newer report puts it behind where it was shown", async () => {
    const busConfig: FeedConfig = { ...train, id: 'test-bus3', mode: 'bus', staticDetail: 'stops' };
    // Trip t1 follows the dog-leg shape from A (40.80, -73.95) east, south, then west into B.
    const report = (lon: number, timestamp: number, dueAtB: number) => [
      { id: 'v', vehicle: { trip: { tripId: 't1' }, vehicle: { id: '5' }, position: { latitude: 40.8, longitude: lon }, timestamp } },
      { id: 't', tripUpdate: { trip: { tripId: 't1', routeId: '1' }, stopTimeUpdate: [{ stopId: 'B', arrival: { time: dueAtB } }] } },
    ];
    let poll = 0;
    const feeds = [report(-73.9475, T - 30, T + 30), report(-73.9474, T, T + 300)];
    const store = new VehicleStore(
      [busConfig],
      {},
      async () => snapshotFromFeed(decodeFeed(encodeFeed(feeds[Math.min(poll++, feeds.length - 1)])), T),
      () => buildStaticIndex(files, 'stops'),
    );
    await store.loadStatic();
    await store.pollAll();
    const first = store.vehicles(T)[0];
    expect(first.lon).toBeGreaterThan(-73.9475); // moved on east along the route
    await store.pollAll(); // reported just 9 m on, and now late
    expect(store.vehicles(T + 1)[0]).toMatchObject({ lat: first.lat, lon: first.lon });
  });

  it('ignores a position too far from the last to be real, until the next one agrees with it', async () => {
    const store = storeOf([[at(40.79, T - 20, 'none')], [at(40.7, T - 10, 'none')], [at(40.6995, T, 'none')]]);
    await store.loadStatic();
    await store.pollAll();
    expect(store.vehicles(T)[0].lat).toBeCloseTo(40.79, 5);
    await store.pollAll(); // 10 km in 10 s
    expect(store.vehicles(T)[0].lat).toBeCloseTo(40.79, 5);
    await store.pollAll(); // then 55 m on from there
    expect(store.vehicles(T)[0].lat).toBeCloseTo(40.6995, 4);
  });
});

describe('VehicleStore estimated trains', () => {
  // Train tF heading from B to C, a three-minute hop, due at C at each poll's time in turn.
  function delayedTrain(arrivals: number[]) {
    let poll = 0;
    const store = new VehicleStore(
      [train],
      {},
      async () => {
        const at = arrivals[Math.min(poll++, arrivals.length - 1)];
        const entity = { id: 't', tripUpdate: { trip: { tripId: 'tF', routeId: '1' }, stopTimeUpdate: [{ stopId: 'C', arrival: { time: at } }] } };
        return snapshotFromFeed(decodeFeed(encodeFeed([entity])), T);
      },
      () => indexPromise,
    );
    return store;
  }
  const latOf = (store: VehicleStore, now: number) => store.vehicles(now).find((v) => v.id === 'test-train:tF')?.lat;

  it('waits where it was shown when a delay would put it back, then carries on', async () => {
    const store = delayedTrain([T + 90, T + 150]);
    await store.loadStatic();
    await store.pollAll();
    const shown = latOf(store, T)!;
    expect(shown).toBeCloseTo(40.785, 3); // halfway from B to C
    await store.pollAll(); // a minute late now: estimated a fifth of the way from B
    expect(latOf(store, T + 10)).toBe(shown);
    expect(latOf(store, T + 130)).toBeLessThan(shown); // past where it waited, heading south to C
  });

  it('does not go back to the stop it left', async () => {
    const store = delayedTrain([T + 90, T + 400]);
    await store.loadStatic();
    await store.pollAll();
    const shown = latOf(store, T)!;
    await store.pollAll(); // now due to leave B in 40 s
    expect(latOf(store, T + 10)).toBe(shown);
  });

  it('goes with the new times once they have stayed behind for two minutes', async () => {
    const store = delayedTrain([T + 90, T + 400]);
    await store.loadStatic();
    await store.pollAll();
    const shown = latOf(store, T)!;
    await store.pollAll();
    expect(latOf(store, T + 10)).toBe(shown);
    expect(latOf(store, T + 140)).toBeCloseTo(40.79, 3); // back at B
  });
});

describe('VehicleStore.arrivals', () => {
  it('lists the vehicles coming to a station both ways, soonest first', async () => {
    const feed = encodeFeed([
      {
        id: 'south',
        tripUpdate: {
          trip: { tripId: 'tS', routeId: '1' },
          stopTimeUpdate: [
            { stopId: 'A', departure: { time: T - 30 } },
            { stopId: 'B', arrival: { time: T + 120 } },
            { stopId: 'C', arrival: { time: T + 300 } },
          ],
        },
      },
      {
        id: 'north',
        tripUpdate: {
          trip: { tripId: 'tN', routeId: '1' },
          stopTimeUpdate: [
            { stopId: 'C', arrival: { time: T + 20 } },
            { stopId: 'B2', arrival: { time: T + 200 } },
            { stopId: 'A', arrival: { time: T + 400 } },
          ],
        },
      },
      { id: 'n', vehicle: { trip: { tripId: 'tN', routeId: '1' }, vehicle: { id: '9' }, position: { latitude: 40.775, longitude: -73.95 } } },
      {
        id: 'gone',
        tripUpdate: {
          trip: { tripId: 'tG', routeId: '1' },
          stopTimeUpdate: [
            { stopId: 'B', departure: { time: T - 60 } },
            { stopId: 'C', arrival: { time: T + 100 } },
          ],
        },
      },
    ]);
    // Bravo's northbound platform, beside the southbound one.
    const withPlatform: GtfsFiles = (name) =>
      name in gtfs ? Readable.from([name === 'stops.txt' ? `${gtfs[name]}B2,Bravo,40.7900,-73.9502\n` : gtfs[name]]) : null;
    const index = buildStaticIndex(withPlatform);
    const store = new VehicleStore([train], {}, async () => snapshotFromFeed(decodeFeed(feed), T), () => index);
    await store.loadStatic();
    await store.pollAll();
    // A few meters off Bravo, as a tap on the map would be.
    const directions = store.arrivals('test-train:1', { lat: 40.7901, lon: -73.9501 }, T);
    expect(directions.map((d) => d.destinations)).toEqual([['Charlie'], ['Alpha']]);
    expect(directions[0].arrivals.map((a) => [a.vehicle.id, a.time, a.stopsAway])).toEqual([['test-train:tS', T + 120, 0]]);
    expect(directions[1].arrivals.map((a) => [a.vehicle.id, a.time, a.stopsAway])).toEqual([['test-train:9', T + 200, 1]]);
    expect(store.arrivals('test-train:1', { lat: 40.5, lon: -73.5 }, T)).toEqual([]);
    expect(store.arrivals('nope:1', { lat: 40.79, lon: -73.95 }, T)).toEqual([]);
  });

  it('lists a vehicle once when two of the feed URLs both report it', async () => {
    const trip = (tripId: string, at: number) => ({
      id: tripId,
      tripUpdate: { trip: { tripId, routeId: '1' }, stopTimeUpdate: [{ stopId: 'B', arrival: { time: at } }] },
    });
    const bus = (tripId: string, timestamp: number) => ({
      id: `v-${tripId}`,
      vehicle: { trip: { tripId, routeId: '1' }, vehicle: { id: '9' }, timestamp, position: { latitude: 40.785, longitude: -73.95 } },
    });
    // Each URL has the bus on a different trip; the newer report wins.
    const feeds: Record<string, Uint8Array> = {
      'https://example.test/a': encodeFeed([trip('t1', T + 60), trip('t2', T + 900), bus('t1', T - 5)]),
      'https://example.test/b': encodeFeed([trip('t1', T + 60), trip('t2', T + 900), bus('t2', T - 60)]),
    };
    const twoUrls: FeedConfig = { ...train, realtimeUrls: Object.keys(feeds) };
    const store = new VehicleStore([twoUrls], {}, async (url) => snapshotFromFeed(decodeFeed(feeds[url]), T), () => indexPromise);
    await store.loadStatic();
    await store.pollAll();
    const gps = store.vehicles(T).filter((v) => v.source === 'gps');
    expect(gps.map((v) => [v.id, v.tripId])).toEqual([['test-train:9', 't1']]);
    const arrivals = store.arrivals('test-train:1', { lat: 40.79, lon: -73.95 }, T).flatMap((d) => d.arrivals);
    expect(arrivals.map((a) => [a.vehicle.id, a.time])).toEqual([['test-train:9', T + 60]]);
  });
});

describe('VehicleStore.lineVehicles', () => {
  it('places each vehicle along the line, with the way it is going', async () => {
    const feed = encodeFeed([
      {
        id: 'south',
        tripUpdate: {
          trip: { tripId: 'tS', routeId: '1' },
          stopTimeUpdate: [
            { stopId: 'A', departure: { time: T - 30 } },
            { stopId: 'B', arrival: { time: T + 120 } },
            { stopId: 'C', arrival: { time: T + 300 } },
          ],
        },
      },
      {
        id: 'north',
        tripUpdate: {
          trip: { tripId: 'tN', routeId: '1' },
          stopTimeUpdate: [
            { stopId: 'B', arrival: { time: T + 20 } },
            { stopId: 'A', arrival: { time: T + 200 } },
          ],
        },
      },
      // Standing at Bravo.
      { id: 'n', vehicle: { trip: { tripId: 'tN', routeId: '1' }, vehicle: { id: '9' }, position: { latitude: 40.7901, longitude: -73.95 } } },
    ]);
    const store = new VehicleStore([train], {}, async () => snapshotFromFeed(decodeFeed(feed), T), () => indexPromise);
    await store.loadStatic();
    await store.pollAll();
    expect(store.routeLines(['test-train:1'])[0].stops.map((s) => s.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    const placed = store.lineVehicles('test-train:1', T);
    expect(placed.map((p) => [p.vehicle.id, p.at, p.heading, p.destination])).toEqual([
      ['test-train:tS', 0.5, 1, 'Charlie'],
      ['test-train:9', 1, -1, 'Alpha'],
    ]);
    expect(store.lineVehicles('nope:1', T)).toEqual([]);
    expect(store.lineCounts(T)).toEqual({ 'test-train:1': 2 });
  });
});

describe('API', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('says it is not ready until schedules and first positions are in', async () => {
    const { store } = makeStore({ TEST_BUS_KEY: 'k' });
    const server = createApiServer(store, () => T).listen(0);
    close = () => server.close();
    const health = () => fetch(`http://localhost:${(server.address() as AddressInfo).port}/api/health`);
    expect((await health()).status).toBe(503);
    await store.loadStatic();
    expect((await health()).status).toBe(503);
    await store.pollAll();
    const res = await health();
    expect(res.status).toBe(200);
    expect((await res.json()).ready).toBe(true);
  });

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
    const { lines } = await (await fetch(`${base}/api/route-lines?keys=test-train:1,test-train:nope`)).json();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ key: 'test-train:1', mode: 'subway', color: 'EE352E' });
    expect(lines[0].paths[0]).toHaveLength(5);
    expect(lines[0].paths[0][0]).toEqual([expect.any(Number), expect.any(Number)]);
    expect(lines[0].stops.map((st: { name: string }) => st.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    // Each station is drawn on the line itself.
    for (const st of lines[0].stops) expect(nearestOnPath(st, lines[0].paths[0]).meters).toBeLessThan(1);
    const tooMany = Array.from({ length: 61 }, (_, i) => `test-train:${i}`).join(',');
    expect((await fetch(`${base}/api/route-lines?keys=${tooMany}`)).status).toBe(400);
    // Every train line's path, without stations; buses are never drawn all at once.
    const paths = await (await fetch(`${base}/api/route-paths?modes=subway,bus`)).json();
    expect(paths.lines.map((l: { key: string }) => l.key)).toEqual(['test-train:1']);
    expect(paths.lines[0].stops).toBeUndefined();
    expect(paths.lines[0].paths[0]).toHaveLength(5);
    const { routes } = await (await fetch(`${base}/api/routes`)).json();
    expect(routes).toContainEqual({
      key: 'test-train:1',
      feed: 'test-train',
      agency: 'Test Transit',
      mode: 'subway',
      id: '1',
      name: '1',
      longName: 'Test Local',
      color: 'EE352E',
    });
  });
});

describe('the map page', () => {
  it('serves the built map, and the map page for any other path', async () => {
    const webDir = await mkdtemp(path.join(tmpdir(), 'web-'));
    await mkdir(path.join(webDir, 'assets'));
    await writeFile(path.join(webDir, 'index.html'), '<title>map</title>');
    await writeFile(path.join(webDir, 'assets', 'app-1234.js'), 'run()');
    await writeFile(path.join(webDir, 'assets', 'worker-1234.mjs'), 'work()');
    const { store } = makeStore({});
    const server = createApiServer(store, () => T, webDir).listen(0);
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      const page = await fetch(`${base}/?theme=dark`);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toBe('<title>map</title>');
      const script = await fetch(`${base}/assets/app-1234.js`);
      expect(script.headers.get('cache-control')).toContain('immutable');
      expect(await script.text()).toBe('run()');
      const worker = await fetch(`${base}/assets/worker-1234.mjs`);
      expect(worker.headers.get('content-type')).toBe('text/javascript');
      expect(await (await fetch(`${base}/somewhere/else`)).text()).toBe('<title>map</title>');
      expect(await (await fetch(`${base}/..%2f..%2fetc/passwd`)).text()).toBe('<title>map</title>');
      expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('link previews', () => {
  const page = `<title>NY Transit Live</title>
<meta name="description" content="default" />
<meta property="og:title" content="NY Transit Live" />
<meta property="og:description" content="default" />
<meta property="og:url" content="/" />
<meta property="og:image" content="/og-image.png" />
<meta name="twitter:title" content="NY Transit Live" />
<meta name="twitter:description" content="default" />
<meta name="twitter:image" content="/og-image.png" />`;
  const feed = encodeFeed([
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
  ]);

  it('names the train, line or station a shared link shows', async () => {
    const webDir = await mkdtemp(path.join(tmpdir(), 'web-'));
    await writeFile(path.join(webDir, 'index.html'), page);
    const store = new VehicleStore([train], {}, async () => snapshotFromFeed(decodeFeed(feed), T), () => indexPromise);
    await store.loadStatic();
    await store.pollAll();
    const server = createApiServer(store, () => T, webDir).listen(0);
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const open = (query: string, headers: Record<string, string> = {}) => fetch(`${base}/${query}`, { headers }).then((r) => r.text());
    try {
      // Render answers on https in front of the server, and says so.
      const plain = await open('', { 'x-forwarded-proto': 'https' });
      expect(plain).toContain(`<meta property="og:image" content="${base.replace('http:', 'https:')}/og-image.png" />`);
      expect(plain).toContain('<meta property="og:title" content="NY Transit Live" />');

      const vehicle = await open('?vehicle=test-train:tB&line=test-train:1');
      expect(vehicle).toContain('<title>The 1 train to Charlie · NY Transit Live</title>');
      expect(vehicle).toContain('<meta property="og:description" content="Next stop: Bravo. Watch this train move live');
      expect(vehicle).toContain('<meta property="og:url" content="http://localhost');

      // A trip that has ended shows its line.
      expect(await open('?vehicle=gone&line=test-train:1')).toContain('<meta property="og:title" content="The 1 line" />');
      expect(await open('?line=test-train:1&station=B')).toContain('<meta name="twitter:title" content="Bravo on the 1 line" />');
      expect(await open('?line=test-train:1')).toContain('Every station and train on the 1 line (Test Local)');
      expect(await open('?line=nope:1')).toContain('<title>NY Transit Live</title>');
      // Nothing from the link is written into the page unescaped.
      expect(await open('?line=x:%22%3E%3Cscript%3E')).not.toContain('<script>');
    } finally {
      server.close();
    }
  });
});

describe('buses', () => {
  const busFeedConfig: FeedConfig = {
    id: 'test-bus2',
    agency: 'Test Bus',
    mode: 'bus',
    realtimeUrls: ['https://example.test/vehiclePositions', 'https://example.test/tripUpdates'],
    staticUrls: ['https://example.test/bus.zip'],
    staticDetail: 'stops',
    agencyPrefixedIds: true,
    pollSeconds: 30,
  };
  // Bus Time prefixes ids with the agency; the schedule doesn't.
  const positions = encodeFeed([
    {
      id: 'v',
      vehicle: {
        vehicle: { id: 'MTA NYCT_7582' },
        trip: { tripId: 'MTA NYCT_t1', routeId: 'MTA NYCT_1' },
        position: { latitude: 40.8, longitude: -73.945 },
      },
    },
  ]);
  const updates = encodeFeed([
    {
      id: 'u',
      tripUpdate: {
        trip: { tripId: 'MTA NYCT_t1', routeId: 'MTA NYCT_1' },
        stopTimeUpdate: [
          { stopId: 'MTA_B', arrival: { time: T + 120 } },
          { stopId: 'MTA_C', arrival: { time: T + 300 } },
        ],
      },
    },
  ]);

  it('shows next stops and the route ahead for a GPS bus', async () => {
    const { buildStaticIndex } = await import('../src/static-gtfs.js');
    const { files } = await import('./fixtures.js');
    const busIndex = buildStaticIndex(files, 'stops');
    const store = new VehicleStore(
      [busFeedConfig],
      {},
      async (url) => snapshotFromFeed(decodeFeed(url.includes('vehiclePositions') ? positions : updates), T),
      () => busIndex,
    );
    await store.loadStatic();
    await store.pollAll();

    const [bus] = store.vehicles(T);
    expect(bus).toMatchObject({ id: 'test-bus2:MTA NYCT_7582', routeId: '1', routeName: '1', source: 'gps' });
    const detail = store.detail(bus.id, T)!;
    expect(detail.upcoming.map((u) => u.name)).toEqual(['Bravo', 'Charlie']);
    // Follows the trip's shape around the dog-leg to the last stop.
    expect(detail.path).toContainEqual([-73.94, 40.79]);
    expect(detail.path.at(-1)).toEqual([-73.95, 40.78]);
  });

  it('follows the shape when Bus Time sends a bare trip id with underscores in it', async () => {
    const { buildStaticIndex } = await import('../src/static-gtfs.js');
    const { gtfs } = await import('./fixtures.js');
    // Real bus trip ids look like `CH_D6-Weekday-SDon-085000_MISC_176`, and arrive without an agency prefix.
    const tripId = 'CH_D6-Weekday-085000_MISC_176';
    const renamed = (name: string) => (name in gtfs ? Readable.from([gtfs[name].replace(/\bt1\b/g, tripId)]) : null);
    const busIndex = buildStaticIndex(renamed, 'stops');
    const bare = (feed: Uint8Array) => {
      const msg = decodeFeed(feed);
      for (const e of msg.entity) {
        const trip = e.vehicle?.trip ?? e.tripUpdate?.trip;
        if (trip) Object.assign(trip, { tripId, routeId: '1' });
      }
      return msg;
    };
    const store = new VehicleStore(
      [busFeedConfig],
      {},
      async (url) => snapshotFromFeed(bare(url.includes('vehiclePositions') ? positions : updates), T),
      () => busIndex,
    );
    await store.loadStatic();
    await store.pollAll();

    const [bus] = store.vehicles(T);
    const detail = store.detail(bus.id, T)!;
    expect(detail.path).toContainEqual([-73.94, 40.79]);
  });
});

describe('visible area', () => {
  it('only works out positions for trips near the requested area', async () => {
    const { store } = makeStore({ TEST_BUS_KEY: 'k' });
    await store.loadStatic();
    await store.pollAll();
    // Far from the test line (near 40.79,-73.95) and the test bus: nothing returned.
    expect(store.vehicles(T, [-74.3, 40.5, -74.2, 40.6])).toEqual([]);
    expect(store.vehicles(T, [-73.96, 40.77, -73.94, 40.79]).map((v) => v.id)).toEqual(['test-train:tA']);
  });
});
