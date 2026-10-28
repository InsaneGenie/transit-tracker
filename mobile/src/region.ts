import type { Region } from 'react-native-maps';
import type { Vehicle } from './api';

export type Bounds = [west: number, south: number, east: number, north: number];

/** The web map's zoom level for a region this wide on a screen this wide, so both use the same thresholds. */
export function zoomOf(region: Region, screenWidth: number): number {
  return Math.log2((360 * screenWidth) / (512 * region.longitudeDelta));
}

export function boundsOf(region: Region): Bounds {
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  return [
    longitude - longitudeDelta / 2,
    latitude - latitudeDelta / 2,
    longitude + longitudeDelta / 2,
    latitude + latitudeDelta / 2,
  ];
}

/**
 * Below this zoom vehicles are hidden and not fetched. Higher than the web map's 10: every dot is a
 * native view here, and all of New York's thousands of buses at once would make the map stutter.
 */
export const VEHICLE_MIN_ZOOM = 11.5;
/** The most dots drawn at once; the ones nearest the middle of the screen win. */
export const MAX_MARKERS = 300;
/** Line names appear on the dots from this zoom. */
export const LABEL_MIN_ZOOM = 14;

/** Closer in, there are fewer vehicles on screen and each one's movement is visible, so update more often. */
export function pollMsFor(zoom: number): number {
  return zoom >= 15 ? 2000 : zoom >= 13 ? 3000 : 5000;
}

/** The `max` vehicles closest to the middle of the region. */
export function nearestToCenter(vehicles: Vehicle[], region: Region, max = MAX_MARKERS): Vehicle[] {
  if (vehicles.length <= max) return vehicles;
  // Longitude degrees are shorter than latitude degrees this far north.
  const k = Math.cos((region.latitude * Math.PI) / 180);
  const dist = (v: Vehicle) => ((v.lon - region.longitude) * k) ** 2 + (v.lat - region.latitude) ** 2;
  return [...vehicles].sort((a, b) => dist(a) - dist(b)).slice(0, max);
}
