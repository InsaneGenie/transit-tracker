/**
 * Links to one train, bus, line or station, for sharing. Opening one shows the map on it with its card open.
 * The site, the app and the server's link previews all read them the same way.
 */

/** The public site, for links shared from the app. The site itself uses its own address. */
export const SITE_URL = 'https://transit-tracker-vbfs.onrender.com';

export type ShareTarget =
  /** `line` is kept so the link still shows the line once the trip has ended. */
  | { vehicle: string; line?: string }
  /** A line, at one of its stations when `station` (a stop id on it) is given. */
  | { line: string; station?: string };

/** Line keys look like `mta-subway:A`; anything else in a link is ignored. */
const LINE_KEY = /^[^:\s]+:.{1,40}$/;

/** What a link points at, from its `?vehicle=…&line=…&station=…`; null when it points at nothing. */
export function parseShare(search: string | URLSearchParams): ShareTarget | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const line = params.get('line') ?? undefined;
  const key = line && LINE_KEY.test(line) ? line : undefined;
  const vehicle = params.get('vehicle');
  if (vehicle) return { vehicle, ...(key && { line: key }) };
  if (!key) return null;
  const station = params.get('station');
  return { line: key, ...(station && { station }) };
}

/** The link to share, on the site at `origin`. */
export function shareUrl(origin: string, target: ShareTarget): string {
  const params = new URLSearchParams();
  if ('vehicle' in target) params.set('vehicle', target.vehicle);
  if (target.line) params.set('line', target.line);
  if ('station' in target && target.station) params.set('station', target.station);
  // Colons and spaces read better left as they are in a pasted link.
  return `${origin.replace(/\/$/, '')}/?${params.toString().replace(/%3A/g, ':').replace(/\+/g, '%20')}`;
}

/** The link without its share parameters, for once it has been opened. Other settings, like `theme`, stay. */
export function withoutShare(url: string): string {
  const u = new URL(url);
  for (const p of ['vehicle', 'line', 'station']) u.searchParams.delete(p);
  return u.pathname + u.search + u.hash;
}

/** What a link shows, in words: "The 5 train to Flatbush Av", "The M15 bus line" or "Fulton St on the A line". */
export function shareTitle(
  shown:
    | { vehicle: { name: string; mode: string; to?: string } }
    | { line: { name: string; mode: string }; station?: string },
): string {
  if ('vehicle' in shown) {
    const { name, mode, to } = shown.vehicle;
    return `The ${name} ${mode === 'bus' ? 'bus' : 'train'}${to ? ` to ${to}` : ''}`;
  }
  const line = `the ${shown.line.name} ${shown.line.mode === 'bus' ? 'bus line' : 'line'}`;
  return shown.station ? `${shown.station} on ${line}` : line[0].toUpperCase() + line.slice(1);
}

/** The words sent with the link, e.g. "The 5 train to Flatbush Av, live on NY Transit Live". */
export function shareText(title: string): string {
  return `${title}, live on NY Transit Live`;
}
