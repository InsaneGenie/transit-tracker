// Kept apart from vehicles.ts so the server can use them too, for link previews.

/** Strips Bus Time's agency prefix ("MTA NYCT_M15") from names that arrive without a schedule match. */
export const displayName = (name: string) => name.replace(/^MTA\s*\w*_/, '');

/** Bus stop names come in capitals ("WILLIS AV/E 138 ST"); show them like the subway's ("Willis Av/E 138 St"). */
export function tidyStopName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s/&(-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}
