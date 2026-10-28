import { estimatePosition, trackBetween } from './estimate.js';
import { distanceMeters, Polyline, type LatLon } from './geo.js';
import type { FeedConfig, Mode } from './feeds.js';
import { fetchFeed, mergeSnapshots, type FeedSnapshot } from './realtime.js';
import { loadStaticIndex, type StaticIndex } from './static-gtfs.js';

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
  lastError?: string;
  staticError?: string;
}

/** `MTA NYCT_M15` -> `M15`, so realtime ids match the schedule's. */
const unprefix = <T extends string | undefined>(id: T): T => (id ? id.replace(/^[^_]*_/, '') : id) as T;

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

export type Fetcher = (url: string) => Promise<FeedSnapshot>;

export class VehicleStore {
  private feeds: FeedState[];
  private timers: NodeJS.Timeout[] = [];

  constructor(
    configs: FeedConfig[],
    env: Record<string, string | undefined> = process.env,
    private fetcher: Fetcher = (url) => fetchFeed(url, AbortSignal.timeout(15_000)),
    private loadIndex: (config: FeedConfig) => Promise<StaticIndex> = (c) =>
      loadStaticIndex(c.id, c.staticUrls!, c.staticDetail),
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
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []));
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

      for (const g of snapshot.gps) {
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
          bearing: g.bearing,
          stopId: g.stopId,
          stopName: g.stopId ? index?.stops.get(g.stopId)?.name : undefined,
          source: 'gps',
        });
      }

      if (!index) continue;
      const tracked = new Set(snapshot.gps.map((g) => g.tripId));
      for (const trip of snapshot.trips) {
        if (tracked.has(trip.tripId)) continue; // its GPS position is already listed
        if (bbox) {
          const next = trip.stops.find((s) => (s.departure ?? s.arrival ?? 0) > now);
          const stop = next && index.stops.get(next.stopId);
          if (!stop || !inside(bbox, stop.lat, stop.lon, ESTIMATE_MARGIN)) continue;
        }
        const pos = estimatePosition(trip, now, index);
        if (!pos || (bbox && !inside(bbox, pos.lat, pos.lon))) continue;
        const r = route(trip.routeId);
        out.push({
          ...base,
          id: `${config.id}:${trip.tripId}`,
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
    return out;
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
          add(trackBetween(index, from, s.stopId, seg?.fromStopId === from ? seg.shapeId : undefined));
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
      return [{ stopId: id, name: stop.name, lat: stop.lat, lon: stop.lon, ...(transfers && { transfers }) }];
    });
    return { key, mode: feed.config.mode, color: index.routes.get(routeId)?.color, paths, stops };
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

    // The platform or stop each vehicle arrives at tells the two directions apart.
    const byPlatform = new Map<string, Arrival[]>();
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
      const list = byPlatform.get(ahead[at].stopId);
      if (list) list.push(arrival);
      else byPlatform.set(ahead[at].stopId, [arrival]);
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

  /** Other lines that call at a stop, as legend keys, or undefined when there are none. */
  private transferKeys(feed: FeedState, index: StaticIndex, stopId: string, routeId?: string): string[] | undefined {
    const keys = index.stopRoutes
      .get(stopId)
      ?.filter((r) => r !== routeId)
      .map((r) => `${feed.config.id}:${r}`);
    return keys?.length ? keys : undefined;
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
