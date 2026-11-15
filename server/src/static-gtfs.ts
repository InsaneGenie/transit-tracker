import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { createInflateRaw } from 'node:zlib';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse';
import { Polyline, type LatLon } from './geo.js';
import { emptyCalendar, type ServiceCalendar, type TimingPoint, type TripEnd } from './schedule.js';
import type { Timetable } from './timetable.js';

export interface Stop extends LatLon {
  name: string;
  /** Step-free from the street to the trains: every platform, or only some of them. */
  access?: Access;
  /** What a partly accessible station's step-free route reaches, like "only toward Manhattan". */
  accessNote?: string;
}

export type Access = 'full' | 'partial';

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
  /** The stations each route regularly calls at, as station ids; for stops-only schedules, in order, one way. */
  routeStations: Map<string, string[]>;
  /** Which days each service runs. */
  calendar: ServiceCalendar;
  /** For the report cards: one stop mid-line each way, with when trips are due there (see ReportKind). */
  timingPoints: TimingPoint[];
  /**
   * For the report cards: when each trip is due at the end of its run, by trip id and by
   * `${routeId}|${firstStopId}|${startSeconds}`, which several days' services can share (see ReportKind).
   */
  tripEnds: Map<string, TripEnd[]>;
  /** Every trip with its times and days, for a feed placed from its timetable (FeedConfig.timetable). */
  timetable?: Timetable;
  /**
   * When each scheduled trip runs, for stops-only schedules (buses), to tell which trips should be out on
   * the road. One per schedule read: a merged index keeps each, as their service and block ids are their own.
   */
  busSchedules: BusSchedule[];
}

/** The days a service runs, from calendar.txt and calendar_dates.txt. */
export interface Service {
  /** Monday is bit 0, Sunday bit 6. */
  days: number;
  /** YYYYMMDD, inclusive. */
  start: string;
  end: string;
  added: Set<string>;
  removed: Set<string>;
}

/** One route's scheduled trips, column by column so a city's worth of bus trips stays small. */
export interface RouteTrips {
  tripIds: string[];
  /** Index into the schedule's `serviceIds`. */
  service: Uint16Array;
  /** direction_id: 0 or 1. */
  direction: Uint8Array;
  /** The vehicle's day of work the trip is part of (block_id), as a number; -1 when unknown. */
  block: Int32Array;
  /** Index into `headsigns`. */
  headsign: Uint16Array;
  headsigns: string[];
  /** Scheduled first departure and last arrival, in seconds after the service day's midnight; -1 when unknown. */
  start: Int32Array;
  end: Int32Array;
  /** The direction of the trip `routeStations` lists the stops of, when it was this schedule's. */
  listedDirection?: number;
}

export interface BusSchedule {
  serviceIds: string[];
  services: Map<string, Service>;
  routes: Map<string, RouteTrips>;
}

/**
 * What the report cards need from a schedule. "gaps" times trips at a stop mid-line, for how evenly they
 * come (subway and bus). "ontime" keeps when each trip is due at the end of its run (rail, which runs
 * to a timetable). Either is small next to the rest of the index.
 */
export type ReportKind = 'gaps' | 'ontime' | 'none';

/** Rail feeds whose realtime trip ids are the schedule's also keep each trip's end by its id. */
export type ReportOptions = ReportKind | 'ontime-by-id';

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

/** Splits one CSV line, handling quoted fields only when the line has any. */
function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') field += line[i++];
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** The field at `at` in a line with no quotes. */
function fieldAt(line: string, at: number): string {
  let start = 0;
  for (let i = 0; i < at; i++) {
    const comma = line.indexOf(',', start);
    if (comma < 0) return '';
    start = comma + 1;
  }
  const end = line.indexOf(',', start);
  return end < 0 ? line.slice(start) : line.slice(start, end);
}

/**
 * The rows of a big file whose `column` is in `wanted`, skimming the rest without parsing them. A bus
 * schedule's stop times run to millions of rows; a full CSV parse of them is too slow for a small server.
 */
