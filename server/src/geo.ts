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

/** A line with precomputed cumulative distances so points can be found by distance along it. */
export class Polyline {
  readonly points: LatLon[];
  readonly cumulative: number[];

  constructor(points: LatLon[]) {
    this.points = points;
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
    }
  }

  get length(): number {
    return this.cumulative[this.cumulative.length - 1];
  }

  nearestIndex(p: LatLon): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const d = distanceMeters(this.points[i], p);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** The part of this line between the points nearest to `from` and `to`, in travel order. */
  slice(from: LatLon, to: LatLon): Polyline {
    const i = this.nearestIndex(from);
    const j = this.nearestIndex(to);
    const pts = i <= j ? this.points.slice(i, j + 1) : this.points.slice(j, i + 1).reverse();
    return new Polyline([from, ...pts, to]);
  }

  /** Position and heading at a fraction (0..1) of the way along the line. */
  at(fraction: number): LatLon & { bearing: number } {
    const n = this.points.length;
    if (n === 1) return { ...this.points[0], bearing: 0 };
    const target = Math.min(1, Math.max(0, fraction)) * this.length;
    let i = 1;
    while (i < n - 1 && this.cumulative[i] < target) i++;
    const a = this.points[i - 1];
    const b = this.points[i];
    const segLen = this.cumulative[i] - this.cumulative[i - 1];
    const t = segLen > 0 ? (target - this.cumulative[i - 1]) / segLen : 0;
    return {
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      bearing: bearingDegrees(a, b),
    };
  }
}
