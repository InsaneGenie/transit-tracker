import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse';
import { Polyline, type LatLon } from './geo.js';

export interface Stop extends LatLon {
  name: string;
}

export interface Route {
  shortName: string;
  longName: string;
  color?: string;
  textColor?: string;
}

/** The usual stop a vehicle comes from on its way to a stop, and how long that hop takes. */
export interface Segment {
  fromStopId: string;
  toStopId: string;
  seconds: number;
  shapeId?: string;
}

export interface StaticIndex {
  stops: Map<string, Stop>;
  routes: Map<string, Route>;
  /** Keyed by `${routeId}|${toStopId}`, with `*|${toStopId}` as a fallback for any route. */
  segments: Map<string, Segment>;
  shapes: Map<string, Polyline>;
  /** Shape of each scheduled trip, for feeds whose realtime trip ids match the schedule's. */
  tripShapes: Map<string, string>;
  /** Every shape a route's trips follow, for drawing the whole line. */
  routeShapes: Map<string, Set<string>>;
  /**
   * The routes that regularly call at each stop, counting stations you can walk to inside the station
   * (Times Sq has the 1 2 3, N Q R W, S and 7). Keyed by any stop id, platform or station.
   */
  stopRoutes: Map<string, string[]>;
  /** The stations each route regularly calls at, as station ids. */
  routeStations: Map<string, string[]>;
}

/** Opens a file inside a GTFS feed, or returns null when the feed doesn't have it. */
export type GtfsFiles = (name: string) => Readable | null;

type Row = Record<string, string>;

async function* rows(files: GtfsFiles, name: string): AsyncGenerator<Row> {
  const input = files(name);
  if (!input) return;
  let count = 0;
  for await (const row of input.pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }))) {
    yield row;
    // Let requests in now and then. Reading a schedule otherwise holds the server for seconds at a time,
    // which on a small cloud instance is long enough for the host to decide the server has died.
    if (++count % 2000 === 0) await breather();
  }
}

const breather = () => new Promise((resolve) => setImmediate(resolve));

/** GTFS times can run past 24:00 for trips that continue after midnight. */
export function parseGtfsTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [h, m, s] = value.trim().split(':').map(Number);
  if ([h, m, s].some(Number.isNaN)) return undefined;
  return h * 3600 + m * 60 + s;
}

