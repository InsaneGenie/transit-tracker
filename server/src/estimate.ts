import { bearingDegrees, distanceMeters, Polyline, type LatLon } from './geo.js';
import type { StaticIndex } from './static-gtfs.js';
import type { TripState } from './realtime.js';

export interface EstimatedPosition extends LatLon {
  bearing?: number;
  /** The stop the vehicle is at or heading to. */
  stopId: string;
  status: 'STOPPED_AT' | 'IN_TRANSIT_TO';
  /** How far along the way to `stopId` it is, from 0 just left the stop before to 1 there. */
  along: number;
  /** The stop it left, while between stops. */
  fromStopId?: string;
}

/** Trips due to start further out than this are treated as not in service yet. */
const NOT_STARTED_SECONDS = 5 * 60;

const tracks = new WeakMap<StaticIndex, Map<string, Polyline>>();
const shapesBetween = new WeakMap<StaticIndex, Map<string, string | undefined>>();

/** How far a stop can sit from a shape and still count as on it (stations are often a block off the track). */
const ON_SHAPE_METERS = 300;

/**
 * The same for another line's shape, which a train only takes when it is rerouted. Tighter, since in
 * Midtown another line's track can pass within a block of both stations.
 */
const ON_OTHER_SHAPE_METERS = 100;

/** Grid cell size for finding shapes near a stop, in degrees (about 330 m north-south, 250 m east-west). */
const CELL_DEG = 0.003;
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)}|${Math.floor(lon / CELL_DEG)}`;

const grids = new WeakMap<StaticIndex, Map<string, Set<string>>>();
const stopDistances = new WeakMap<StaticIndex, Map<string, Map<string, number>>>();

/**
 * How far each shape passing within about ON_SHAPE_METERS of a stop comes to it, in meters. Shapes are
 * found through a grid of the cells their points fall in, so a stop never scans every shape. Cached.
 */
function shapesNearStop(index: StaticIndex, stopId: string): Map<string, number> {
  let grid = grids.get(index);
  if (!grid) {
    grids.set(index, (grid = new Map()));
    for (const [id, shape] of index.shapes) {
      for (let i = 0; i < shape.size; i++) {
        const p = shape.point(i);
        const key = cellKey(p.lat, p.lon);
        let ids = grid.get(key);
        if (!ids) grid.set(key, (ids = new Set()));
        ids.add(id);
      }
    }
  }
  let cache = stopDistances.get(index);
  if (!cache) stopDistances.set(index, (cache = new Map()));
  let near = cache.get(stopId);
  if (!near) {
    near = new Map();
    const stop = index.stops.get(stopId);
    if (stop) {
      const candidates = new Set<string>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          for (const id of grid.get(cellKey(stop.lat + dy * CELL_DEG, stop.lon + dx * CELL_DEG)) ?? []) candidates.add(id);
        }
      }
      for (const id of candidates) {
        const shape = index.shapes.get(id)!;
        near.set(id, distanceMeters(shape.point(shape.nearestIndex(stop)), stop));
      }
    }
    cache.set(stopId, near);
  }
  return near;
}

/**
 * A shape that runs past both stops: the first of `preferred` that does, else one of the route's own,
 * else (for a train rerouted onto another line's track) any line's. The usual shape for a hop is
 * tallied by the stop it leads to, from either direction, so it can belong to trains running the
 * other way (or from another terminal) and miss `from` entirely.
 */
export function shapeBetween(
  index: StaticIndex,
  routeId: string | undefined,
  fromStopId: string,
  toStopId: string,
  preferred: (string | undefined)[] = [],
): string | undefined {
  let cache = shapesBetween.get(index);
  if (!cache) shapesBetween.set(index, (cache = new Map()));
  const key = `${routeId ?? ''}|${fromStopId}|${toStopId}|${preferred.join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const from = index.stops.get(fromStopId);
  const to = index.stops.get(toStopId);
  let found: string | undefined;
  if (from && to) {
    const nearFrom = shapesNearStop(index, fromStopId);
    const nearTo = shapesNearStop(index, toStopId);
    const passes = (shapeId: string | undefined, meters = ON_SHAPE_METERS): shapeId is string =>
      shapeId !== undefined && (nearFrom.get(shapeId) ?? Infinity) <= meters && (nearTo.get(shapeId) ?? Infinity) <= meters;
    // Of several, the shortest way between the two, so a shape that loops off elsewhere loses.
    const length = (shapeId: string) => index.shapes.get(shapeId)!.slice(from, to).length;
    const shortest = (ids: string[]) =>
      ids.reduce<string | undefined>((best, id) => (best === undefined || length(id) < length(best) ? id : best), undefined);
    found =
      preferred.find((id) => passes(id)) ??
      shortest([...((routeId && index.routeShapes.get(routeId)) || [])].filter((id) => passes(id))) ??
      shortest([...nearFrom.keys()].filter((id) => passes(id, ON_OTHER_SHAPE_METERS)));
  }
  cache.set(key, found);
  return found;
}

