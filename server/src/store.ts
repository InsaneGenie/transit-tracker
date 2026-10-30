import { estimatePosition, shapeBetween, trackBetween, type EstimatedPosition } from './estimate.js';
import { distanceMeters, nearestOnPath, Polyline, simplifyPath, type LatLon } from './geo.js';
import type { FeedConfig, Mode } from './feeds.js';
import { fetchFeed, mergeSnapshots, type FeedSnapshot } from './realtime.js';
import { applyStationAccess, loadStationAccess } from './accessibility.js';
import { loadStaticIndex, type Access, type StaticIndex } from './static-gtfs.js';

export interface Vehicle {
  id: string;
  feed: string;
  agency: string;
  mode: Mode;
  routeId?: string;
  routeName?: string;
  routeColor?: string;
  tripId?: string;
  lat: number;
  lon: number;
  bearing?: number;
  status?: 'STOPPED_AT' | 'IN_TRANSIT_TO';
  stopId?: string;
  stopName?: string;
  /** "gps" when the vehicle reported its position, "estimated" when placed from predicted arrival times. */
  source: 'gps' | 'estimated';
}

export interface UpcomingStop {
  stopId: string;
  name?: string;
  lat?: number;
  lon?: number;
  /** Unix seconds. */
  time?: number;
  /** Other lines that call here, as legend keys (`${feed}:${routeId}`). */
  transfers?: string[];
  /** Step-free from the street to the trains: every platform, or only some of them. */
  access?: Access;
  /** What a partly accessible station's step-free route reaches, like "only toward Manhattan". */
  accessNote?: string;
}

export interface VehicleDetail {
  vehicle: Vehicle;
  routeLongName?: string;
  upcoming: UpcomingStop[];
  /** The rest of the trip as [lon, lat] pairs, from the vehicle onward. */
  path: [number, number][];
}

/** A whole line drawn on the map: every path its trips follow. */
export interface RouteLine {
  key: string;
  mode: Mode;
  color?: string;
  /** Each path as [lon, lat] pairs. */
  paths: [number, number][][];
  /** The stations it calls at, when the schedule says (subway and rail; bus schedules are read without stop times). */
  stops: UpcomingStop[];
}

/** How far a line drawn with every other may stray from its schedule's path, in meters. */
const ROUTE_PATH_DETAIL_M = 4;

/** A line's path alone. */
export type RoutePath = Omit<RouteLine, 'stops'>;

/** A vehicle on its way to a station, with where it is now. */
export interface Arrival {
  vehicle: Vehicle;
  /** Unix seconds. */
  time: number;
  /** Stops it still makes before this one. */
  stopsAway: number;
  /** Where the trip ends. */
  destination?: string;
}

/** The vehicles coming one way through a station, soonest first. */
export interface ArrivalDirection {
  /** Where they're headed; a line with branches has more than one. */
  destinations: string[];
  arrivals: Arrival[];
}

/** A vehicle placed along its line's stations, for the line's own page. */
export interface LineVehicle {
  vehicle: Vehicle;
  /** Where it is in the line's `stops`: a whole number when at that station, halfway when between two. */
  at: number;
  /** 1 when it is heading toward the end of the line's `stops`, -1 toward the start. */
  heading: 1 | -1;
  /** Where the trip ends. */
  destination?: string;
}

/** A line on the legend. */
export interface RouteInfo {
  /** `${feed}:${routeId}`, unique across agencies. */
  key: string;
  feed: string;
  agency: string;
  mode: Mode;
  id: string;
  name: string;
  longName?: string;
  color?: string;
}

export interface FeedStatus {
  id: string;
  agency: string;
  enabled: boolean;
  staticLoaded: boolean;
  /** Why the schedule failed to load, kept apart from feed errors so a later good poll doesn't hide it. */
  staticError?: string;
  lastFetch?: string;
  lastError?: string;
  gpsVehicles: number;
  estimatedTrips: number;
}