export async function buildStaticIndex(files: GtfsFiles, detail: 'full' | 'stops' = 'full'): Promise<StaticIndex> {
  const stops = new Map<string, Stop>();
  // Platforms (127N, 127S) belong to a station (127).
  const stationOf = new Map<string, string>();
  for await (const r of rows(files, 'stops.txt')) {
    const lat = Number(r.stop_lat);
    const lon = Number(r.stop_lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) stops.set(r.stop_id, { name: r.stop_name, lat, lon });
    if (r.parent_station) stationOf.set(r.stop_id, r.parent_station);
  }

  const routes = new Map<string, Route>();
  for await (const r of rows(files, 'routes.txt')) {
    routes.set(r.route_id, {
      shortName: r.route_short_name ?? '',
      longName: r.route_long_name ?? '',
      color: r.route_color || undefined,
      textColor: r.route_text_color || undefined,
    });
  }

  const trips = new Map<string, { routeId: string; shapeId?: string }>();
  const tripShapes = new Map<string, string>();
  const routeShapes = new Map<string, Set<string>>();
  for await (const r of rows(files, 'trips.txt')) {
    trips.set(r.trip_id, { routeId: r.route_id, shapeId: r.shape_id || undefined });
    if (!r.shape_id) continue;
    tripShapes.set(r.trip_id, r.shape_id);
    let shapeIds = routeShapes.get(r.route_id);
    if (!shapeIds) routeShapes.set(r.route_id, (shapeIds = new Set()));
    shapeIds.add(r.shape_id);
  }

  const shapePoints = new Map<string, { seq: number; lat: number; lon: number }[]>();
  for await (const r of rows(files, 'shapes.txt')) {
    let pts = shapePoints.get(r.shape_id);
    if (!pts) shapePoints.set(r.shape_id, (pts = []));
    pts.push({ seq: Number(r.shape_pt_sequence), lat: Number(r.shape_pt_lat), lon: Number(r.shape_pt_lon) });
  }
  const shapes = new Map<string, Polyline>();
  for (const [id, pts] of shapePoints) {
    pts.sort((a, b) => a.seq - b.seq);
    shapes.set(id, new Polyline(pts.map(({ lat, lon }) => ({ lat, lon }))));
    if (shapes.size % 100 === 0) await breather();
  }

  // Tally every consecutive pair of stops across all trips, per route and for any route.
  type Tally = { count: number; totalSeconds: number; shapeId?: string };
  const tallies = new Map<string, Map<string, Tally>>();
  const tally = (key: string, from: string, seconds: number, shapeId?: string) => {
    let byFrom = tallies.get(key);
    if (!byFrom) tallies.set(key, (byFrom = new Map()));
    const t = byFrom.get(from) ?? { count: 0, totalSeconds: 0, shapeId };
    t.count++;
    t.totalSeconds += seconds;
    t.shapeId ??= shapeId;
    byFrom.set(from, t);
  };

  type StopTime = { seq: number; stopId: string; arrival?: number; departure?: number };
  // How many scheduled calls each route makes at each station.
  const calls = new Map<string, Map<string, number>>();
  const flushTrip = (tripId: string, times: StopTime[]) => {
    const trip = trips.get(tripId);
    if (!trip) return;
    times.sort((a, b) => a.seq - b.seq);
    for (const t of times) {
      const station = stationOf.get(t.stopId) ?? t.stopId;
      let byRoute = calls.get(station);
      if (!byRoute) calls.set(station, (byRoute = new Map()));
      byRoute.set(trip.routeId, (byRoute.get(trip.routeId) ?? 0) + 1);
    }
    for (let i = 1; i < times.length; i++) {
      const prev = times[i - 1];
      const cur = times[i];
      const left = prev.departure ?? prev.arrival;
      const arrived = cur.arrival ?? cur.departure;
      if (left === undefined || arrived === undefined || arrived < left) continue;
      tally(`${trip.routeId}|${cur.stopId}`, prev.stopId, arrived - left, trip.shapeId);
      tally(`*|${cur.stopId}`, prev.stopId, arrived - left, trip.shapeId);
    }
  };

  let currentTrip: string | undefined;
  let buffer: StopTime[] = [];
  const stopTimes = detail === 'full' ? rows(files, 'stop_times.txt') : [];
  for await (const r of stopTimes) {
    if (r.trip_id !== currentTrip) {
      if (currentTrip) flushTrip(currentTrip, buffer);
      currentTrip = r.trip_id;
      buffer = [];
    }
    buffer.push({
      seq: Number(r.stop_sequence),
      stopId: r.stop_id,
      arrival: parseGtfsTime(r.arrival_time),
      departure: parseGtfsTime(r.departure_time),
    });
  }
  if (currentTrip) flushTrip(currentTrip, buffer);

  const segments = new Map<string, Segment>();
  for (const [key, byFrom] of tallies) {
    let best: [string, Tally] | undefined;
    for (const entry of byFrom) if (!best || entry[1].count > best[1].count) best = entry;
    if (!best) continue;
    const [fromStopId, t] = best;
    segments.set(key, {
      fromStopId,
      toStopId: key.slice(key.indexOf('|') + 1),
      seconds: t.totalSeconds / t.count,
      shapeId: t.shapeId,
    });
  }

  const transfers = new Map<string, Set<string>>();
  for await (const r of rows(files, 'transfers.txt')) {
    const from = stationOf.get(r.from_stop_id) ?? r.from_stop_id;
    const to = stationOf.get(r.to_stop_id) ?? r.to_stop_id;
    if (from === to || r.transfer_type === '3') continue; // 3 means no transfer is possible
    let set = transfers.get(from);
    if (!set) transfers.set(from, (set = new Set()));
    set.add(to);
  }

  return { stops, routes, segments, shapes, tripShapes, routeShapes, ...routesByStop(stops, stationOf, calls, transfers) };
}

