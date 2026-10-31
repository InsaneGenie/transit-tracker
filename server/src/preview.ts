import type { IncomingMessage } from 'node:http';
import { parseShare, shareTitle, type ShareTarget } from '../../web/src/share.js';
import { displayName, tidyStopName } from '../../web/src/names.js';
import type { VehicleStore } from './store.js';

/** What a pasted link says: the page's title and the line under it. */
export interface Preview {
  title: string;
  description: string;
}

/** The site's address as the visitor sees it. Render answers on https and says so in x-forwarded-proto. */
export function originOf(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || 'http';
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

/** The words for the train, bus, line or station a shared link shows; null when it shows nothing known. */
export function describeShare(store: VehicleStore, target: ShareTarget, now: number): Preview | null {
  if ('vehicle' in target) {
    const detail = store.detail(target.vehicle, now);
    if (detail) {
      const { vehicle, upcoming } = detail;
      const to = upcoming[upcoming.length - 1]?.name;
      const next = upcoming[0]?.name;
      const noun = vehicle.mode === 'bus' ? 'bus' : 'train';
      return {
        title: shareTitle({ vehicle: { name: displayName(vehicle.routeName ?? vehicle.routeId ?? '?'), mode: vehicle.mode, to: to && tidyStopName(to) } }),
        description: `${next ? `Next stop: ${tidyStopName(next)}. ` : ''}Watch this ${noun} move live on the map, with its stops and arrival times.`,
      };
    }
    // The trip has ended; the link shows its line instead.
    if (!target.line) return null;
    target = { line: target.line };
  }
  const info = store.routes().find((r) => r.key === target.line);
  if (!info) return null;
  const name = displayName(info.name);
  const nouns = info.mode === 'bus' ? 'buses' : 'trains';
  const stop = target.station ? store.routeLines([info.key])[0]?.stops.find((s) => s.stopId === target.station) : undefined;
  if (stop?.name) {
    const station = tidyStopName(stop.name);
    return {
      title: shareTitle({ line: { name, mode: info.mode }, station }),
      description: `The ${name} ${nouns} on their way to ${station}, live, with arrival times both ways.`,
    };
  }
  const long = info.longName && info.longName !== info.name ? ` (${info.longName})` : '';
  return {
    title: shareTitle({ line: { name, mode: info.mode } }),
    description:
      info.mode === 'bus'
        ? `Every ${name} bus${long}, live on the map, with delays and service changes.`
        : `Every station and train on the ${name} line${long}, live, with delays and service changes.`,
  };
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sets a `<meta>` tag's content, by its `property` or `name`. */
function setMeta(html: string, key: string, value: string): string {
  const tag = new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*(")`);
  return html.replace(tag, (_, start: string, end: string) => start + escape(value) + end);
}

/**
 * The map page for this request: link previews need whole addresses, and a shared link's preview names the
 * train, line or station it shows.
 */
export function pageFor(html: string, url: URL, origin: string, store: VehicleStore, now: number): string {
  let page = html;
  for (const key of ['og:image', 'twitter:image']) page = setMeta(page, key, `${origin}/og-image.png`);
  page = setMeta(page, 'og:url', origin + url.pathname + url.search);

  const target = parseShare(url.searchParams);
  const preview = target && describeShare(store, target, now);
  if (!preview) return page;
  page = page.replace(/<title>[^<]*<\/title>/, `<title>${escape(`${preview.title} · NY Transit Live`)}</title>`);
  for (const key of ['og:title', 'twitter:title']) page = setMeta(page, key, preview.title);
  for (const key of ['description', 'og:description', 'twitter:description']) page = setMeta(page, key, preview.description);
  return page;
}
