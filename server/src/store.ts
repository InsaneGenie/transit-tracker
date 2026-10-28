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

export interface FeedStatus {
  id: string;
  agency: string;
  enabled: boolean;
  staticLoaded: boolean;
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
}

export type Fetcher = (url: string) => Promise<FeedSnapshot>;

export class VehicleStore {
  private feeds: FeedState[];
  private timers: NodeJS.Timeout[] = [];

  constructor(
    configs: FeedConfig[],
    env: Record<string, string | undefined> = process.env,
    private fetcher: Fetcher = (url) => fetchFeed(url, AbortSignal.timeout(15_000)),
    private loadIndex: (id: string, url: string) => Promise<StaticIndex> = loadStaticIndex,
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
      this.feeds.filter((f) => this.enabled(f) && f.config.staticUrl).map(async (feed) => {
        try {
          feed.index = await this.loadIndex(feed.config.id, feed.config.staticUrl!);
        } catch (err) {
          feed.lastError = `static GTFS: ${(err as Error).message}`;
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
    if (ok.length) feed.snapshot = mergeSnapshots(ok);
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

  /** Every vehicle right now. Estimated positions move between polls because they are worked out per call. */
  vehicles(now = Date.now() / 1000): Vehicle[] {
    const out: Vehicle[] = [];
    for (const { config, index, snapshot } of this.feeds) {
      if (!snapshot) continue;
      const base = { feed: config.id, agency: config.agency, mode: config.mode };
      const route = (id?: string) => (id ? index?.routes.get(id) : undefined);

      for (const g of snapshot.gps) {
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
        const pos = estimatePosition(trip, now, index);
        if (!pos) continue;
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
    if (index) {
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

  status(): FeedStatus[] {
    return this.feeds.map((f) => ({
      id: f.config.id,
      agency: f.config.agency,
      enabled: this.enabled(f),
      staticLoaded: Boolean(f.index),
      lastFetch: f.snapshot ? new Date(f.snapshot.fetchedAt * 1000).toISOString() : undefined,
      lastError: this.enabled(f) ? f.lastError : `set ${f.config.apiKeyEnv} to enable`,
      gpsVehicles: f.snapshot?.gps.length ?? 0,
      estimatedTrips: f.snapshot?.trips.length ?? 0,
    }));
  }
}
