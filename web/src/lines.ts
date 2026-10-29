import { SEVERITY_COLORS, SEVERITY_LABELS } from './alerts';
import type { AlertSeverity, LineVehicle, Mode, UpcomingStop } from './api';
import { tidyStopName } from './vehicles';

/** "14 trains", "1 bus". */
export function vehicleCount(n: number, mode: Mode): string {
  const noun = mode === 'bus' ? (n === 1 ? 'bus' : 'buses') : n === 1 ? 'train' : 'trains';
  return `${n} ${noun}`;
}

/**
 * How a line is running, from its worst alert and how many vehicles are out: "Delays", "Good service",
 * or "Not running now". `count` is undefined until the counts load.
 */
export function lineStatus(alert: AlertSeverity | undefined, count: number | undefined): { text: string; color?: string } {
  if (alert && alert !== 'info') return { text: SEVERITY_LABELS[alert], color: SEVERITY_COLORS[alert] };
  if (count === 0) return { text: 'Not running now' };
  return { text: 'Good service', color: '#16a34a' };
}

/** Where most of a line's vehicles going one way are headed, or the end of the line that way. */
export function towards(vehicles: LineVehicle[], heading: 1 | -1, stops: UpcomingStop[]): string | undefined {
  const tally = new Map<string, number>();
  for (const v of vehicles) if (v.heading === heading && v.destination) tally.set(v.destination, (tally.get(v.destination) ?? 0) + 1);
  const top = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  const end = heading === 1 ? stops.at(-1) : stops[0];
  const name = top ?? end?.name;
  return name && tidyStopName(name);
}

/** The short name of a bus list on the borough picker. */
export const boroughLabel = (group: string) => (group === 'Shuttles and other' ? 'Other' : group);