interface FeedState {
  config: FeedConfig;
  apiKey?: string;
  index?: StaticIndex;
  snapshot?: FeedSnapshot;
  /** Each URL's last good snapshot and when it was fetched, in ms, by its place in `realtimeUrls`. */
  parts?: ({ snapshot: FeedSnapshot; at: number } | undefined)[];
  lastError?: string;
  staticError?: string;
}

/**
 * How long a URL's last good snapshot stands in when it fails. One of several URLs failing (one subway line
 * group, or the bus positions beside the bus trip updates) would otherwise take its vehicles off the map
 * until the next poll, so they blinked out and back in.
 */
const PART_MAX_AGE_MS = 120_000;

/**
 * `MTA NYCT_M15` -> `M15`, so realtime ids match the schedule's. Only known agency prefixes go: Bus Time
 * sends most ids bare now, and its trip ids have underscores of their own (`CH_D6-Weekday-SDon-085000_MISC_176`).
 */
const unprefix = <T extends string | undefined>(id: T): T => (id ? id.replace(/^(MTA NYCT|MTABC|MTA)_/, '') : id) as T;

function withoutAgencyPrefixes(snapshot: FeedSnapshot): FeedSnapshot {
  return {
    ...snapshot,
    gps: snapshot.gps.map((g) => ({ ...g, tripId: unprefix(g.tripId), routeId: unprefix(g.routeId), stopId: unprefix(g.stopId) })),
    trips: snapshot.trips.map((t) => ({
      ...t,
      tripId: unprefix(t.tripId),
      routeId: unprefix(t.routeId),
      statusStopId: unprefix(t.statusStopId),
      stops: t.stops.map((s) => ({ ...s, stopId: unprefix(s.stopId) })),
    })),
  };
}

/** Five decimal places is about a meter, plenty for drawing. */
const round = (n: number) => Math.round(n * 1e5) / 1e5;

export type Bbox = [west: number, south: number, east: number, north: number];

/** A vehicle's next stop this far from every station of its line can't be placed along it. */
const ALONG_LINE_M = 400;

/** A vehicle this close to its next station is at it. */
const AT_STATION_M = 80;

/** How long the count of vehicles on each line is reused, in seconds. */
const COUNTS_MAX_AGE_S = 20;

/** A GPS fix older than this loses to the trip's predicted times, which are newer, in seconds. */
const OLD_FIX_S = 3 * 60;

/** A GPS fix this old, with no predicted times to fall back on, is dropped, in seconds. */
const STALE_FIX_S = 10 * 60;

/**
 * A train placed from predicted times is kept from moving backward for this long, in seconds. A later
 * prediction (a delay) puts it behind where it was shown, so it waits there for the new times to catch up
 * instead of jumping back. Still behind after this, the earlier guess was wrong and the new one wins.
 */
const MAX_HOLD_S = 120;

/** How long a train's progress is remembered after it was last placed, in seconds. */
const PROGRESS_KEPT_S = 120;

/** How far a placed train has got: the stop it is at or heading to, the stops it has left, and where it was shown. */
interface Progress {
  stopId: string;
  along: number;
  left: Set<string>;
  shown: EstimatedPosition;
  seen: number;
  heldSince?: number;
}

/** Margin around the requested area when deciding which trips are worth estimating, in degrees (~3 km). */
const ESTIMATE_MARGIN = 0.03;

/**
 * Stops this close to a picked station count as that station. That takes in a subway station's platforms
 * and the bus stop across the street, but never the next stop along the line.
 */
const STATION_RADIUS_M = 150;

function inside(b: Bbox, lat: number, lon: number, margin = 0): boolean {
  return lon >= b[0] - margin && lat >= b[1] - margin && lon <= b[2] + margin && lat <= b[3] + margin;
}

/** A station counts as on a path when the path passes within this distance of it. */
const ON_PATH_M = 150;

/**
 * A station this close to its drawn line is drawn on it. Bus stops sit at the curb and stations beside
 * the track, while the line runs down the middle of the street, so their dots would otherwise sit off it.
 */
const SNAP_M = 50;

