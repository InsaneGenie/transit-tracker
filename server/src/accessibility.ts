import { download, type Access, type StaticIndex } from './static-gtfs.js';

/**
 * The subway's schedule leaves out which stations are accessible, so they come from the MTA's station
 * list on data.ny.gov ("MTA Subway Stations"), which has an ADA column per GTFS station id.
 */
export const SUBWAY_STATIONS_URL =
  'https://data.ny.gov/resource/39hk-dx4f.json?$select=gtfs_stop_id,ada,ada_northbound,ada_southbound,ada_notes,north_direction_label,south_direction_label&$limit=5000';

/** One row of the station list. Every value comes as a string. */
export interface StationRow {
  gtfs_stop_id?: string;
  /** 0 not accessible, 1 accessible, 2 partly accessible. */
  ada?: string;
  ada_northbound?: string;
  ada_southbound?: string;
  ada_notes?: string;
  north_direction_label?: string;
  south_direction_label?: string;
}

export function parseStationAccess(rows: StationRow[]): Map<string, { access: Access; note?: string }> {
  const out = new Map<string, { access: Access; note?: string }>();
  for (const r of rows) {
    const id = r.gtfs_stop_id?.trim();
    if (!id) continue;
    if (r.ada === '1') out.set(id, { access: 'full' });
    else if (r.ada === '2') out.set(id, { access: 'partial', note: partialNote(r) });
  }
  return out;
}

/** Which way a partly accessible station is step-free, like "only toward Manhattan". */
function partialNote(r: StationRow): string | undefined {
  // Blank notes come through as "NaN".
  const notes = r.ada_notes?.trim() && r.ada_notes.trim() !== 'NaN' ? r.ada_notes.trim() : undefined;
  const way = (label?: string) => (label?.trim() && label.trim() !== 'Last Stop' ? `only toward ${label.trim()}` : undefined);
  if (r.ada_northbound === '1' && r.ada_southbound !== '1') return way(r.north_direction_label) ?? notes;
  if (r.ada_southbound === '1' && r.ada_northbound !== '1') return way(r.south_direction_label) ?? notes;
  return notes;
}

/** Marks a schedule's stations (and their platforms) with what the station list says. */
export function applyStationAccess(index: StaticIndex, access: Map<string, { access: Access; note?: string }>): void {
  for (const [id, stop] of index.stops) {
    const station = access.get(id) ?? access.get(id.replace(/[NS]$/, ''));
    if (!station) continue;
    stop.access = station.access;
    if (station.note) stop.accessNote = station.note;
  }
}

export async function loadStationAccess(feedId: string, url: string): Promise<Map<string, { access: Access; note?: string }>> {
  return parseStationAccess(JSON.parse((await download(feedId, url)).toString('utf8')));
}
