import type { Mode, RouteInfo, Vehicle } from './api';

const MODE_COLORS: Record<Mode, string> = { subway: '#4b5563', rail: '#7c3aed', bus: '#2563eb' };

export function colorFor(v: Pick<Vehicle, 'routeColor' | 'mode'>): string {
  return v.routeColor ? `#${v.routeColor.replace(/^#/, '')}` : MODE_COLORS[v.mode];
}

/** Text color that stays readable on a route's color (the yellow N/Q/R/W needs black). */
export function textColorFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#ffffff';
}

export const routeKey = (v: Pick<Vehicle, 'feed' | 'routeId'>) => `${v.feed}:${v.routeId ?? ''}`;

/** Strips Bus Time's agency prefix ("MTA NYCT_M15") from names that arrive without a schedule match. */
export const displayName = (name: string) => name.replace(/^MTA\s*\w*_/, '');

export function toFeatureCollection(vehicles: Vehicle[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: vehicles.map((v) => {
      const color = colorFor(v);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: {
          id: v.id,
          routeKey: routeKey(v),
          mode: v.mode,
          label: displayName(v.routeName ?? v.routeId ?? ''),
          color,
          textColor: textColorFor(color),
          bearing: v.bearing ?? 0,
          hasBearing: v.bearing !== undefined,
          estimated: v.source === 'estimated',
        },
      };
    }),
  };
}

/** Positions part-way between two updates, so dots glide instead of jumping. */
export function interpolate(from: Map<string, Vehicle>, to: Vehicle[], t: number): Vehicle[] {
  const k = Math.min(1, Math.max(0, t));
  return to.map((v) => {
    const prev = from.get(v.id);
    if (!prev || k >= 1) return v;
    // A big jump is a new trip or bad data; snap rather than sweep across the map.
    if (Math.abs(prev.lat - v.lat) + Math.abs(prev.lon - v.lon) > 0.05) return v;
    return { ...v, lat: prev.lat + (v.lat - prev.lat) * k, lon: prev.lon + (v.lon - prev.lon) * k };
  });
}

export function formatEta(time: number | undefined, now = Date.now() / 1000): string {
  if (time === undefined) return '';
  const minutes = Math.round((time - now) / 60);
  if (minutes <= 0) return 'Now';
  if (minutes < 60) return `${minutes} min`;
  return new Date(time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const MODE_LABELS: Record<Mode, string> = { subway: 'Subway', rail: 'Rail', bus: 'Bus' };


/** Bus stop names come in capitals ("WILLIS AV/E 138 ST"); show them like the subway's ("Willis Av/E 138 St"). */
export function tidyStopName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s/&(-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export interface LegendGroup {
  title: string;
  color?: string;
  routes: RouteInfo[];
}

const byName = (a: RouteInfo, b: RouteInfo) => a.name.localeCompare(b.name, undefined, { numeric: true });

const BUS_GROUPS = ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island', 'Express', 'Shuttles and other'];

/** Which list a bus route goes in, from its name: Bx12 is the Bronx, QM2 is an express bus, and so on. */
export function busGroup(name: string): string {
  const n = name.toUpperCase();
  if (/^(BXM|BM|QM|SIM|X)\d/.test(n)) return 'Express';
  if (/^BX\d/.test(n)) return 'Bronx';
  if (/^B\d/.test(n)) return 'Brooklyn';
  if (/^M\d/.test(n)) return 'Manhattan';
  if (/^Q\d/.test(n)) return 'Queens';
  if (/^S\d/.test(n)) return 'Staten Island';
  return 'Shuttles and other';
}

/**
 * Lines arranged for the legend: subway lines grouped by their shared color (1 2 3 are all red),
 * rail lines by railroad, and buses by borough, with express buses on their own.
 */
export function legendGroups(routes: RouteInfo[], mode: Mode): LegendGroup[] {
  const of = routes.filter((r) => r.mode === mode);
  const groups = new Map<string, RouteInfo[]>();
  for (const r of of) {
    const key = mode === 'subway' ? (r.color ?? '').toUpperCase() : mode === 'rail' ? r.agency : busGroup(r.name);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => ({
      title: mode === 'subway' ? '' : key,
      color: mode === 'subway' && key ? `#${key}` : undefined,
      routes: rs.sort(byName),
    }))
    .sort((a, b) =>
      mode === 'rail'
        ? a.title.localeCompare(b.title)
        : mode === 'bus'
          ? BUS_GROUPS.indexOf(a.title) - BUS_GROUPS.indexOf(b.title)
          : byName(a.routes[0], b.routes[0]),
    );
}

/**
 * The lines to show as transfers at a stop, in legend order. Express variants (7X, 6X) are left out
 * when the regular line is there too, since they share its bullet.
 */
export function transferLines(keys: string[] | undefined, routes: Map<string, RouteInfo>): RouteInfo[] {
  const found = (keys ?? []).flatMap((k) => routes.get(k) ?? []);
  const names = new Set(found.map((r) => r.name));
  return found
    .filter((r) => !(r.mode === 'subway' && r.name.endsWith('X') && names.has(r.name.slice(0, -1))))
    .sort(byName);
}