async function* rowsWhere(
  files: GtfsFiles,
  name: string,
  column: string,
  wanted: Set<string>,
  spans?: (value: string, first: number | undefined, last: number | undefined) => void,
): AsyncGenerator<Row> {
  const input = files(name);
  if (!input) return;
  let header: string[] | undefined;
  let at = -1;
  // Each run of rows with the same value: its first and last row's time. Stop times come grouped by trip and
  // in order, so those are when the trip starts and ends, found without reading the times of every row.
  let times: [number, number] = [-1, -1];
  let runValue: string | undefined;
  let runFirst = '';
  let runLast = '';
  const timeOf = (line: string) => timeInLine(line, times[0]) ?? timeInLine(line, times[1]);
  const endRun = () => {
    if (spans && runValue !== undefined) spans(runValue, timeOf(runFirst), timeOf(runLast));
  };
  let rest = '';
  let count = 0;
  // Keeps a character split between two chunks whole.
  const decoder = new StringDecoder('utf8');
  for await (const chunk of input) {
    const lines = (rest + decoder.write(chunk)).split('\n');
    rest = lines.pop()!;
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!header) {
        header = splitCsv(line.replace(/^\uFEFF/, '')).map((h) => h.trim());
        at = header.indexOf(column);
        if (at < 0) return;
        times = [header.indexOf('departure_time'), header.indexOf('arrival_time')];
        continue;
      }
      if (!line) continue;
      // The trip id usually leads the row, so most rows are passed over on their first field.
      // Another column is found without splitting the whole line, unless it has quotes.
      const value = line.includes('"') ? splitCsv(line)[at] : at === 0 ? line.slice(0, line.indexOf(',')) : fieldAt(line, at);
      if (spans) {
        if (value !== runValue) {
          endRun();
          runValue = value;
          runFirst = line;
        }
        runLast = line;
      }
      if (!wanted.has(value)) continue;
      const fields = splitCsv(line);
      yield Object.fromEntries(header.map((h, i) => [h, fields[i] ?? '']));
    }
    if (++count % 20 === 0) await breather();
  }
  if (rest && header) {
    const line = rest.endsWith('\r') ? rest.slice(0, -1) : rest;
    const fields = splitCsv(line);
    if (spans) {
      if (fields[at] !== runValue) {
        endRun();
        runValue = fields[at];
        runFirst = line;
      }
      runLast = line;
    }
    if (wanted.has(fields[at])) yield Object.fromEntries(header.map((h, i) => [h, fields[i] ?? '']));
  }
  endRun();
}

/**
 * The GTFS time in a line's `column`, read in place: splitting every trip's first and last stop time into
 * fields made enough garbage to swell the server's memory while reading a bus schedule.
 */
export function timeInLine(line: string, column: number): number | undefined {
  if (column < 0) return undefined;
  if (line.includes('"')) return parseGtfsTime(splitCsv(line)[column]);
  let at = 0;
  for (let c = 0; c < column; c++) {
    at = line.indexOf(',', at) + 1;
    if (at === 0) return undefined;
  }
  // h:mm:ss or hh:mm:ss, the hours running past 24 after midnight.
  let value = 0;
  let part = 0;
  let parts = 0;
  let digits = 0;
  for (let i = at; i <= line.length; i++) {
    const code = i < line.length ? line.charCodeAt(i) : 44;
    if (code >= 48 && code <= 57) {
      part = part * 10 + code - 48;
      digits++;
    } else if (code === 58 || code === 44) {
      if (!digits) return undefined;
      value = value * 60 + part;
      parts++;
      part = 0;
      digits = 0;
      if (code === 44) break;
    } else if (code !== 32) return undefined;
  }
  return parts === 3 ? value : undefined;
}

/** GTFS times can run past 24:00 for trips that continue after midnight. */
export function parseGtfsTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [h, m, s] = value.trim().split(':').map(Number);
  if ([h, m, s].some(Number.isNaN)) return undefined;
  return h * 3600 + m * 60 + s;
}

