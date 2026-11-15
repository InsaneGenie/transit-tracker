import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { transit_realtime: rt } = GtfsRealtimeBindings;
type FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;

/** A vehicle that reported its own GPS position. */
export interface GpsVehicle {
  vehicleId: string;
  tripId?: string;
  routeId?: string;
  lat: number;
  lon: number;
  bearing?: number;
  stopId?: string;
  timestamp?: number;
}

export interface StopEstimate {
  stopId: string;
  /** Unix seconds. */
  arrival?: number;
  departure?: number;
}

/** A trip known only from predicted stop times, so its position must be estimated. */
export interface TripState {
  tripId: string;
  routeId?: string;
  vehicleId?: string;
  stops: StopEstimate[];
  /** From a position-less vehicle entity, which NYC subway feeds send. */
  status?: 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO';
  statusStopId?: string;
  /**
   * How long before the feed was published the status was last confirmed, in seconds. The subway's
   * refreshes a train's STOPPED_AT every 10 to 15 seconds while it is in the station, then leaves it be.
   */
  statusAge?: number;
}

export interface FeedSnapshot {
  fetchedAt: number;
  gps: GpsVehicle[];
  /** Every trip with predictions, including ones whose vehicle also reported GPS. */
  trips: TripState[];
  /** What the URL sent, for the health report: its size, how many entities it held and when it was published. */
  sent?: { bytes: number; entities: number; publishedAt?: number };
}

/** protobufjs gives 64-bit fields as Long objects. */
function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const n = typeof (value as { toNumber?: unknown }).toNumber === 'function'
    ? (value as { toNumber(): number }).toNumber()
    : Number(value);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

const STATUS = ['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO'] as const;

export function decodeFeed(bytes: Uint8Array): FeedMessage {
  return rt.FeedMessage.decode(bytes);
}

export function snapshotFromFeed(message: FeedMessage, fetchedAt = Date.now() / 1000): FeedSnapshot {
  const gps: GpsVehicle[] = [];
  const trips = new Map<string, TripState>();
  const statuses = new Map<string, Pick<TripState, 'status' | 'statusStopId' | 'statusAge' | 'vehicleId'>>();
  const published = toNumber(message.header?.timestamp);

  for (const entity of message.entity) {
    const tu = entity.tripUpdate;
    if (tu?.trip?.tripId) {
      trips.set(tu.trip.tripId, {
        tripId: tu.trip.tripId,
        routeId: tu.trip.routeId || undefined,
        vehicleId: tu.vehicle?.id || tu.vehicle?.label || undefined,
        stops: (tu.stopTimeUpdate ?? [])
          .filter((s) => s.stopId)
          .map((s) => ({
            stopId: s.stopId!,
            arrival: toNumber(s.arrival?.time),
            departure: toNumber(s.departure?.time),
          })),
      });
    }

    const v = entity.vehicle;
    if (!v) continue;
    // Metro-North sends the trip update and the vehicle in one entity, the vehicle under its train number
    // rather than the trip id, so the entity's trip update says which trip it is.
    const tripId = tu?.trip?.tripId || v.trip?.tripId || undefined;
    if (v.position && (v.position.latitude || v.position.longitude)) {
      gps.push({
        vehicleId: v.vehicle?.id || v.vehicle?.label || entity.id,
        tripId,
        routeId: v.trip?.routeId || tu?.trip?.routeId || undefined,
        lat: v.position.latitude,
        lon: v.position.longitude,
        bearing: v.position.bearing ?? undefined,
        stopId: v.stopId || undefined,
        timestamp: toNumber(v.timestamp),
      });
    } else if (tripId) {
      const at = toNumber(v.timestamp);
      statuses.set(tripId, {
        status: STATUS[v.currentStatus ?? 2],
        statusStopId: v.stopId || undefined,
        statusAge: at !== undefined && published !== undefined ? Math.max(0, published - at) : undefined,
        vehicleId: v.vehicle?.id || v.vehicle?.label || undefined,
      });
    }
  }

  for (const [tripId, s] of statuses) {
    const trip = trips.get(tripId);
    if (trip) Object.assign(trip, { ...s, vehicleId: trip.vehicleId ?? s.vehicleId });
  }
  // LIRR leaves the route off its vehicles, though their trip updates carry it.
  for (const g of gps) g.routeId ??= g.tripId ? trips.get(g.tripId)?.routeId : undefined;

  return { fetchedAt, gps, trips: [...trips.values()] };
}

/**
 * One snapshot from several URLs. A vehicle or trip can be listed in more than one of them (or twice in one),
 * so each is kept once: the newest GPS fix per vehicle, and the first listing of each trip.
 */
export function mergeSnapshots(snapshots: FeedSnapshot[]): FeedSnapshot {
  const gps = new Map<string, GpsVehicle>();
  for (const g of snapshots.flatMap((s) => s.gps)) {
    const seen = gps.get(g.vehicleId);
    if (!seen || (g.timestamp ?? 0) > (seen.timestamp ?? 0)) gps.set(g.vehicleId, g);
  }
  const trips = new Map<string, TripState>();
  for (const t of snapshots.flatMap((s) => s.trips)) if (!trips.has(t.tripId)) trips.set(t.tripId, t);
  return {
    fetchedAt: Math.min(...snapshots.map((s) => s.fetchedAt)),
    gps: [...gps.values()],
    trips: [...trips.values()],
  };
}

/**
 * Each GPS position without a known trip gets the trip whose update names the same vehicle, so the vehicle is
 * shown once, where it reported, with its trip's stops. A vehicle on more than one trip (the one it is on and
 * its next) takes the one whose last stop comes first, which is the one it is on.
 */
export function linkTripsByVehicle(snapshot: FeedSnapshot): FeedSnapshot {
  const tripIds = new Set(snapshot.trips.map((t) => t.tripId));
  const byVehicle = new Map<string, TripState>();
  const ends = (t: TripState) => {
    const last = t.stops.at(-1);
    return last?.arrival ?? last?.departure ?? Infinity;
  };
  for (const t of snapshot.trips) {
    if (!t.vehicleId) continue;
    const seen = byVehicle.get(t.vehicleId);
    if (!seen || ends(t) < ends(seen)) byVehicle.set(t.vehicleId, t);
  }
  if (!byVehicle.size) return snapshot;
  return {
    ...snapshot,
    gps: snapshot.gps.map((g) => {
      if (g.tripId && tripIds.has(g.tripId)) return g;
      const trip = byVehicle.get(g.vehicleId);
      return trip ? { ...g, tripId: trip.tripId, routeId: g.routeId ?? trip.routeId } : g;
    }),
  };
}

export async function fetchFeed(url: string, signal?: AbortSignal): Promise<FeedSnapshot> {
  const where = `${new URL(url).host}${new URL(url).pathname}`;
  const res = await fetch(url, { signal }).catch((err: Error & { cause?: Error }) => {
    throw new Error(`${where}: ${err.cause?.message ?? err.message}`);
  });
  if (!res.ok) throw new Error(`${where} returned ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const message = decodeFeed(bytes);
  const published = toNumber(message.header?.timestamp);
  return {
    ...snapshotFromFeed(message),
    sent: { bytes: bytes.length, entities: message.entity.length, ...(published !== undefined && { publishedAt: published }) },
  };
}