/** A station moved onto the nearest of the drawn paths, when one passes close enough. */
function ontoPaths<T extends { lat: number; lon: number }>(stop: T, paths: [number, number][][]): T {
  let nearest: (LatLon & { meters: number }) | undefined;
  for (const path of paths) {
    const at = nearestOnPath(stop, path);
    if (!nearest || at.meters < nearest.meters) nearest = at;
  }
  if (!nearest || nearest.meters > SNAP_M) return stop;
  return { ...stop, lat: round(nearest.lat), lon: round(nearest.lon) };
}

/**
 * Stations in the order a rider meets them: along the longest path first, then any branch that path
 * misses, so a list of them reads like the line's map.
 */
function alongPaths<T extends { lat?: number; lon?: number }>(stops: T[], paths: [number, number][][]): T[] {
  const place = (s: T): [number, number] => {
    if (s.lat === undefined || s.lon === undefined) return [paths.length, 0];
    let nearest: [number, number, number] = [paths.length, 0, Infinity];
    for (let p = 0; p < paths.length; p++) {
      paths[p].forEach(([lon, lat], i) => {
        const d = distanceMeters({ lat, lon }, { lat: s.lat!, lon: s.lon! });
        if (d < nearest[2]) nearest = [p, i, d];
      });
      // The first path that passes the station wins, so trunk stations stay on the main path.
      if (nearest[2] <= ON_PATH_M) break;
    }
    return [nearest[0], nearest[1]];
  };
  const placed = stops.map((s) => ({ s, at: place(s) }));
  placed.sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
  return placed.map((p) => p.s);
}

export type Fetcher = (url: string) => Promise<FeedSnapshot>;

/** A feed's schedule, with which stations are accessible when that comes from elsewhere. */
async function loadWithAccess(config: FeedConfig): Promise<StaticIndex> {
  const index = await loadStaticIndex(config.id, config.staticUrls!, config.staticDetail);
  if (config.accessibilityUrl) {
    try {
      applyStationAccess(index, await loadStationAccess(config.id, config.accessibilityUrl));
    } catch (err) {
      // The map still works without it; stations just aren't marked.
      console.warn(`${config.id}: no station accessibility (${(err as Error).message})`);
    }
  }
  return index;
}

/** A stop's accessibility, for the API. */
function accessOf(stop: { access?: Access; accessNote?: string } | undefined) {
  if (!stop?.access) return {};
  return { access: stop.access, ...(stop.accessNote && { accessNote: stop.accessNote }) };
}

export class VehicleStore {
  private feeds: FeedState[];
  private timers: NodeJS.Timeout[] = [];
  /** Each estimated train's progress, by vehicle id, so it only ever moves forward. */
  private progress = new Map<string, Progress>();
  private progressSwept = 0;

  constructor(
    configs: FeedConfig[],
    env: Record<string, string | undefined> = process.env,
    private fetcher: Fetcher = (url) => fetchFeed(url, AbortSignal.timeout(15_000)),
    private loadIndex: (config: FeedConfig) => Promise<StaticIndex> = loadWithAccess,
  ) {
    this.feeds = configs.map((config) => ({
      config,
      apiKey: config.apiKeyEnv ? env[config.apiKeyEnv] || undefined : undefined,
    }));
  }

  private enabled(feed: FeedState): boolean {
    return !feed.config.apiKeyEnv || Boolean(feed.apiKey);
  }

  async loadStatic(): Promise<void> {
    // One at a time, so the unpacked schedules of every feed are never in memory together.
    for (const feed of this.feeds.filter((f) => this.enabled(f) && f.config.staticUrls?.length)) {
      try {
        feed.index = await this.loadIndex(feed.config);
      } catch (err) {
        feed.staticError = (err as Error).message;
      }
    }
  }

