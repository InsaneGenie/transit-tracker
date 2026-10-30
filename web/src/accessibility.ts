import type { UpcomingStop } from './api';

/**
 * The wheelchair symbol marking accessible stations, on a 24×24 grid (Material Design's "accessible"
 * icon, Apache 2.0). Shared by the site's map and lists and the app, whose picture is rendered from it by
 * mobile/scripts/vehicle-icons.mjs.
 */
export const WHEELCHAIR_GLYPH =
  'M12 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' +
  'M19 13v-2c-1.54.02-3.09-.75-4.07-1.83l-1.29-1.43c-.17-.19-.38-.34-.61-.45-.01 0-.01-.01-.02-.01H13c-.35-.2-.75-.3-1.19-.26C10.76 7.11 10 8.04 10 9.09V15c0 1.1.9 2 2 2h5v5h2v-5.5c0-1.1-.9-2-2-2h-3v-3.45c1.29 1.07 3.25 1.94 5 1.95z' +
  'M12.83 18c-.41 1.16-1.52 2-2.83 2-1.66 0-3-1.34-3-3 0-1.31.84-2.41 2-2.83V12.1c-2.28.46-4 2.48-4 4.9 0 2.76 2.24 5 5 5 2.42 0 4.44-1.72 4.9-4h-2.07z';

/** The blue of the International Symbol of Access signs. */
export const ACCESS_BLUE = '#1565c0';

/** What a station's wheelchair symbol means, for its card and for screen readers. */
export function accessLabel(stop: Pick<UpcomingStop, 'access' | 'accessNote'>): string | undefined {
  if (stop.access === 'full') return 'Accessible station';
  if (stop.access === 'partial') return stop.accessNote ? `Partly accessible: ${stop.accessNote}` : 'Partly accessible';
  return undefined;
}

/** Just a stop's accessibility, to carry over to the station picked there. */
export function accessOf(stop: Pick<UpcomingStop, 'access' | 'accessNote'> | undefined): Pick<UpcomingStop, 'access' | 'accessNote'> {
  return stop?.access ? { access: stop.access, accessNote: stop.accessNote } : {};
}
