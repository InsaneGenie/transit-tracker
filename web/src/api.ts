export type Mode = 'subway' | 'bus' | 'rail';

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
}

export interface UpcomingStop {
  stopId: string;
  name?: string;
  lat?: number;
  lon?: number;
  time?: number;
}

export interface VehicleDetail {
  vehicle: Vehicle;
  routeLongName?: string;
  upcoming: UpcomingStop[];
  path: [number, number][];
}

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export type Bounds = [west: number, south: number, east: number, north: number];

export function fetchVehicles(bounds: Bounds, signal?: AbortSignal): Promise<{ vehicles: Vehicle[] }> {
  return get(`/api/vehicles?bbox=${bounds.map((n) => n.toFixed(4)).join(',')}`, signal);
}

export function fetchVehicleDetail(id: string, signal?: AbortSignal): Promise<VehicleDetail> {
  return get(`/api/vehicles/${encodeURIComponent(id)}`, signal);
}
