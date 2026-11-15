import type { Gap, LineService, LineVehicle, MissingTrip } from './api';

/**
 * Words for ghost buses and bunching on a bus line's page, shared with the app. The server finds them
 * (server/src/service.ts): a ghost bus is a scheduled trip with no bus behind it, and bunched buses run
 * right behind each other, leaving a long gap somewhere else.
 */

export const SERVICE_COLORS = { good: '#16a34a', missing: '#d97706', bunched: '#ea580c', long: '#dc2626' };

/** "All 18 scheduled buses are running", or "3 of 18 scheduled buses missing". */
export function ghostSummary(service: LineService): { text: string; color?: string } {
  const missing = service.missing.length;
  if (!service.scheduled && !missing) return { text: 'No buses are scheduled out right now' };
  if (!missing) {
    return { text: service.scheduled === 1 ? 'The 1 scheduled bus is running' : `All ${service.scheduled} scheduled buses are running`, color: SERVICE_COLORS.good };
  }
  return { text: `${missing} of ${service.scheduled} scheduled ${service.scheduled === 1 ? 'bus' : 'buses'} missing`, color: SERVICE_COLORS.missing };
}

/** "SELECT BUS SERVICE SOUTH FERRY via 2 AV" -> "South Ferry via 2 Av": the badge already says it is a Select Bus. */
export function tidyHeadsign(headsign: string): string {
  return headsign
    .replace(/^(SELECT BUS SERVICE|SELECT BUS|SBS)\s+/i, '')
    .split(' ')
    .map((word) => (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word) ? word[0] + word.slice(1).toLowerCase() : word))
    .join(' ');
}

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "4:52 PM to South Ferry" and "due out 21 min ago". */
export function missingTripText(trip: MissingTrip, now = Date.now() / 1000): { title: string; when: string } {
  const title = `${clock(trip.start)} trip${trip.headsign ? ` to ${tidyHeadsign(trip.headsign)}` : ''}`;
  const ago = Math.max(0, Math.round((now - trip.start) / 60));
  return { title, when: ago >= 60 ? `due out at ${clock(trip.start)}, still no bus` : `due out ${ago} min ago` };
}

/** The scheduled time between buses going the way the page shows. */
export const headwayFor = (service: LineService | undefined, heading: 1 | -1) =>
  heading === 1 ? service?.headways.forward : service?.headways.back;

/**
 * How evenly the buses going one way are spread: "3 buses bunched · 18 min gap", or "Evenly spaced". Undefined
 * when there is nothing to say, as with no buses or gaps that can't be timed.
 */
export function spacingSummary(going: LineVehicle[], headway: number | undefined): { text: string; color?: string } | undefined {
  const bunched = new Set<string>();
  let longest: number | undefined;
  for (const v of going) {
    if (v.gap?.kind === 'bunched') bunched.add(v.vehicle.id).add(v.gap.aheadId);
    if (v.gap?.kind === 'long' && v.gap.minutes !== undefined) longest = Math.max(longest ?? 0, v.gap.minutes);
  }
  const every = headway ? ` (due every ${headway} min)` : '';
  const parts = [];
  if (bunched.size) parts.push(`${bunched.size} buses bunched`);
  if (longest !== undefined) parts.push(`${Math.round(longest)} min gap`);
  if (parts.length) return { text: parts.join(' · ') + every, color: bunched.size ? SERVICE_COLORS.bunched : SERVICE_COLORS.long };
  const timed = going.filter((v) => v.gap?.minutes !== undefined);
  if (timed.length) return { text: `Evenly spaced${every}`, color: SERVICE_COLORS.good };
  return undefined;
}

/** The label on a gap drawn on the line's strip, for bunched buses and long gaps. */
export function gapLabel(gap: Gap): string | undefined {
  if (gap.kind === 'bunched') return 'Bunched';
  if (gap.kind === 'long' && gap.minutes !== undefined) return `${Math.round(gap.minutes)} min gap`;
  return undefined;
}

/** A stretch of the line's strip to mark: buses bunched together, or a long gap between two. */
export interface StripMark {
  key: string;
  kind: 'bunched' | 'long';
  /** Rows down the strip, from <= to. */
  from: number;
  to: number;
  label: string;
}

/**
 * The stretches of the strip to mark, the way the page shows the line. `place` turns a vehicle into its
 * row. Buses bunched one behind another are marked together, so three in a row read "3 buses bunched".
 */
export function stripMarks(going: LineVehicle[], place: (v: LineVehicle) => number): StripMark[] {
  const byId = new Map(going.map((v) => [v.vehicle.id, v]));
  const marks: StripMark[] = [];
  const bunches: { from: number; to: number; ids: Set<string> }[] = [];
  for (const v of going) {
    const ahead = v.gap && byId.get(v.gap.aheadId);
    if (!v.gap?.kind || !ahead) continue;
    const [a, b] = [place(v), place(ahead)];
    const [from, to] = [Math.min(a, b), Math.max(a, b)];
    if (v.gap.kind === 'long') {
      const label = gapLabel(v.gap);
      if (label) marks.push({ key: `gap-${v.vehicle.id}`, kind: 'long', from, to, label });
      continue;
    }
    const joins = bunches.find((x) => x.ids.has(v.vehicle.id) || x.ids.has(ahead.vehicle.id));
    if (joins) {
      joins.from = Math.min(joins.from, from);
      joins.to = Math.max(joins.to, to);
      joins.ids.add(v.vehicle.id).add(ahead.vehicle.id);
    } else {
      bunches.push({ from, to, ids: new Set([v.vehicle.id, ahead.vehicle.id]) });
    }
  }
  for (const b of bunches) marks.push({ key: `bunch-${[...b.ids].sort()[0]}`, kind: 'bunched', from: b.from, to: b.to, label: `${b.ids.size} bunched` });
  return marks.sort((a, b) => a.from - b.from);
}
