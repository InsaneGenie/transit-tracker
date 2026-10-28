import type { Bounds, Mode, Vehicle } from './api';

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
          mode: v.mode,
          label: (v.routeName ?? v.routeId ?? '').replace(/^MTA\s*\w*_/, ''),
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

/** Grows map bounds by a fraction of their size on every side, so small pans need no new fetch. */
export function padBounds([w, s, e, n]: Bounds, fraction: number): Bounds {
  const dx = (e - w) * fraction;
  const dy = (n - s) * fraction;
  return [w - dx, s - dy, e + dx, n + dy];
}

export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}
