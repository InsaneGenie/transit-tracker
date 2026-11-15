import type { ConnectionDirection, LineConnection, Mode, RouteInfo, StopConnections } from './api';
import { tidyStopName, transferLines } from './vehicles';

/**
 * How a connection lines up: there's time to change, it's tight (it comes before the change is likely
 * done), or none is listed after you arrive yet (the feeds only look so far ahead).
 */
export type ConnectionStatus = 'connects' | 'tight' | 'none';

export interface ConnectionView {
  status: ConnectionStatus;
  /** Shown beside the way it goes, like "4 min wait". */
  text: string;
  /** A second line: the next one when this is tight, or one you'll just miss. */
  note?: string;
  /** The vehicle you would catch, to open it. */
  vehicleId?: string;
}

const NEAR_MISS_S = 150;

/** Subway bullets first, then railroad branches, buses and boats: the short badges line up best together. */
const MODE_ORDER: Record<Mode, number> = { subway: 0, rail: 1, bus: 2, ferry: 3 };

const minutes = (seconds: number) => Math.max(0, Math.round(seconds / 60));

/** One way of a connecting line, put in words, against when you get to the station. */
export function describeConnection(d: ConnectionDirection, arrive: number): ConnectionView {
  // One leaving more than a couple of minutes before you get there is no near miss.
  const missedBy = d.missed && arrive - d.missed.time <= NEAR_MISS_S ? minutes(arrive - d.missed.time) : undefined;
  const missed = missedBy === undefined ? undefined : missedBy === 0 ? 'Just misses one' : `Just misses one by ${missedBy} min`;
  if (!d.catch) return { status: 'none', text: 'None listed yet', note: missed };
  const wait = minutes(d.catch.time - arrive);
  if (d.catch.time - arrive >= d.changeSeconds) {
    return { status: 'connects', text: `${wait} min wait`, note: missed, vehicleId: d.catch.vehicleId };
  }
  const next = d.next && `Next one: ${minutes(d.next.time - arrive)} min wait`;
  return {
    status: 'tight',
    text: wait === 0 ? 'Tight: as you arrive' : `Tight: ${wait} min to change`,
    note: next ?? missed,
    vehicleId: d.catch.vehicleId,
  };
}

/** Where a connecting line goes one way, like "To Pelham Bay Park". */
export function connectionHeading(d: ConnectionDirection): string {
  return d.destinations.length ? `To ${d.destinations.map(tidyStopName).join(' / ')}` : 'On the way';
}

/**
 * A station's connecting lines that are known, with their routes: subway lines, then railroad branches,
 * then buses, each in the order transfer badges are shown (and without express twins, like the 7X).
 */
export function connectionLines(stop: StopConnections, routes: Map<string, RouteInfo>): { route: RouteInfo; connection: LineConnection }[] {
  const byLine = new Map(stop.lines.map((l) => [l.line, l]));
  return transferLines([...byLine.keys()], routes)
    .sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode])
    .map((route) => ({ route, connection: byLine.get(route.key)! }));
}

/** A station's summary line: how many lines are running there, and how many of those are tight. */
export function connectionSummary(stop: StopConnections, routes: Map<string, RouteInfo>): string {
  const running = connectionLines(stop, routes).filter(({ connection }) => connection.directions.length > 0);
  if (!running.length) return 'Nothing on the way yet';
  const tight = running.filter(({ connection }) =>
    connection.directions.some((d) => describeConnection(d, stop.time).status === 'tight'),
  ).length;
  const noun = `${running.length} line${running.length === 1 ? '' : 's'}`;
  return tight ? `${noun} · ${tight} tight` : noun;
}
