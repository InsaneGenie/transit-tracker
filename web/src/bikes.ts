import type { BikeDock, Bounds } from './api';

/**
 * Citi Bike docks, shared by the site and the app. Docks show from street level only: there are over two
 * thousand of them, and further out they would bury the trains and buses.
 */
export const BIKE_MIN_ZOOM = 14;

/** Docks' bike counts change every minute or so; the feed itself updates once a minute. */
export const BIKE_POLL_MS = 60_000;

/** The server lists docks for an area at most this many degrees across (see MAX_SPAN_DEG in server/src/bikes.ts). */
const MAX_SPAN_DEG = 0.28;

/** A bicycle on a 24×24 grid, drawn with 1.7-wide round strokes: its two wheels and its frame. */
export const BIKE_WHEELS: [cx: number, cy: number, r: number][] = [
  [7, 14.5, 3],
  [17, 14.5, 3],
];
export const BIKE_FRAME = 'M7 14.5l3-6h5l2 6M10 8.5l2.5 6 2.5-6M9 6.5h2.5';

/** Docks are drawn in this blue, and gray when there's no bike to take. */
export const BIKE_COLOR = '#0369a1';
export const BIKE_EMPTY_COLOR = '#9ca3af';

/**
 * The area to ask for docks in: the view and half as much again on each side, so a short pan needs no new
 * request. Never more than the server lists.
 */
export function bikeArea([west, south, east, north]: Bounds): Bounds {
  const padX = Math.max(0, Math.min((east - west) / 2, (MAX_SPAN_DEG - (east - west)) / 2));
  const padY = Math.max(0, Math.min((north - south) / 2, (MAX_SPAN_DEG - (north - south)) / 2));
  return [west - padX, south - padY, east + padX, north + padY];
}

/** Whether the docks fetched for `area` cover all of `view`. */
export function covers(area: Bounds, view: Bounds): boolean {
  return view[0] >= area[0] && view[1] >= area[1] && view[2] <= area[2] && view[3] <= area[3];
}

/** Whether a bike can be taken from the dock right now. */
export const hasBikes = (d: BikeDock) => d.renting && d.bikes > 0;

/** The dock's color on the map: blue with bikes to take, gray without. */
export const dockColor = (d: BikeDock) => (hasBikes(d) ? BIKE_COLOR : BIKE_EMPTY_COLOR);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 bikes, 3 of them electric", or why none can be taken. */
export function bikesText(d: BikeDock): string {
  if (!d.renting) return 'Not lending bikes right now';
  if (d.bikes === 0) return 'No bikes right now';
  const e = d.ebikes ? (d.ebikes === d.bikes ? `, all electric` : `, ${d.ebikes} electric`) : '';
  return plural(d.bikes, 'bike', 'bikes') + e;
}

/** "8 open docks", or why no bike can be returned. */
export function docksText(d: BikeDock): string {
  if (!d.returning) return 'Not taking returns right now';
  if (d.docks === 0) return 'No open docks right now';
  return plural(d.docks, 'open dock', 'open docks');
}

/** "Updated 2 min ago" from the feed time, or nothing when unknown. */
export function updatedText(updatedAt: string | undefined, now = Date.now()): string {
  if (!updatedAt) return '';
  const minutes = Math.round((now - Date.parse(updatedAt)) / 60_000);
  if (!Number.isFinite(minutes)) return '';
  return minutes <= 0 ? 'Updated just now' : `Updated ${minutes} min ago`;
}
