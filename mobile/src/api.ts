import { EXTRA_MODES } from '../../web/src/vehicles';
import type { BikeDocks } from '../../web/src/api';
import type { AlertSeverity, ArrivalDirection, LineService, LineVehicle, RouteInfo, RouteLine, RoutePath, ServiceAlert, UpcomingStop, Vehicle, VehicleDetail } from '../../web/src/api';
import type { LineReport } from '../../web/src/report';
import type { Bounds } from './region';

export type { AlertSeverity, Arrival, BikeDock, BikeDocks, ArrivalDirection, Gap, LineService, LineVehicle, MissingTrip, Mode, RouteInfo, RouteLine, RoutePath, ServiceAlert, UpcomingStop, Vehicle, VehicleDetail } from '../../web/src/api';

/** A station picked from the stop list or the map. */
export type Station = Pick<UpcomingStop, 'stopId' | 'name' | 'transfers' | 'access' | 'accessNote'> & { lon: number; lat: number };

/** The live data server. The app uses the same one as the website. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://transit-tracker-vbfs.onrender.com').replace(/\/$/, '');

/** A sleeping free Render server takes up to a minute to answer, so wait a while before giving up. */
const TIMEOUT_MS = 60_000;

export class NotFoundError extends Error {}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(`${API_URL}${path}`, { signal: controller.signal });
    if (res.status === 404) throw new NotFoundError(`${path} returned 404`);
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

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

/** Every vehicle of a line, placed along its stations. */
export function fetchLineVehicles(line: string, signal?: AbortSignal): Promise<{ vehicles: LineVehicle[]; service?: LineService }> {
  return get(`/api/line-vehicles?line=${encodeURIComponent(line)}`, signal);
}

/** How many vehicles are out on each line, by line key. */
export function fetchLineCounts(signal?: AbortSignal): Promise<{ lines: Record<string, number> }> {
  return get('/api/line-counts', signal);
}

/** The most serious alert on now for each line with one, by line key. */
export function fetchAlertSummary(signal?: AbortSignal): Promise<{ lines: Record<string, AlertSeverity> }> {
  return get('/api/alerts', signal);
}

export function fetchAlerts(keys: string[], signal?: AbortSignal): Promise<{ alerts: ServiceAlert[] }> {
  return get(`/api/alerts?lines=${keys.map(encodeURIComponent).join(',')}`, signal);
}

/** A line's daily report cards, today's first. */
export function fetchReport(line: string, signal?: AbortSignal): Promise<LineReport> {
  return get(`/api/report?line=${encodeURIComponent(line)}`, signal);
}

/** What the server needs to keep a Live Activity up to date while the app is closed. */
export interface LiveActivitySignUp {
  /** The Live Activity's push token, in hex. */
  token: string;
  vehicleId: string;
  stop: { stopId: string; name: string; lat?: number; lon?: number };
  badge: { line: string; color: string; textColor: string };
  startedAt: number;
}

/**
 * Asks the server to push fresh content to a Live Activity. Resolves to whether it will: it can't
 * without an Apple push key, and then the app keeps the Live Activity up to date itself while open.
 */
export async function signUpLiveActivity(body: LiveActivitySignUp): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/live-activities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    return Boolean(((await res.json()) as { push?: boolean }).push);
  } finally {
    clearTimeout(timer);
  }
}

/** Tells the server a Live Activity is over, so it stops pushing to it. */
export async function signOffLiveActivity(token: string): Promise<void> {
  await fetch(`${API_URL}/api/live-activities/${encodeURIComponent(token)}`, { method: 'DELETE' });
}