export async function buildStaticIndex(
  files: GtfsFiles,
  detail: 'full' | 'stops' = 'full',
  options: ReportOptions = 'none',
): Promise<StaticIndex> {
  const report: ReportKind = options === 'ontime-by-id' ? 'ontime' : options;
  const stops = new Map<string, Stop>();
  // Platforms (127N, 127S) belong to a station (127).
  const stationOf = new Map<string, string>();
  for await (const r of rows(files, 'stops.txt')) {
    const lat = Number(r.stop_lat);
    const lon = Number(r.stop_lon);
    // 1 is step-free, 2 is not, and blank or 0 means unknown (or, for a platform, the same as its station).
    const access = r.wheelchair_boarding?.trim() === '1' ? 'full' : undefined;
    if (Number.isFinite(lat) && Number.isFinite(lon)) stops.set(r.stop_id, { name: r.stop_name, lat, lon, ...(access && { access }) });
    if (r.parent_station) stationOf.set(r.stop_id, r.parent_station);
  }
  for (const [id, station] of stationOf) {
    const stop = stops.get(id);
    const access = stops.get(station)?.access;
    if (stop && access && !stop.access) stop.access = access;
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

  const trips = new Map<string, { routeId: string; shapeId?: string; serviceId: string; direction: string }>();
  const tripShapes = new Map<string, string>();
  const routeShapes = new Map<string, Set<string>>();
  // Without every stop time, a route's stops come from one typical trip each way: one that follows the
  // shape most of its trips that way take.
  const patterns = new Map<string, Map<string, { count: number; tripId: string }>>();
  const timed = detail === 'stops' ? new BusScheduleBuilder() : undefined;
  for await (const r of rows(files, 'trips.txt')) {
    trips.set(r.trip_id, { routeId: r.route_id, shapeId: r.shape_id || undefined, serviceId: r.service_id ?? '', direction: r.direction_id ?? '' });
    timed?.addTrip(r);
    if (detail === 'stops' || report === 'gaps') {
      const way = `${r.route_id}|${r.direction_id ?? ''}`;
      let byShape = patterns.get(way);
      if (!byShape) patterns.set(way, (byShape = new Map()));
      const shape = byShape.get(r.shape_id ?? '') ?? { count: 0, tripId: r.trip_id };
      shape.count++;
      byShape.set(r.shape_id ?? '', shape);
    }
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
    if (typicalWay.has(tripId)) typicalStops.set(tripId, times.map((t) => t.stopId));
    if (report === 'ontime' && times.length >= 2) {
      const first = times[0];
      const last = times.at(-1)!;
      const start = first.departure ?? first.arrival;
      const seconds = last.arrival ?? last.departure;
      if (seconds !== undefined) {
        const service = intern(trip.serviceId);
        if (options === 'ontime-by-id') tripEnds.set(tripId, [{ routeId: trip.routeId, serviceIds: [service], stopId: last.stopId, seconds }]);
        // The same train runs under many services (Metro-North has one per week or so), so they share one entry.
        if (start !== undefined) {
          const key = `${trip.routeId}|${first.stopId}|${start}`;
          let ends = tripEnds.get(key);
          if (!ends) tripEnds.set(key, (ends = []));
          const same = ends.find((e) => e.stopId === last.stopId && e.seconds === seconds);
          if (!same) ends.push({ routeId: trip.routeId, serviceIds: [service], stopId: last.stopId, seconds });
          else if (!same.serviceIds.includes(service)) same.serviceIds.push(service);
        }
      }
    }
    // One typical trip says nothing about usual travel times.
    if (detail === 'stops') {
      if (listed.get(trip.routeId)?.tripId === tripId) listedStops.set(trip.routeId, times.map((t) => t.stopId));
      return;
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
  const typical = new Set<string>();
  // Each way's typical trip, and the stops it makes, for picking the stops the report cards time trips at.
  const typicalWay = new Map<string, string>();
  const typicalStops = new Map<string, string[]>();
  const tripEnds = new Map<string, TripEnd[]>();
  // One copy of each service id, however many trips name it.
  const serviceIds = new Map<string, string>();
  const intern = (id: string) => serviceIds.get(id) ?? (serviceIds.set(id, id), id);
  // The busier direction's typical trip lists the route's stops, in order, one side of the street.
  const listed = new Map<string, { tripId: string; trips: number }>();
  for (const [way, byShape] of patterns) {
    const usual = [...byShape.values()].reduce((a, b) => (b.count > a.count ? b : a));
    typical.add(usual.tripId);
    if (report === 'gaps') typicalWay.set(usual.tripId, way);
    const routeId = way.slice(0, way.lastIndexOf('|'));
    const trips = [...byShape.values()].reduce((n, b) => n + b.count, 0);
    if (trips > (listed.get(routeId)?.trips ?? 0)) listed.set(routeId, { tripId: usual.tripId, trips });
  }
  patterns.clear();
  const listedStops = new Map<string, string[]>();
  const stopTimes =
    detail === 'full'
      ? rows(files, 'stop_times.txt')
      : rowsWhere(files, 'stop_times.txt', 'trip_id', typical, (tripId, first, last) => timed?.setSpan(tripId, first, last));
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
  const timingPoints = report === 'gaps' ? await timeTrips(files, trips, typicalWay, typicalStops) : [];
  typicalStops.clear();

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

  const byStop = routesByStop(stops, stationOf, calls, transfers);
  if (detail === 'stops') byStop.routeStations = listedStops;
  const busSchedules: BusSchedule[] = [];
  if (timed) {
    for await (const r of rows(files, 'calendar.txt')) timed.addService(r);
    for await (const r of rows(files, 'calendar_dates.txt')) timed.addException(r);
    busSchedules.push(timed.build(new Map([...listed].map(([routeId, l]) => [routeId, l.tripId]))));
  }

  const calendar = await readCalendar(files);
  return { stops, routes, segments, shapes, tripShapes, routeShapes, ...byStop, calendar, timingPoints, tripEnds, busSchedules };
}

/** Fewer stops than this and a trip has no middle worth timing. */
const MIN_TIMED_STOPS = 3;

/**
 * Picks the stop halfway along each way's typical trip and reads when every trip that way is due there.
 * That means reading the stop times a second time, keeping only the rows at those stops: for the buses,
 * about four seconds on a laptop, where reading every row with a full parse would take far longer.
 */
async function timeTrips(
  files: GtfsFiles,
  trips: Map<string, { routeId: string; serviceId: string; direction: string }>,
  typicalWay: Map<string, string>,
  typicalStops: Map<string, string[]>,
): Promise<TimingPoint[]> {
  const points = new Map<string, TimingPoint>();
  for (const [tripId, stopIds] of typicalStops) {
    const trip = trips.get(tripId);
    if (!trip || !typicalWay.has(tripId) || stopIds.length < MIN_TIMED_STOPS) continue;
    const stopId = stopIds[Math.floor(stopIds.length / 2)];
    points.set(`${trip.routeId}|${trip.direction}|${stopId}`, {
      routeId: trip.routeId,
      direction: trip.direction,
      stopId,
      towardStopId: stopIds.at(-1),
      times: new Map(),
    });
  }
  const stopIds = new Set([...points.values()].map((p) => p.stopId));
  for await (const r of rowsWhere(files, 'stop_times.txt', 'stop_id', stopIds)) {
    const trip = trips.get(r.trip_id);
    const point = trip && points.get(`${trip.routeId}|${trip.direction}|${r.stop_id}`);
    const seconds = parseGtfsTime(r.arrival_time) ?? parseGtfsTime(r.departure_time);
    if (!point || seconds === undefined) continue;
    let times = point.times.get(trip.serviceId);
    if (!times) point.times.set(trip.serviceId, (times = []));
    times.push(seconds);
  }
  for (const point of points.values()) for (const times of point.times.values()) times.sort((a, b) => a - b);
  return [...points.values()].filter((p) => p.times.size);
}

/** Which days each service runs, from calendar.txt and calendar_dates.txt (either may be missing). */
async function readCalendar(files: GtfsFiles): Promise<ServiceCalendar> {
  const calendar = emptyCalendar();
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for await (const r of rows(files, 'calendar.txt')) {
    const days = DAYS.reduce((bits, day, i) => (r[day]?.trim() === '1' ? bits | (1 << i) : bits), 0);
    calendar.weekly.set(r.service_id, { days, start: r.start_date?.trim() ?? '', end: r.end_date?.trim() ?? '' });
  }
  for await (const r of rows(files, 'calendar_dates.txt')) {
    const date = r.date?.trim();
    const into = r.exception_type?.trim() === '1' ? calendar.added : r.exception_type?.trim() === '2' ? calendar.removed : undefined;
    if (!date || !into) continue;
    let set = into.get(date);
    if (!set) into.set(date, (set = new Set()));
    set.add(r.service_id);
  }
  return calendar;
}

/** Gathers a stops-only schedule's trips, then packs them into a BusSchedule. */
class BusScheduleBuilder {
  private serviceIds: string[] = [];
  private serviceIndex = new Map<string, number>();
  private services = new Map<string, Service>();
  private blocks = new Map<string, number>();
  /** By route: the trips in the order read, and each trip's place in them by id. */
  private byRoute = new Map<string, { tripIds: string[]; service: number[]; direction: number[]; block: number[]; headsign: number[]; headsigns: string[]; start: number[]; end: number[] }>();
  private place = new Map<string, { routeId: string; i: number }>();

  addTrip(r: Row): void {
    let route = this.byRoute.get(r.route_id);
    if (!route) {
      route = { tripIds: [], service: [], direction: [], block: [], headsign: [], headsigns: [], start: [], end: [] };
      this.byRoute.set(r.route_id, route);
    }
    let service = this.serviceIndex.get(r.service_id);
    if (service === undefined) {
      service = this.serviceIds.push(r.service_id) - 1;
      this.serviceIndex.set(r.service_id, service);
    }
    let block = -1;
    if (r.block_id) {
      block = this.blocks.get(r.block_id) ?? this.blocks.size;
      this.blocks.set(r.block_id, block);
    }
    const sign = r.trip_headsign?.trim() ?? '';
    let headsign = route.headsigns.indexOf(sign);
    if (headsign < 0) headsign = route.headsigns.push(sign) - 1;
    this.place.set(r.trip_id, { routeId: r.route_id, i: route.tripIds.length });
    route.tripIds.push(r.trip_id);
    route.service.push(service);
    route.direction.push(r.direction_id === '1' ? 1 : 0);
    route.block.push(block);
    route.headsign.push(headsign);
    route.start.push(-1);
    route.end.push(-1);
  }

  setSpan(tripId: string, first: number | undefined, last: number | undefined): void {
    const at = this.place.get(tripId);
    if (!at || first === undefined || last === undefined) return;
    const route = this.byRoute.get(at.routeId)!;
    const [start, end] = first <= last ? [first, last] : [last, first];
    // A trip's rows should come together, but if they don't, take in every run of them.
    route.start[at.i] = route.start[at.i] < 0 ? start : Math.min(route.start[at.i], start);
    route.end[at.i] = Math.max(route.end[at.i], end);
  }

  addService(r: Row): void {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].reduce(
      (bits, day, i) => (r[day]?.trim() === '1' ? bits | (1 << i) : bits),
      0,
    );
    const service = this.serviceOf(r.service_id);
    Object.assign(service, { days, start: r.start_date?.trim() ?? '', end: r.end_date?.trim() ?? '' });
  }

  addException(r: Row): void {
    const date = r.date?.trim();
    if (!date) return;
    const service = this.serviceOf(r.service_id);
    if (r.exception_type?.trim() === '1') service.added.add(date);
    else if (r.exception_type?.trim() === '2') service.removed.add(date);
  }

  private serviceOf(id: string): Service {
    let service = this.services.get(id);
    if (!service) this.services.set(id, (service = { days: 0, start: '', end: '', added: new Set(), removed: new Set() }));
    return service;
  }

  /** `listed` names, by route, the trip whose stops the route's station list was taken from. */
  build(listed: Map<string, string>): BusSchedule {
    const routes = new Map<string, RouteTrips>();
    for (const [routeId, r] of this.byRoute) {
      const listedAt = listed.has(routeId) ? this.place.get(listed.get(routeId)!) : undefined;
      routes.set(routeId, {
        tripIds: r.tripIds,
        service: Uint16Array.from(r.service),
        direction: Uint8Array.from(r.direction),
        block: Int32Array.from(r.block),
        headsign: Uint16Array.from(r.headsign),
        headsigns: r.headsigns,
        start: Int32Array.from(r.start),
        end: Int32Array.from(r.end),
        ...(listedAt && { listedDirection: r.direction[listedAt.i] }),
      });
    }
    return { serviceIds: this.serviceIds, services: this.services, routes };
  }
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

const tripCount = (p: TimingPoint) => [...p.times.values()].reduce((n, t) => n + t.length, 0);

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
    calendar: emptyCalendar(),
    timingPoints: [],
    tripEnds: new Map(),
    busSchedules: [],
  };
  for (const index of indexes) {
    merged.busSchedules.push(...index.busSchedules);
    for (const key of Object.keys(merged) as (keyof StaticIndex)[]) {
      if (['routeShapes', 'routeStations', 'stopRoutes', 'calendar', 'timingPoints', 'tripEnds', 'busSchedules'].includes(key)) continue;
      const target = merged[key] as Map<string, unknown>;
      for (const [k, v] of index[key] as Map<string, unknown>) if (!target.has(k)) target.set(k, v);
    }
    // A route can run in several schedules (a bus crossing boroughs), so keep the shapes from each.
    for (const [routeId, shapeIds] of index.routeShapes) {
      merged.routeShapes.set(routeId, new Set([...(merged.routeShapes.get(routeId) ?? []), ...shapeIds]));
    }
    for (const key of ['routeStations', 'stopRoutes'] as const) {
      for (const [id, list] of index[key]) merged[key].set(id, [...new Set([...(merged[key].get(id) ?? []), ...list])]);
    }
    // Each borough's buses have their own service ids, so their calendars just add up.
    for (const [id, s] of index.calendar.weekly) merged.calendar.weekly.set(id, s);
    for (const key of ['added', 'removed'] as const) {
      for (const [date, ids] of index.calendar[key]) merged.calendar[key].set(date, new Set([...(merged.calendar[key].get(date) ?? []), ...ids]));
    }
    for (const point of index.timingPoints) {
      const same = merged.timingPoints.find((p) => p.routeId === point.routeId && p.direction === point.direction);
      if (!same) merged.timingPoints.push(point);
      else if (same.stopId === point.stopId) {
        for (const [service, times] of point.times) same.times.set(service, [...(same.times.get(service) ?? []), ...times].sort((a, b) => a - b));
      } else if (tripCount(point) > tripCount(same)) merged.timingPoints[merged.timingPoints.indexOf(same)] = point;
    }
    for (const [key, ends] of index.tripEnds) merged.tripEnds.set(key, [...(merged.tripEnds.get(key) ?? []), ...ends]);
  }
  return merged;
}

export function zipFiles(zip: Buffer): GtfsFiles {
  const archive = new AdmZip(zip);
  return (name) => {
    const entry = archive.getEntries().find((e) => path.basename(e.entryName) === name);
    if (!entry) return null;
    // Unpack deflated files a piece at a time: a bus schedule's stop times are 150 MB unpacked.
    if (entry.header.method === 8) return Readable.from(chunks(entry.getCompressedData())).pipe(createInflateRaw());
    return Readable.from(chunks(entry.getData()));
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
  report: ReportOptions = 'none',
): Promise<StaticIndex> {
  const indexes = [];
  for (const url of urls) indexes.push(await buildStaticIndex(zipFiles(await download(feedId, url)), detail, report));
  return indexes.length === 1 ? indexes[0] : mergeIndexes(indexes);
}

/** Downloads a file, reusing a copy from the last day. */
export async function download(feedId: string, url: string): Promise<Buffer> {
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
