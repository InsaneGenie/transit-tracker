import { bearingDegrees, distanceMeters, Polyline, type LatLon } from './geo.js';
import type { StaticIndex } from './static-gtfs.js';
import type { TripState } from './realtime.js';

export interface EstimatedPosition extends LatLon {
  bearing?: number;
  /** The stop the vehicle is at or heading to. */
  stopId: string;
  status: 'STOPPED_AT' | 'IN_TRANSIT_TO';
}

/** Trips due to start further out than this are treated as not in service yet. */
const NOT_STARTED_SECONDS = 5 * 60;

const tracks = new WeakMap<StaticIndex, Map<string, Polyline>>();
const shapesBetween = new WeakMap<StaticIndex, Map<string, string | undefined>>();

/** How far a stop can sit from a shape and still count as on it (stations are often a block off the track). */
const ON_SHAPE_METERS = 300;

/**
 * A shape that runs past both stops: the first of `preferred` that does, else one of the route's own.
 * The usual shape for a hop is tallied by the stop it leads to, from either direction, so it can
 * belong to trains running the other way (or from another terminal) and miss `from` entirely.
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
  const passes = (shapeId: string | undefined): shapeId is string => {
    const shape = shapeId ? index.shapes.get(shapeId) : undefined;
    if (!shape || !from || !to) return false;
    return [from, to].every((stop) => distanceMeters(shape.point(shape.nearestIndex(stop)), stop) <= ON_SHAPE_METERS);
  };
  // Of the route's own, the shortest way between the two, so a shape that loops off elsewhere loses.
  const length = (shapeId: string) => index.shapes.get(shapeId)!.slice(from!, to!).length;
  const found =
    preferred.find(passes) ??
    [...((routeId && index.routeShapes.get(routeId)) || [])]
      .filter(passes)
      .reduce<string | undefined>((best, id) => (best === undefined || length(id) < length(best) ? id : best), undefined);
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
export function estimatePosition(trip: TripState, now: number, index: StaticIndex): EstimatedPosition | null {
  const nextIdx = trip.stops.findIndex((s) => (s.departure ?? s.arrival ?? -Infinity) > now);
  if (nextIdx === -1) return null;
  const next = trip.stops[nextIdx];
  const nextStop = index.stops.get(next.stopId);
  if (!nextStop) return null;
  const arriveNext = next.arrival ?? next.departure!;

  const atNext = { lat: nextStop.lat, lon: nextStop.lon, stopId: next.stopId, status: 'STOPPED_AT' as const };
  if (arriveNext <= now) return atNext; // dwelling: arrived, not yet departed
  if (trip.status === 'STOPPED_AT' && trip.statusStopId === next.stopId) return atNext;

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
    return { lat: fromStop.lat, lon: fromStop.lon, stopId: fromStopId!, status: 'STOPPED_AT' };
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
  };
}
