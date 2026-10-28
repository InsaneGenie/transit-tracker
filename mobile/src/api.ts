import type { RouteInfo, Vehicle, VehicleDetail } from '../../web/src/api';
import type { Bounds } from './region';

export type { Mode, RouteInfo, UpcomingStop, Vehicle, VehicleDetail } from '../../web/src/api';

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
  return get(`/api/vehicles?bbox=${bounds.map((n) => n.toFixed(4)).join(',')}`, signal);
}

export function fetchVehicleDetail(id: string, signal?: AbortSignal): Promise<VehicleDetail> {
  return get(`/api/vehicles/${encodeURIComponent(id)}`, signal);
}

export function fetchRoutes(signal?: AbortSignal): Promise<{ routes: RouteInfo[] }> {
  return get('/api/routes', signal);
}
