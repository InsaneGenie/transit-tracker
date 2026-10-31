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

/**
 * A train the feed said was standing in a station this recently is still there, in seconds. The subway
 * confirms it every 10 to 15 seconds while the train is in the station.
 */
const IN_STATION_S = 20;

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
  // Standing in a station the trip still lists: there, whatever its times say. Its departure time is often
  // already past while it waits, which put it out on the track and then pulled it back each update.
  const standing =
    trip.status === 'STOPPED_AT' && (trip.statusAge ?? Infinity) <= IN_STATION_S
      ? trip.stops.find((s) => s.stopId === trip.statusStopId && (s.departure ?? s.arrival) !== undefined)
      : undefined;
  const station = standing && index.stops.get(standing.stopId);
  if (station) return { lat: station.lat, lon: station.lon, stopId: standing.stopId, status: 'STOPPED_AT', along: 1 };

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

/** A vehicle due at its next stop this long before it reported a position nowhere near it is late, in meters. */
const NEAR_STOP_M = 150;

/** A projected vehicle's heading is taken over this stretch of its way, in meters. */
const HEADING_SPAN_M = 30;

/** A position is moved on at most this long past when it was reported, in seconds. */
const MAX_PROJECT_S = 3 * 60;

/**
 * Where a vehicle that reported its position at `fixTime` is likely to be `now`: moved on along `track`
 * (the way from the reported position to its next stop) at the pace that gets it there at its predicted
 * time, then waiting there until its predicted departure. Null when its times say nothing about it. Feeds pass on positions 30 to 60 seconds old, in which a bus covers a block
 * or two and a train far more. It goes no further than `maxMeters` from the reported position.
 *
 * `along` is how close it is to the next stop, unless `fromMeters` (how far along its whole route the reported
 * position is) is given: then it is how far along its route it is, which compares across stops.
 */
export function projectFix(
  fix: LatLon,
  fixTime: number,
  trip: TripState,
  now: number,
  index: StaticIndex,
  track: (stopId: string, fromStopId?: string) => Polyline,
  maxMeters = Infinity,
  fromMeters?: number,
): EstimatedPosition | null {
  const at = Math.min(now, fixTime + MAX_PROJECT_S);
  const nextIdx = trip.stops.findIndex((s) => (s.departure ?? s.arrival ?? -Infinity) > fixTime);
  if (nextIdx === -1) return null;
  const next = trip.stops[nextIdx];
  const stop = index.stops.get(next.stopId);
  if (!stop) return null;
  const arrive = next.arrival ?? next.departure!;
  const fromStopId = trip.stops[nextIdx - 1]?.stopId;
  const atStop = { lat: stop.lat, lon: stop.lon, stopId: next.stopId, status: 'STOPPED_AT' as const, along: 1 };
  // Due there already and near it: waiting to leave.
  if (arrive <= fixTime && distanceMeters(fix, stop) <= NEAR_STOP_M) {
    return { ...atStop, lat: fix.lat, lon: fix.lon, along: fromMeters ?? atStop.along };
  }
  const path = track(next.stopId, fromStopId);
  // Due there already and nowhere near it, it's running late and the times are no guide, so it stays put.
  const fraction = Math.min(
    arrive > fixTime ? Math.max(0, (at - fixTime) / (arrive - fixTime)) : 0,
    path.length > 0 ? maxMeters / path.length : 1,
  );
  if (fraction >= 1) return fromMeters === undefined ? atStop : { ...atStop, along: fromMeters + path.length };
  const point = path.at(fraction);
  const metersLeft = path.length * (1 - fraction);
  // Heading from a little way back to a little way on: the first bit of the way, from a reported position
  // a few meters to the side of the route onto it, can point anywhere.
  const step = path.length > 0 ? HEADING_SPAN_M / path.length : 0;
  const ahead = path.at(Math.min(1, fraction + step));
  const behind = path.at(Math.max(0, fraction - step));
  return {
    lat: point.lat,
    lon: point.lon,
    bearing: path.length > 0 ? bearingDegrees(behind, ahead) : undefined,
    stopId: next.stopId,
    status: 'IN_TRANSIT_TO',
    // From how far it has left to go rather than the share of the way from this fix, so positions projected
    // from an older and a newer fix compare.
    along: fromMeters === undefined ? 1 / (1 + metersLeft / 1000) : fromMeters + path.length - metersLeft,
    fromStopId,
  };
}