  async poll(feed: FeedState): Promise<void> {
    const urls = feed.config.realtimeUrls.map((u) => {
      if (!feed.apiKey) return u;
      const url = new URL(u);
      url.searchParams.set('key', feed.apiKey);
      return url.toString();
    });
    const results = await Promise.allSettled(urls.map((u) => this.fetcher(u)));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []));
    const at = Date.now();
    const parts = results.map((r, i) =>
      r.status === 'fulfilled' ? { snapshot: r.value, at } : feed.parts?.[i] && at - feed.parts[i].at <= PART_MAX_AGE_MS ? feed.parts[i] : undefined,
    );
    feed.parts = parts;
    const ok = parts.flatMap((p) => (p ? [p.snapshot] : []));
    if (ok.length) {
      const merged = mergeSnapshots(ok);
      feed.snapshot = feed.config.agencyPrefixedIds ? withoutAgencyPrefixes(merged) : merged;
    }
    feed.lastError = failed.length ? failed.join('; ') : undefined;
  }

  async pollAll(): Promise<void> {
    await Promise.all(this.feeds.filter((f) => this.enabled(f)).map((f) => this.poll(f)));
  }

  start(): void {
    for (const feed of this.feeds.filter((f) => this.enabled(f))) {
      const tick = async () => {
        await this.poll(feed).catch((err) => (feed.lastError = String(err)));
        this.timers.push(setTimeout(tick, feed.config.pollSeconds * 1000));
      };
      void tick();
    }
  }

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /**
   * Every vehicle right now, or only those inside `bbox`. Estimated positions move between polls because
   * they are worked out per call, and only trips heading to a stop near the area are worked out at all.
   */
  vehicles(now = Date.now() / 1000, bbox?: Bbox): Vehicle[] {
    const out: Vehicle[] = [];
    for (const { config, index, snapshot } of this.feeds) {
      if (!snapshot) continue;
      const base = { feed: config.id, agency: config.agency, mode: config.mode };
      const route = (id?: string) => (id ? index?.routes.get(id) : undefined);

      // The LIRR keeps listing a train's last fix for hours after its trip ends, so trains parked out of
      // service, and fixes too old to trust, are left out.
      // A feed whose schedule skipped travel times (buses) can't estimate, so it keeps older fixes.
      const trips = new Map(snapshot.trips.map((t) => [t.tripId, t]));
      const canEstimate = config.staticDetail !== 'stops';
      const live = snapshot.gps.filter((g) => {
        const trip = g.tripId ? trips.get(g.tripId) : undefined;
        if (trip && !trip.stops.some((s) => (s.departure ?? s.arrival ?? 0) > now)) return false;
        const age = g.timestamp ? now - g.timestamp : 0;
        return age <= (trip && canEstimate ? OLD_FIX_S : STALE_FIX_S);
      });
      for (const g of live) {
        if (bbox && !inside(bbox, g.lat, g.lon)) continue;
        const r = route(g.routeId);
        out.push({
          ...base,
          id: `${config.id}:${g.vehicleId}`,
          routeId: g.routeId,
          routeName: r?.shortName || r?.longName || g.routeId,
          routeColor: r?.color,
          tripId: g.tripId,
          lat: g.lat,
          lon: g.lon,
          bearing: g.bearing !== undefined && config.bearingFromEast ? (450 - g.bearing) % 360 : g.bearing,
          stopId: g.stopId,
          stopName: g.stopId ? index?.stops.get(g.stopId)?.name : undefined,
          source: 'gps',
        });
      }

      if (!index) continue;
      const tracked = new Set(live.map((g) => g.tripId));
      for (const trip of snapshot.trips) {
        if (tracked.has(trip.tripId)) continue; // its GPS position is already listed
        if (bbox) {
          const next = trip.stops.find((s) => (s.departure ?? s.arrival ?? 0) > now);
          const stop = next && index.stops.get(next.stopId);
          if (!stop || !inside(bbox, stop.lat, stop.lon, ESTIMATE_MARGIN)) continue;
        }
        const id = `${config.id}:${trip.tripId}`;
        const estimate = estimatePosition(trip, now, index, config.keepsPastStops);
        const pos = estimate && this.forwardOnly(id, estimate, now);
        if (!pos || (bbox && !inside(bbox, pos.lat, pos.lon))) continue;
        const r = route(trip.routeId);
        out.push({
          ...base,
          id,
          routeId: trip.routeId,
          routeName: r?.shortName || r?.longName || trip.routeId,
          routeColor: r?.color,
          tripId: trip.tripId,
          lat: pos.lat,
          lon: pos.lon,
          bearing: pos.bearing,
          status: pos.status,
          stopId: pos.stopId,
          stopName: index.stops.get(pos.stopId)?.name,
          source: 'estimated',
        });
      }
    }
    this.sweepProgress(now);
    return out;
  }

  /**
   * The estimate, unless it is behind where the train was last shown: each new prediction can put a train
   * a little ahead of or behind the last one, and going back made trains on the map lurch backward.
   */
  private forwardOnly(id: string, pos: EstimatedPosition, now: number): EstimatedPosition {
    const p = this.progress.get(id);
    if (!p || now - p.seen > PROGRESS_KEPT_S) {
      this.progress.set(id, { stopId: pos.stopId, along: pos.along, left: new Set(pos.fromStopId ? [pos.fromStopId] : []), shown: pos, seen: now });
      return pos;
    }
    p.seen = Math.max(p.seen, now);
    const behind = p.left.has(pos.stopId) || (pos.stopId === p.stopId && pos.along < p.along);
    if (behind) {
      p.heldSince ??= now;
      if (now - p.heldSince < MAX_HOLD_S) return p.shown;
      p.left.clear();
    } else if (pos.stopId !== p.stopId) {
      p.left.add(p.stopId);
    }
    if (pos.fromStopId) p.left.add(pos.fromStopId);
    Object.assign(p, { stopId: pos.stopId, along: pos.along, shown: pos, heldSince: undefined });
    return pos;
  }

  private sweepProgress(now: number): void {
    if (now - this.progressSwept < PROGRESS_KEPT_S) return;
    this.progressSwept = now;
    for (const [id, p] of this.progress) if (now - p.seen > PROGRESS_KEPT_S) this.progress.delete(id);
  }

  /** One vehicle with its remaining stops and the track ahead of it, for when it is tapped on the map. */
  detail(id: string, now = Date.now() / 1000): VehicleDetail | null {
    const vehicle = this.vehicles(now).find((v) => v.id === id);
    if (!vehicle) return null;
    const feed = this.feeds.find((f) => f.config.id === vehicle.feed)!;
    const index = feed.index;
    const trip = vehicle.tripId ? feed.snapshot?.trips.find((t) => t.tripId === vehicle.tripId) : undefined;
    const route = vehicle.routeId ? index?.routes.get(vehicle.routeId) : undefined;

    const remaining = (trip?.stops ?? []).filter((s) => (s.departure ?? s.arrival ?? 0) > now);
    const upcoming = remaining.map((s) => {
      const stop = index?.stops.get(s.stopId);
      return {
        stopId: s.stopId,
        name: stop?.name,
        lat: stop?.lat,
        lon: stop?.lon,
        time: s.arrival ?? s.departure,
        transfers: index && this.transferKeys(feed, index, s.stopId, vehicle.routeId),
        ...accessOf(stop),
      };
    });

    const path: [number, number][] = [];
    const add = (track: Polyline) => path.push(...track.points.map((p): [number, number] => [p.lon, p.lat]));
    const tripShapeId = trip && index?.tripShapes.get(trip.tripId);
    const tripShape = tripShapeId ? index?.shapes.get(tripShapeId) : undefined;
    const lastStop = [...upcoming].reverse().find((u) => u.lat !== undefined && u.lon !== undefined);
    if (tripShape && lastStop) {
      // The schedule knows this exact trip (true of buses), so follow its shape to the last stop.
      add(tripShape.slice(vehicle, { lat: lastStop.lat!, lon: lastStop.lon! }));
    } else if (index) {
      const segmentTo = (stopId: string) =>
        index.segments.get(`${vehicle.routeId}|${stopId}`) ?? index.segments.get(`*|${stopId}`);
      let from: string | undefined;
      for (const s of remaining) {
        const stop = index.stops.get(s.stopId);
        if (!stop) continue;
        const seg = segmentTo(s.stopId);
        if (from) {
          const shapeId = shapeBetween(index, vehicle.routeId, from, s.stopId, [
            seg?.fromStopId === from ? seg.shapeId : undefined,
          ]);
          add(trackBetween(index, from, s.stopId, shapeId));
        } else if (seg && index.stops.has(seg.fromStopId)) {
          // First hop: the stretch of track from the vehicle to its next stop.
          add(trackBetween(index, seg.fromStopId, s.stopId, seg.shapeId).slice(vehicle, stop));
        } else {
          add(new Polyline([vehicle, stop]));
        }
        from = s.stopId;
      }
    }
    return { vehicle, routeLongName: route?.longName || undefined, upcoming, path };
  }

  /** Every line in the loaded schedules, for the legend and line filter. */
  routes(): RouteInfo[] {
    return this.feeds.flatMap(({ config, index }) =>
      [...(index?.routes ?? [])].map(([id, r]) => ({
        key: `${config.id}:${id}`,
        feed: config.id,
        agency: config.agency,
        mode: config.mode,
        id,
        name: r.shortName || r.longName || id,
        longName: r.longName || undefined,
        color: r.color,
      })),
    );
  }

  /** The full path of each line, by legend key (`${feed}:${routeId}`). */
  routeLines(keys: string[]): RouteLine[] {
    return keys.flatMap((key) => {
      // Only found lines are kept: a missing one may just be waiting for its schedule to load.
      const line = this.lineCache.get(key) ?? this.buildRouteLine(key);
      if (line) this.lineCache.set(key, line);
      return line ? [line] : [];
    });
  }

  /** The path of every line of these kinds, without stations, for drawing all of them at once. */
  routePaths(modes: Mode[]): RoutePath[] {
    const keys = this.routes()
      .filter((r) => modes.includes(r.mode))
      .map((r) => r.key);
    return this.routeLines(keys).map((line) => {
      // Drawn thin and all at once, they need far less detail than one line on its own.
      let path = this.pathCache.get(line.key);
      if (!path) {
        const { key, mode, color, paths } = line;
        path = { key, mode, color, paths: paths.map((p) => simplifyPath(p, ROUTE_PATH_DETAIL_M)) };
        this.pathCache.set(key, path);
      }
      return path;
    });
  }

  private pathCache = new Map<string, RoutePath>();

  private lineCache = new Map<string, RouteLine>();

  private buildRouteLine(key: string): RouteLine | null {
    const split = key.indexOf(':');
    const routeId = key.slice(split + 1);
    const feed = this.feeds.find((f) => f.config.id === key.slice(0, split));
    const index = feed?.index;
    const shapes = [...(index?.routeShapes.get(routeId) ?? [])].flatMap((id) => index?.shapes.get(id) ?? []);
    if (!feed || !index || !shapes.length) return null;
    // A line has many shape variants (short runs, branches, night service) that mostly retrace each
    // other. Longest first, skip any that adds almost nothing new, so the map gets a few paths, not dozens.
    const drawn = new Set<string>();
    const cell = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const paths: [number, number][][] = [];
    for (const shape of shapes.sort((a, b) => b.size - a.size)) {
      const points = shape.points;
      const fresh = points.filter((p) => !drawn.has(cell(p))).length;
      if (fresh < points.length * 0.05) continue;
      points.forEach((p) => drawn.add(cell(p)));
      paths.push(points.map((p): [number, number] => [round(p.lon), round(p.lat)]));
    }
    const stops = (index.routeStations.get(routeId) ?? []).flatMap((id) => {
      const stop = index.stops.get(id);
      if (!stop) return [];
      const transfers = this.transferKeys(feed, index, id, routeId);
      const place = ontoPaths({ lat: stop.lat, lon: stop.lon }, paths);
      return [{ stopId: id, name: stop.name, ...place, ...(transfers && { transfers }), ...accessOf(stop) }];
    });
    // Stops-only schedules list a route's stops in order already.
    const ordered = feed.config.staticDetail === 'stops' ? stops : alongPaths(stops, paths);
    return { key, mode: feed.config.mode, color: index.routes.get(routeId)?.color, paths, stops: ordered };
  }

  /**
   * Every vehicle of a line still on its way to a station, in both directions. Platforms or stops near
   * `place` all count, so a station picked on either side gets both ways.
   */
  arrivals(key: string, place: LatLon, now = Date.now() / 1000): ArrivalDirection[] {
    const split = key.indexOf(':');
    const routeId = key.slice(split + 1);
    const feed = this.feeds.find((f) => f.config.id === key.slice(0, split));
    const index = feed?.index;
    if (!feed?.snapshot || !index) return [];
    const byTrip = new Map(
      this.vehicles(now)
        .filter((v) => v.feed === feed.config.id && v.routeId === routeId && v.tripId)
        .map((v) => [v.tripId!, v]),
    );
    const near = new Map<string, boolean>();
    const isNear = (stopId: string) => {
      let hit = near.get(stopId);
      if (hit === undefined) {
        const stop = index.stops.get(stopId);
        near.set(stopId, (hit = Boolean(stop && distanceMeters(stop, place) <= STATION_RADIUS_M)));
      }
      return hit;
    };

    // The soonest arrival of each vehicle, with the platform or stop it arrives at. A vehicle can be listed
    // on more than one trip (one feed lists it as both its current and next trip), but it is shown once.
    const soonest = new Map<string, { platform: string; arrival: Arrival }>();
    for (const trip of feed.snapshot.trips) {
      if (trip.routeId !== routeId) continue;
      const vehicle = byTrip.get(trip.tripId);
      if (!vehicle) continue;
      const ahead = trip.stops.filter((s) => (s.arrival ?? s.departure ?? 0) > now);
      const at = ahead.findIndex((s) => isNear(s.stopId));
      if (at < 0) continue;
      const last = trip.stops.at(-1);
      const arrival: Arrival = {
        vehicle,
        time: (ahead[at].arrival ?? ahead[at].departure)!,
        stopsAway: at,
        destination: last && index.stops.get(last.stopId)?.name,
      };
      const seen = soonest.get(vehicle.id);
      if (!seen || arrival.time < seen.arrival.time) soonest.set(vehicle.id, { platform: ahead[at].stopId, arrival });
    }

    // The platform or stop each vehicle arrives at tells the two directions apart.
    const byPlatform = new Map<string, Arrival[]>();
    for (const { platform, arrival } of soonest.values()) {
      const list = byPlatform.get(platform);
      if (list) list.push(arrival);
      else byPlatform.set(platform, [arrival]);
    }

    // A direction can use more than one stop here; ones whose trips end at the same place are merged.
    const directions: ArrivalDirection[] = [];
    for (const arrivals of byPlatform.values()) {
      const destinations = [...new Set(arrivals.flatMap((a) => (a.destination ? [a.destination] : [])))];
      const same = directions.find((d) => d.destinations.some((x) => destinations.includes(x)));
      if (same) {
        same.arrivals.push(...arrivals);
        same.destinations = [...new Set([...same.destinations, ...destinations])];
      } else {
        directions.push({ destinations, arrivals });
      }
    }
    for (const d of directions) d.arrivals.sort((a, b) => a.time - b.time);
    return directions.sort((a, b) => a.arrivals[0].time - b.arrivals[0].time);
  }

  /**
   * Every vehicle of a line placed along its list of stations, with the way it is going, so the line's
   * page can show them moving down the line. Vehicles that can't be placed are left out.
   */
  lineVehicles(key: string, now = Date.now() / 1000): LineVehicle[] {
    const split = key.indexOf(':');
    const routeId = key.slice(split + 1);
    const feed = this.feeds.find((f) => f.config.id === key.slice(0, split));
    const index = feed?.index;
    const line = this.routeLines([key])[0];
    if (!feed?.snapshot || !index || !line?.stops.length) return [];
    const trips = new Map(feed.snapshot.trips.filter((t) => t.routeId === routeId).map((t) => [t.tripId, t]));

    // The line's station nearest a stop: a platform (127N) or the bus stop across the street both count.
    const placed = new Map<string, number>();
    const placeOf = (stopId: string | undefined) => {
      if (!stopId) return -1;
      let at = placed.get(stopId);
      if (at === undefined) {
        at = -1;
        const stop = index.stops.get(stopId);
        let best = ALONG_LINE_M;
        if (stop) {
          line.stops.forEach((s, i) => {
            if (s.lat === undefined || s.lon === undefined) return;
            const d = distanceMeters(stop, { lat: s.lat, lon: s.lon });
            if (d <= best) [best, at] = [d, i];
          });
        }
        placed.set(stopId, at);
      }
      return at;
    };

    const out: LineVehicle[] = [];
    for (const vehicle of this.vehicles(now)) {
      if (vehicle.feed !== feed.config.id || vehicle.routeId !== routeId) continue;
      const trip = vehicle.tripId ? trips.get(vehicle.tripId) : undefined;
      const ahead = (trip?.stops ?? []).filter((s) => (s.arrival ?? s.departure ?? 0) > now);
      const next = placeOf(vehicle.stopId ?? ahead[0]?.stopId);
      if (next < 0) continue;
      // The way it's going: toward whichever end its later stops are.
      let later = -1;
      for (let i = ahead.length - 1; i >= 0 && (later < 0 || later === next); i--) later = placeOf(ahead[i].stopId);
      if (later < 0 || later === next) continue;
      const heading = later > next ? 1 : -1;
      const station = line.stops[next];
      const there =
        vehicle.status === 'STOPPED_AT' ||
        (station.lat !== undefined && station.lon !== undefined && distanceMeters(vehicle, { lat: station.lat, lon: station.lon }) <= AT_STATION_M);
      const at = there ? next : Math.min(Math.max(next - heading * 0.5, 0), line.stops.length - 1);
      const last = trip?.stops.at(-1);
      out.push({ vehicle, at, heading, destination: last && index.stops.get(last.stopId)?.name });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  private counts?: { at: number; lines: Record<string, number> };

  /** How many vehicles are out on each line right now, by legend key. */
  lineCounts(now = Date.now() / 1000): Record<string, number> {
    if (this.counts && Math.abs(now - this.counts.at) < COUNTS_MAX_AGE_S) return this.counts.lines;
    const lines: Record<string, number> = {};
    for (const v of this.vehicles(now)) {
      if (!v.routeId) continue;
      const key = `${v.feed}:${v.routeId}`;
      lines[key] = (lines[key] ?? 0) + 1;
    }
    this.counts = { at: now, lines };
    return lines;
  }

  /** Other lines that call at a stop, as legend keys, or undefined when there are none. */
  private transferKeys(feed: FeedState, index: StaticIndex, stopId: string, routeId?: string): string[] | undefined {
    const keys = index.stopRoutes
      .get(stopId)
      ?.filter((r) => r !== routeId)
      .map((r) => `${feed.config.id}:${r}`);
    return keys?.length ? keys : undefined;
  }

  /**
   * Whether every feed has its schedule (or gave up on it) and a first set of positions. Before that the
   * map would be missing every train whose position is worked out from the schedule.
   */
  ready(): boolean {
    return this.feeds
      .filter((f) => this.enabled(f))
      .every((f) => f.snapshot && (!f.config.staticUrls?.length || f.index || f.staticError));
  }

  status(): FeedStatus[] {
    return this.feeds.map((f) => ({
      id: f.config.id,
      agency: f.config.agency,
      enabled: this.enabled(f),
      staticLoaded: Boolean(f.index),
      staticError: f.staticError,
      lastFetch: f.snapshot ? new Date(f.snapshot.fetchedAt * 1000).toISOString() : undefined,
      lastError: this.enabled(f) ? f.lastError : `set ${f.config.apiKeyEnv} to enable`,
      gpsVehicles: f.snapshot?.gps.length ?? 0,
      estimatedTrips: f.snapshot?.trips.length ?? 0,
    }));
  }
}
