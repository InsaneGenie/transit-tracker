import { estimatePosition, trackBetween } from './estimate.js';
import { Polyline } from './geo.js';
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
}

export interface VehicleDetail {
  vehicle: Vehicle;
  routeLongName?: string;
  upcoming: UpcomingStop[];
  /** The rest of the trip as [lon, lat] pairs, from the vehicle onward. */
  path: [number, number][];
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

export type Bbox = [west: number, south: number, east: number, north: number];

/** Margin around the requested area when deciding which trips are worth estimating, in degrees (~3 km). */
const ESTIMATE_MARGIN = 0.03;

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
    await Promise.all(
      this.feeds.filter((f) => this.enabled(f) && f.config.staticUrls?.length).map(async (feed) => {
        try {
          feed.index = await this.loadIndex(feed.config);
        } catch (err) {
          feed.staticError = (err as Error).message;
        }
      }),
    );
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
      return { stopId: s.stopId, name: stop?.name, lat: stop?.lat, lon: stop?.lon, time: s.arrival ?? s.departure };
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
