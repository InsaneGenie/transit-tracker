export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function distanceMeters(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, 0 = north, clockwise, in degrees. */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * A line with precomputed cumulative distances so points can be found by distance along it. Coordinates
 * are kept in flat number arrays because the schedules hold close to a million shape points.
 */
export class Polyline {
  /** lat, lon, lat, lon, ... */
  private readonly coords: Float64Array;
  private readonly cumulative: Float64Array;

  constructor(points: LatLon[]) {
    this.coords = new Float64Array(points.length * 2);
    this.cumulative = new Float64Array(points.length);
    points.forEach((p, i) => {
      this.coords[i * 2] = p.lat;
      this.coords[i * 2 + 1] = p.lon;
      if (i > 0) this.cumulative[i] = this.cumulative[i - 1] + distanceMeters(points[i - 1], p);
    });
  }

  get size(): number {
    return this.cumulative.length;
  }

  point(i: number): LatLon {
    return { lat: this.coords[i * 2], lon: this.coords[i * 2 + 1] };
  }

  get points(): LatLon[] {
    return Array.from({ length: this.size }, (_, i) => this.point(i));
  }

  get length(): number {
    return this.cumulative[this.size - 1];
  }

  nearestIndex(p: LatLon): number {
    // Flat squared distances rank points the same as true ones over a city, without any trig per point.
    const kx = Math.cos(toRad(p.lat));
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.size; i++) {
      const dy = this.coords[i * 2] - p.lat;
      const dx = (this.coords[i * 2 + 1] - p.lon) * kx;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Where along the line `p` is closest, as a point index plus the fraction of the way on to the next point,
   * so a spot between two far-apart points falls between them rather than at either one.
   */
  measure(p: LatLon): number {
    const kx = Math.cos(toRad(p.lat));
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.size; i++) {
      const ay = this.coords[i * 2];
      const ax = this.coords[i * 2 + 1] * kx;
      let t = 0;
      if (i + 1 < this.size) {
        const dy = this.coords[i * 2 + 2] - ay;
        const dx = this.coords[i * 2 + 3] * kx - ax;
        const len = dx * dx + dy * dy;
        t = len > 0 ? Math.min(1, Math.max(0, ((p.lon * kx - ax) * dx + (p.lat - ay) * dy) / len)) : 0;
      }
      const y = ay + (i + 1 < this.size ? (this.coords[i * 2 + 2] - ay) * t : 0) - p.lat;
      const x = ax + (i + 1 < this.size ? (this.coords[i * 2 + 3] * kx - ax) * t : 0) - p.lon * kx;
      const d = x * x + y * y;
      if (d < bestDist) {
        bestDist = d;
        best = i + t;
      }
    }
    return best;
  }

  /** How far along the line, in meters, it passes closest to `p`. */
  metersAlong(p: LatLon): number {
    const m = this.measure(p);
    const i = Math.floor(m);
    return i + 1 < this.size ? this.cumulative[i] + (this.cumulative[i + 1] - this.cumulative[i]) * (m - i) : this.cumulative[i];
  }

  /** The part of this line between where it passes closest to `from` and to `to`, in travel order. */
  slice(from: LatLon, to: LatLon): Polyline {
    const i = this.measure(from);
    const j = this.measure(to);
    const pts = [];
    if (i <= j) for (let k = Math.floor(i) + 1; k < j; k++) pts.push(this.point(k));
    else for (let k = Math.ceil(i) - 1; k > j; k--) pts.push(this.point(k));
    return new Polyline([from, ...pts, to]);
  }

  /** Position and heading at a fraction (0..1) of the way along the line. */
  at(fraction: number): LatLon & { bearing: number } {
    const n = this.size;
    if (n === 1) return { ...this.point(0), bearing: 0 };
    const target = Math.min(1, Math.max(0, fraction)) * this.length;
    let i = 1;
    while (i < n - 1 && this.cumulative[i] < target) i++;
    const a = this.point(i - 1);
    const b = this.point(i);
    const segLen = this.cumulative[i] - this.cumulative[i - 1];
    const t = segLen > 0 ? (target - this.cumulative[i - 1]) / segLen : 0;
    return {
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      bearing: bearingDegrees(a, b),
    };
  }
}

/** The point on a path ([lon, lat] pairs) closest to `p`, and how far away it is in meters. */
export function nearestOnPath(p: LatLon, path: [number, number][]): LatLon & { meters: number } {
  // Flat x/y in meters around p is plenty accurate over the few hundred meters that matter here.
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(p.lat));
  const ky = toRad(1) * EARTH_RADIUS_M;
  let best = { lat: p.lat, lon: p.lon, meters: Infinity };
  for (let i = 0; i < path.length; i++) {
    const [ax, ay] = [(path[i][0] - p.lon) * kx, (path[i][1] - p.lat) * ky];
    const [bx, by] = i + 1 < path.length ? [(path[i + 1][0] - p.lon) * kx, (path[i + 1][1] - p.lat) * ky] : [ax, ay];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * (bx - ax) + ay * (by - ay)) / len2)) : 0;
    const [x, y] = [ax + (bx - ax) * t, ay + (by - ay) * t];
    const meters = Math.hypot(x, y);
    if (meters < best.meters) best = { lat: p.lat + y / ky, lon: p.lon + x / kx, meters };
  }
  return best;
}

/**
 * A path ([lon, lat] pairs) with the points that bend it less than `meters` left out
 * (Douglas-Peucker), so it looks the same on the map with far fewer points.
 */
export function simplifyPath(path: [number, number][], meters: number): [number, number][] {
  if (path.length < 3) return path;
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(path[0][1]));
  const ky = toRad(1) * EARTH_RADIUS_M;
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = [path[first][0] * kx, path[first][1] * ky];
    const [dx, dy] = [path[last][0] * kx - ax, path[last][1] * ky - ay];
    const len2 = dx * dx + dy * dy;
    let farthest = -1;
    let most = meters;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = [path[i][0] * kx - ax, path[i][1] * ky - ay];
      const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
      const off = Math.hypot(px - dx * t, py - dy * t);
      if (off > most) [farthest, most] = [i, off];
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return path.filter((_, i) => keep[i]);
}