/** The track between two stops, following the route's shape when there is one. Cached per index. */
export function trackBetween(index: StaticIndex, fromStopId: string, toStopId: string, shapeId?: string): Polyline {
  let cache = tracks.get(index);
  if (!cache) tracks.set(index, (cache = new Map()));
  const key = `${shapeId ?? ''}|${fromStopId}|${toStopId}`;
  let track = cache.get(key);
  if (!track) {
    const from = index.stops.get(fromStopId)!;
    const to = index.stops.get(toStopId)!;
    const shape = shapeId ? index.shapes.get(shapeId) : undefined;
    track = shape ? shape.slice(from, to) : new Polyline([from, to]);
    cache.set(key, track);
  }
  return track;
}

/**
 * Places a trip on the map from its predicted stop times. It finds the next stop, works out when the
 * train left the stop before it, and moves it that fraction of the way along the track between them.
 */
export function estimatePosition(
  trip: TripState,
  now: number,
  index: StaticIndex,
  keepsPastStops = false,
): EstimatedPosition | null {
  const nextIdx = trip.stops.findIndex((s) => (s.departure ?? s.arrival ?? -Infinity) > now);
  if (nextIdx === -1) return null;
  const next = trip.stops[nextIdx];
  const nextStop = index.stops.get(next.stopId);
  if (!nextStop) return null;
  const arriveNext = next.arrival ?? next.departure!;

  const atNext = { lat: nextStop.lat, lon: nextStop.lon, stopId: next.stopId, status: 'STOPPED_AT' as const, along: 1 };
  if (arriveNext <= now) return atNext; // dwelling: arrived, not yet departed
  if (trip.status === 'STOPPED_AT' && trip.statusStopId === next.stopId) return atNext;

  // Not left its first stop yet: a stop with only a departure time is where a trip starts, and in a feed
  // that keeps the stops a train has passed, so is the first one listed. Inventing a stop before it
  // would show the train out on the line heading in.
  const atOrigin = nextIdx === 0 && (keepsPastStops || next.arrival === undefined);
  if (atOrigin) return arriveNext - now <= NOT_STARTED_SECONDS ? atNext : null;

  // Where it came from: the previous stop in the feed if it is still listed, else the usual previous stop.
  let fromStopId: string | undefined;
  let leftFrom: number | undefined;
  const prev = nextIdx > 0 ? trip.stops[nextIdx - 1] : undefined;
  const segment =
    index.segments.get(`${trip.routeId}|${next.stopId}`) ?? index.segments.get(`*|${next.stopId}`);
  if (prev && (prev.departure ?? prev.arrival) !== undefined) {
    fromStopId = prev.stopId;
    leftFrom = prev.departure ?? prev.arrival;
  } else if (segment) {
    fromStopId = segment.fromStopId;
    leftFrom = arriveNext - segment.seconds;
  }

  const fromStop = fromStopId ? index.stops.get(fromStopId) : undefined;
  if (!fromStop || leftFrom === undefined) {
    // First stop of the trip, or no history for this stop: show it waiting there if it's due soon.
    return arriveNext - now <= NOT_STARTED_SECONDS ? atNext : null;
  }
  if (now < leftFrom) {
    if (nextIdx === 0 && leftFrom - now > NOT_STARTED_SECONDS) return null;
    return { lat: fromStop.lat, lon: fromStop.lon, stopId: fromStopId!, status: 'STOPPED_AT', along: 1 };
  }

  const shapeId = shapeBetween(index, trip.routeId, fromStopId!, next.stopId, [
    index.tripShapes.get(trip.tripId),
    segment?.fromStopId === fromStopId ? segment?.shapeId : undefined,
  ]);
  const path = trackBetween(index, fromStopId!, next.stopId, shapeId);
  const fraction = arriveNext > leftFrom ? (now - leftFrom) / (arriveNext - leftFrom) : 1;
  const point = path.at(fraction);
  return {
    lat: point.lat,
    lon: point.lon,
    bearing: path.length > 0 ? point.bearing : bearingDegrees(fromStop, nextStop),
    stopId: next.stopId,
    status: 'IN_TRANSIT_TO',
    along: Math.min(1, Math.max(0, fraction)),
    fromStopId,
  };
}
