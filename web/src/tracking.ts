/**
 * What the iPhone app's Live Activity (a train or bus followed on the Lock Screen and in the Dynamic
 * Island) shows, worked out from a vehicle's details. The app works it out while it is open and the
 * server while it is closed, so both live here and agree.
 *
 * Nothing is imported at run time: the server's TypeScript setup and the app's bundler resolve imports
 * differently, so helpers they both need are passed in.
 */

/** The parts of a vehicle's details this needs. Matches `VehicleDetail` in api.ts. */
export interface TrackDetail {
  vehicle: {
    id: string;
    mode: 'subway' | 'bus' | 'rail' | 'ferry';
    status?: 'STOPPED_AT' | 'IN_TRANSIT_TO';
    stopId?: string;
    stopName?: string;
    lat: number;
    lon: number;
    source: 'gps' | 'estimated';
  };
  upcoming: { stopId: string; name?: string; lat?: number; lon?: number; time?: number }[];
}

/** The station a followed vehicle is followed to. */
export interface TrackStop {
  stopId: string;
  name: string;
  lat?: number;
  lon?: number;
}

/**
 * - `coming`: on its way, more than half a minute out.
 * - `arriving`: due within half a minute.
 * - `arrived`: standing at the station.
 * - `gone`: it has left the station (or the trip ended), so following it is over.
 * - `lost`: the feeds stopped reporting it, so following it is over.
 */
export type TrackPhase = 'coming' | 'arriving' | 'arrived' | 'gone' | 'lost';

/** Everything the Live Activity draws. Times are milliseconds, since the Lock Screen's clocks use them. */
export interface TrackProps {
  /** The line's name as on its badge, like "A", "M15" or "Port Washington". */
  line: string;
  /** Badge colors, `#rrggbb`. */
  color: string;
  textColor: string;
  mode: 'subway' | 'bus' | 'rail' | 'ferry';
  /** The station it is followed to. */
  stop: string;
  /** When it is due there; missing when the feed gives no time. */
  arrival?: number;
  /** Stops it makes before that station. */
  stopsAway: number;
  /** Where it is now, like "At 14 St" or "Heading to 23 St". */
  where: string;
  /** A real GPS position, or one estimated from arrival times. */
  gps: boolean;
  /** When following started, where its progress bar starts. */
  startedAt: number;
  /** When these details came from the feed. */
  updatedAt: number;
  phase: TrackPhase;
}

/** The line's badge and how to tidy stop names, which the app and the server each have their own way to get. */
export interface TrackLine {
  line: string;
  color: string;
  textColor: string;
  tidy: (name: string) => string;
}

/** Due this soon counts as arriving. */
const ARRIVING_S = 30;

/** The same station: same stop id, a platform of it (subway "127N" of "127"), or within about 30 m. */
function isStop(s: { stopId?: string; lat?: number; lon?: number }, stop: TrackStop): boolean {
  if (!s.stopId) return false;
  if (s.stopId === stop.stopId) return true;
  // Subway platforms are the station's id with N or S on the end.
  if (/^[0-9A-Z]+[NS]$/.test(s.stopId) && s.stopId.slice(0, -1) === stop.stopId) return true;
  if (/^[0-9A-Z]+[NS]$/.test(stop.stopId) && stop.stopId.slice(0, -1) === s.stopId) return true;
  if (s.lat === undefined || s.lon === undefined || stop.lat === undefined || stop.lon === undefined) return false;
  return Math.abs(s.lat - stop.lat) < 0.0003 && Math.abs(s.lon - stop.lon) < 0.0004;
}

/** Standing at the station this long ends following, in case the feed is stuck saying it's there. */
export const ARRIVED_FOR_MS = 3 * 60_000;

/** Following is over: the Live Activity shows its last word and goes. */
export const isOver = (phase: TrackPhase) => phase === 'gone' || phase === 'lost';

/** Whether a vehicle still has `stop` ahead of it, so it can be followed there. */
export function hasStopAhead(detail: TrackDetail, stop: TrackStop): boolean {
  return detail.upcoming.some((s) => isStop(s, stop));
}

/** Where the vehicle is now, in words. */
export function whereNow(detail: TrackDetail, tidy: (name: string) => string): string {
  const { vehicle, upcoming } = detail;
  const here = vehicle.stopName ? tidy(vehicle.stopName) : undefined;
  if (vehicle.status === 'STOPPED_AT' && here) return `At ${here}`;
  const next = upcoming[0]?.name ? tidy(upcoming[0].name) : here;
  return next ? `Heading to ${next}` : 'On the way';
}

/**
 * The Live Activity's content for a vehicle followed to `stop`, from its details at `nowMs`.
 * Its stops already passed have dropped off `upcoming`, so a stop missing from it has been left behind.
 */
export function trackProps(
  detail: TrackDetail,
  stop: TrackStop,
  line: TrackLine,
  startedAt: number,
  nowMs: number,
): TrackProps {
  const { vehicle, upcoming } = detail;
  const at = upcoming.findIndex((s) => isStop(s, stop));
  const time = at >= 0 ? upcoming[at].time : undefined;
  const standing = vehicle.status === 'STOPPED_AT' && isStop({ stopId: vehicle.stopId, lat: vehicle.lat, lon: vehicle.lon }, stop);
  let phase: TrackPhase;
  // Its time at the station can pass while it is still standing there. Feeds can also go on saying a
  // train is at a station for a while after it leaves, so `arrived` is ended after ARRIVED_FOR_MS.
  if (at < 0) phase = standing ? 'arrived' : 'gone';
  else if (standing && at === 0) phase = 'arrived';
  else if (time !== undefined && time * 1000 - nowMs <= ARRIVING_S * 1000 && at === 0) phase = 'arriving';
  else phase = 'coming';
  return {
    line: line.line,
    color: line.color,
    textColor: line.textColor,
    mode: vehicle.mode,
    stop: line.tidy(stop.name),
    ...(time !== undefined && { arrival: time * 1000 }),
    stopsAway: Math.max(at, 0),
    where: whereNow(detail, line.tidy),
    gps: vehicle.source === 'gps',
    startedAt,
    updatedAt: nowMs,
    phase,
  };
}

/**
 * Whether new content is worth sending to the Lock Screen. Apple limits how often a Live Activity may
 * be updated, so small shifts in the arrival time are left to its own countdown.
 */
export function trackChanged(before: TrackProps | null, after: TrackProps): boolean {
  if (!before) return true;
  if (before.phase !== after.phase || before.stopsAway !== after.stopsAway || before.where !== after.where) return true;
  if (before.gps !== after.gps || before.stop !== after.stop) return true;
  if ((before.arrival === undefined) !== (after.arrival === undefined)) return true;
  if (before.arrival !== undefined && after.arrival !== undefined && Math.abs(before.arrival - after.arrival) >= 20_000) return true;
  // Otherwise refresh now and then, so "updated at" stays honest.
  return after.updatedAt - before.updatedAt >= 5 * 60_000;
}

/** How long a Live Activity's content can be trusted: a little past its arrival, else a few minutes. */
export function staleAfter(props: TrackProps): number {
  const base = props.updatedAt + 5 * 60_000;
  return props.arrival !== undefined ? Math.max(base, props.arrival + 2 * 60_000) : base;
}
