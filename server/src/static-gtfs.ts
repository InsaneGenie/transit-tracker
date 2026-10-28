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
}

/** Opens a file inside a GTFS feed, or returns null when the feed doesn't have it. */
export type GtfsFiles = (name: string) => Readable | null;

type Row = Record<string, string>;

async function* rows(files: GtfsFiles, name: string): AsyncGenerator<Row> {
  const input = files(name);
  if (!input) return;
  yield* input.pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }));
}

/** GTFS times can run past 24:00 for trips that continue after midnight. */
export function parseGtfsTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [h, m, s] = value.trim().split(':').map(Number);
  if ([h, m, s].some(Number.isNaN)) return undefined;
  return h * 3600 + m * 60 + s;
}

export async function buildStaticIndex(files: GtfsFiles): Promise<StaticIndex> {
  const stops = new Map<string, Stop>();
  for await (const r of rows(files, 'stops.txt')) {
    const lat = Number(r.stop_lat);
    const lon = Number(r.stop_lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) stops.set(r.stop_id, { name: r.stop_name, lat, lon });
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
  for await (const r of rows(files, 'trips.txt')) {
    trips.set(r.trip_id, { routeId: r.route_id, shapeId: r.shape_id || undefined });
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
  const flushTrip = (tripId: string, times: StopTime[]) => {
    const trip = trips.get(tripId);
    if (!trip) return;
    times.sort((a, b) => a.seq - b.seq);
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
  for await (const r of rows(files, 'stop_times.txt')) {
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

  return { stops, routes, segments, shapes };
}

export function zipFiles(zip: Buffer): GtfsFiles {
  const archive = new AdmZip(zip);
  return (name) => {
    const entry = archive.getEntries().find((e) => path.basename(e.entryName) === name);
    return entry ? Readable.from([entry.getData()]) : null;
  };
}

const CACHE_DIR = path.resolve(import.meta.dirname, '../data/cache');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Downloads a static GTFS zip, reusing a copy from the last day when there is one. */
export async function loadStaticIndex(feedId: string, url: string): Promise<StaticIndex> {
  const file = path.join(CACHE_DIR, `${feedId}.zip`);
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
  return buildStaticIndex(zipFiles(zip));
}