/**
 * A route counts at a station when it calls there at least a quarter as often as at its busiest station,
 * so the 2 train, which runs local only overnight, isn't listed at every local stop.
 */
const REGULAR_SHARE = 0.25;

function routesByStop(
  stops: Map<string, Stop>,
  stationOf: Map<string, string>,
  calls: Map<string, Map<string, number>>,
  transfers: Map<string, Set<string>>,
): Pick<StaticIndex, 'stopRoutes' | 'routeStations'> {
  const busiest = new Map<string, number>();
  for (const byRoute of calls.values()) {
    for (const [route, n] of byRoute) busiest.set(route, Math.max(busiest.get(route) ?? 0, n));
  }
  const regular = (station: string) =>
    [...(calls.get(station) ?? [])].filter(([route, n]) => n >= busiest.get(route)! * REGULAR_SHARE).map(([route]) => route);

  const routeStations = new Map<string, string[]>();
  for (const station of calls.keys()) {
    for (const route of regular(station)) routeStations.set(route, [...(routeStations.get(route) ?? []), station]);
  }

  const byStation = new Map<string, string[]>();
  for (const station of calls.keys()) {
    const all = new Set([station, ...(transfers.get(station) ?? [])].flatMap(regular));
    if (all.size) byStation.set(station, [...all]);
  }
  const out = new Map(byStation);
  for (const id of stops.keys()) {
    const routes = byStation.get(stationOf.get(id) ?? id);
    if (routes) out.set(id, routes);
  }
  return { stopRoutes: out, routeStations };
}

/** Combines several schedules, such as one per borough, into one index. */
export function mergeIndexes(indexes: StaticIndex[]): StaticIndex {
  const merged: StaticIndex = {
    stops: new Map(),
    routes: new Map(),
    segments: new Map(),
    shapes: new Map(),
    tripShapes: new Map(),
    routeShapes: new Map(),
    stopRoutes: new Map(),
    routeStations: new Map(),
  };
  for (const index of indexes) {
    for (const key of Object.keys(merged) as (keyof StaticIndex)[]) {
      if (key === 'routeShapes') continue;
      const target = merged[key] as Map<string, unknown>;
      for (const [k, v] of index[key] as Map<string, unknown>) if (!target.has(k)) target.set(k, v);
    }
    // A route can run in several schedules (a bus crossing boroughs), so keep the shapes from each.
    for (const [routeId, shapeIds] of index.routeShapes) {
      merged.routeShapes.set(routeId, new Set([...(merged.routeShapes.get(routeId) ?? []), ...shapeIds]));
    }
  }
  return merged;
}

export function zipFiles(zip: Buffer): GtfsFiles {
  const archive = new AdmZip(zip);
  return (name) => {
    const entry = archive.getEntries().find((e) => path.basename(e.entryName) === name);
    return entry ? Readable.from(chunks(entry.getData())) : null;
  };
}

/** Small pieces, so the CSV parser reads a big file a little at a time instead of every row at once. */
function* chunks(data: Buffer, size = 64 * 1024): Generator<Buffer> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}

const CACHE_DIR = path.resolve(import.meta.dirname, '../data/cache');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Downloads a feed's static GTFS zips, reusing copies from the last day, and indexes them as one. */
export async function loadStaticIndex(
  feedId: string,
  urls: string[],
  detail: 'full' | 'stops' = 'full',
): Promise<StaticIndex> {
  const indexes = [];
  for (const url of urls) indexes.push(await buildStaticIndex(zipFiles(await download(feedId, url)), detail));
  return indexes.length === 1 ? indexes[0] : mergeIndexes(indexes);
}

async function download(feedId: string, url: string): Promise<Buffer> {
  const file = path.join(CACHE_DIR, `${feedId}-${path.basename(new URL(url).pathname)}`);
  let zip: Buffer | undefined;
  try {
    if (Date.now() - (await stat(file)).mtimeMs < MAX_AGE_MS) zip = await readFile(file);
  } catch {
    // not cached yet
  }
  if (!zip) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`static GTFS ${url} returned ${res.status}`);
    zip = Buffer.from(await res.arrayBuffer());
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, zip);
  }
  return zip;
}
