import { bearingDegrees, Polyline, type LatLon } from './geo.js';
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
  let shapeId: string | undefined;
  const prev = nextIdx > 0 ? trip.stops[nextIdx - 1] : undefined;
  const segment =
    index.segments.get(`${trip.routeId}|${next.stopId}`) ?? index.segments.get(`*|${next.stopId}`);
  if (prev && (prev.departure ?? prev.arrival) !== undefined) {
    fromStopId = prev.stopId;
    leftFrom = prev.departure ?? prev.arrival;
    if (segment?.fromStopId === prev.stopId) shapeId = segment.shapeId;
  } else if (segment) {
    fromStopId = segment.fromStopId;
    leftFrom = arriveNext - segment.seconds;
    shapeId = segment.shapeId;
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
