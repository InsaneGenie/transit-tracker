import type { RouteInfo, UpcomingStop, Vehicle } from './api';
import { displayName, tidyStopName } from './vehicles';

/**
 * A line opened from a station's transfers or one of its stations on the map. `atStation` keeps the map on
 * the tapped station instead of the whole line.
 */
export type ViewLine = {
  key: string;
  atStation?: boolean;
  /** The stops ahead of the vehicle it was opened from, so its stations read in that vehicle's direction. */
  ahead?: UpcomingStop[];
};

/**
 * What the panel showed before something in it was tapped, so Back can show it again: a vehicle, or a line
 * opened on its own (the line stays under a vehicle picked from it), and the station picked in it.
 */
export type PanelStep<S> = {
  vehicleId: string | null;
  line: ViewLine | null;
  station: S | null;
  /** Where Back goes, e.g. "the 5 train · Fulton St". */
  label: string;
};

/** Going back further than this is unlikely; older steps are forgotten. */
export const MAX_STEPS = 30;

/** Remember a step, unless it's the one Back would already go to. */
export function pushStep<S>(steps: PanelStep<S>[], step: PanelStep<S> | null): PanelStep<S>[] {
  if (!step) return steps;
  const last = steps[steps.length - 1];
  if (last && last.label === step.label && last.vehicleId === step.vehicleId && last.line?.key === step.line?.key) {
    return steps;
  }
  return [...steps, step].slice(-MAX_STEPS);
}

/** "the 5 train", "the M15 bus" or "the 5 line", with the picked station after it. */
export function stepLabel(
  shown: { vehicle: Pick<Vehicle, 'mode' | 'routeName' | 'routeId'> } | { lineKey: string; info?: RouteInfo },
  station: { name?: string } | null,
): string {
  const what =
    'vehicle' in shown
      ? `the ${displayName(shown.vehicle.routeName ?? shown.vehicle.routeId ?? '')} ${shown.vehicle.mode === 'bus' ? 'bus' : 'train'}`
      : `the ${displayName(shown.info?.name ?? shown.lineKey.split(':')[1] ?? '?')} line`;
  return station?.name ? `${what} · ${tidyStopName(station.name)}` : what;
}
