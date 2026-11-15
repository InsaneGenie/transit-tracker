// Kept apart from vehicles.ts so the server can use them too, for link previews.

/** What one vehicle of a mode is called: "train", "bus" or "ferry", or with `plural` "trains", "buses", "ferries". */
export function vehicleNoun(mode: string, plural = false): string {
  if (mode === 'bus') return plural ? 'buses' : 'bus';
  if (mode === 'ferry') return plural ? 'ferries' : 'ferry';
  return plural ? 'trains' : 'train';
}

/** Where a vehicle's position comes from, for its panel. */
export function sourceText(v: { source: string; scheduled?: boolean }): string {
  if (v.scheduled) return 'Placed from the timetable; not tracked live';
  return v.source === 'gps' ? 'Live GPS position' : 'Estimated from arrival times';
}

/** Strips Bus Time's agency prefix ("MTA NYCT_M15") from names that arrive without a schedule match. */
export const displayName = (name: string) => name.replace(/^MTA\s*\w*_/, '');

/** Bus stop names come in capitals ("WILLIS AV/E 138 ST"); show them like the subway's ("Willis Av/E 138 St"). */
export function tidyStopName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s/&(-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}
