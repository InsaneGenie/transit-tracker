import type { LineReport } from './report';
import { EXTRA_MODES } from './vehicles';

export type Mode = 'subway' | 'bus' | 'rail' | 'ferry';

/** Mirrors `Vehicle` in server/src/store.ts. */
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
  source: 'gps' | 'estimated';
  /** Placed from the published timetable, with no live data at all (the Staten Island Ferry). */
  scheduled?: boolean;
}

export interface UpcomingStop {
  stopId: string;
  name?: string;
  lat?: number;
  lon?: number;
  time?: number;
  /** Other lines that call here, as `RouteInfo` keys. */
  transfers?: string[];
  /** Step-free from the street to the trains: every platform, or only some of them. */
  access?: 'full' | 'partial';
  /** What a partly accessible station's step-free route reaches, like "only toward Manhattan". */
  accessNote?: string;
}

export interface VehicleDetail {
  vehicle: Vehicle;
  routeLongName?: string;
  upcoming: UpcomingStop[];
  path: [number, number][];
}

/** Mirrors `LineVehicle` in server/src/store.ts. */
export interface LineVehicle {
  vehicle: Vehicle;
  /** Where it is in the line's `stops`: a whole number when at that station, halfway when between two. */
  at: number;
  /** 1 when it is heading toward the end of the line's `stops`, -1 toward the start. */
  heading: 1 | -1;
  destination?: string;
  /** How far behind the next vehicle ahead going the same way it is, for buses. */
  gap?: Gap;
}

/** Mirrors `Gap` in server/src/service.ts. */
export interface Gap {
  aheadId: string;
  meters: number;
  /** About how far behind it is, in minutes, at the line's scheduled pace. */
  minutes?: number;
  kind?: 'bunched' | 'long';
}

/** Mirrors `MissingTrip` in server/src/service.ts: a scheduled trip with no bus behind it. */
export interface MissingTrip {
  tripId: string;
  /** Unix seconds. */
  start: number;
  end: number;
  headsign?: string;
  heading?: 1 | -1;
}

/** Mirrors `LineService` in server/src/service.ts: a bus line against its schedule right now. */
export interface LineService {
  scheduled: number;
  missing: MissingTrip[];
  /** About how often a bus is due each way, in minutes. */
  headways: { forward?: number; back?: number };
  tripMinutes?: number;
}

/** Mirrors `RouteInfo` in server/src/store.ts. */
export interface RouteInfo {
  key: string;
  feed: string;
  agency: string;
  mode: Mode;
  id: string;
  name: string;
  longName?: string;
  color?: string;
}

/** Mirrors `RouteLine` in server/src/store.ts. */
export interface RouteLine {
  key: string;
  mode: Mode;
  color?: string;
  paths: [number, number][][];
  /** Its stations, when the schedule says (subway and rail). */
  stops: UpcomingStop[];
}

/** A line's path alone. Mirrors `RoutePath` in server/src/store.ts. */
export type RoutePath = Omit<RouteLine, 'stops'>;

/** Mirrors `Arrival` in server/src/store.ts. */
export interface Arrival {
  vehicle: Vehicle;
  time: number;
  /** Stops it still makes before the station. */
  stopsAway: number;
  destination?: string;
}

/** Mirrors `ArrivalDirection` in server/src/store.ts. */
export interface ArrivalDirection {
  destinations: string[];
  arrivals: Arrival[];
}

/** A Citi Bike dock. Mirrors `BikeDock` in server/src/bikes.ts. */
export interface BikeDock {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Bikes ready to ride, e-bikes included. */
  bikes: number;
  ebikes?: number;
  /** Free spots to return a bike to. */
  docks: number;
  renting: boolean;
  returning: boolean;
}

/** The docks in an area; `zoomIn` when the area is too big to list them. */
export interface BikeDocks {
  updatedAt?: string;
  zoomIn?: boolean;
  docks: BikeDock[];
}

/** Mirrors `AlertSeverity` in server/src/alerts.ts. */
export type AlertSeverity = 'suspended' | 'delays' | 'changes' | 'info';

/** Mirrors `ServiceAlert` in server/src/alerts.ts. */
export interface ServiceAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  header: string;
  description?: string;
  when?: string;
  start: number;
  end?: number;
  active: boolean;
  lines: string[];
}

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export type Bounds = [west: number, south: number, east: number, north: number];

export function fetchVehicles(bounds: Bounds, signal?: AbortSignal): Promise<{ vehicles: Vehicle[] }> {
  return get(`/api/vehicles?bbox=${bounds.map((n) => n.toFixed(4)).join(',')}&extra=${EXTRA_MODES}`, signal);
}

export function fetchVehicleDetail(id: string, signal?: AbortSignal): Promise<VehicleDetail> {
  return get(`/api/vehicles/${encodeURIComponent(id)}`, signal);
}

export function fetchRoutes(signal?: AbortSignal): Promise<{ routes: RouteInfo[] }> {
  return get(`/api/routes?extra=${EXTRA_MODES}`, signal);
}

export function fetchRouteLines(keys: string[], signal?: AbortSignal): Promise<{ lines: RouteLine[] }> {
  return get(`/api/route-lines?keys=${keys.map(encodeURIComponent).join(',')}`, signal);
}

/** Every subway, rail and ferry line's path, for drawing all of them at once. */
export function fetchRoutePaths(signal?: AbortSignal): Promise<{ lines: RoutePath[] }> {
  return get('/api/route-paths?modes=subway,rail,ferry', signal);
}

/** The Citi Bike docks in an area, with their bikes and free docks. */
export function fetchBikes(bounds: Bounds, signal?: AbortSignal): Promise<BikeDocks> {
  return get(`/api/bikes?bbox=${bounds.map((n) => n.toFixed(4)).join(',')}`, signal);
}

export function fetchArrivals(
  line: string,
  place: { lat: number; lon: number },
  signal?: AbortSignal,
): Promise<{ directions: ArrivalDirection[] }> {
  return get(`/api/arrivals?line=${encodeURIComponent(line)}&lat=${place.lat}&lon=${place.lon}`, signal);
}

/** The most serious alert on now for each line with one, by line key. */
export function fetchAlertSummary(signal?: AbortSignal): Promise<{ lines: Record<string, AlertSeverity> }> {
  return get('/api/alerts', signal);
}

export function fetchAlerts(keys: string[], signal?: AbortSignal): Promise<{ alerts: ServiceAlert[] }> {
  return get(`/api/alerts?lines=${keys.map(encodeURIComponent).join(',')}`, signal);
}

/** Every vehicle of a line, placed along its stations. */
export function fetchLineVehicles(line: string, signal?: AbortSignal): Promise<{ vehicles: LineVehicle[]; service?: LineService }> {
  return get(`/api/line-vehicles?line=${encodeURIComponent(line)}`, signal);
}

/** How many vehicles are out on each line, by line key. */
export function fetchLineCounts(signal?: AbortSignal): Promise<{ lines: Record<string, number> }> {
  return get('/api/line-counts', signal);
}

/** A line's daily report cards, today's first. */
export function fetchReport(line: string, signal?: AbortSignal): Promise<LineReport> {
  return get(`/api/report?line=${encodeURIComponent(line)}`, signal);
}
