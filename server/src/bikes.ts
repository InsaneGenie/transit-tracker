import type { Bbox } from './store.js';

/**
 * Citi Bike docks with how many bikes and free docks each has, from Citi Bike's public GBFS feed (no key).
 * Nothing is fetched until someone turns the layer on, and then at most once a minute, the feed's own refresh.
 */
export const CITI_BIKE_GBFS = 'https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json';

/** Used when the feed's list of files can't be read: where Citi Bike has served them. */
const FALLBACK_FEEDS = {
  station_information: 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json',
  station_status: 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json',
};

/** A dock as the map gets it. */
export interface BikeDock {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Bikes ready to ride, e-bikes included. */
  bikes: number;
  /** How many of `bikes` are electric, when the feed says. */
  ebikes?: number;
  /** Free spots to return a bike to. */
  docks: number;
  /** False when the dock isn't lending bikes right now (bikes can't be taken). */
  renting: boolean;
  /** False when bikes can't be returned there right now. */
  returning: boolean;
}

/** How long the docks' bike counts are reused before asking the feed again, in ms. Matches its refresh. */
const STATUS_MAX_AGE_MS = 60_000;
/** Dock names and places hardly change; asked for again after this long, in ms. */
const INFO_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Counts older than this aren't shown at all, in ms: a dock's bikes come and go too fast to show stale ones. */
const STATUS_STALE_MS = 15 * 60_000;
/**
 * A larger area than this, in degrees either way, gets no docks: thousands of docks zoomed out would cost
 * data and cover the map. Street level on the biggest screens is well inside it.
 */
export const MAX_SPAN_DEG = 0.3;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

type Json = Record<string, unknown>;
export type JsonFetcher = (url: string) => Promise<unknown>;

async function fetchJson(url: string): Promise<unknown> {
  const where = new URL(url).host + new URL(url).pathname;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch((err: Error & { cause?: Error }) => {
    throw new Error(`${where}: ${err.cause?.message ?? err.message}`);
  });
  if (!res.ok) throw new Error(`${where} returned ${res.status}`);
  return res.json();
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** GBFS 2 names a station with a string; GBFS 3 with a list of translations. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const en = value.find((t) => isObject(t) && typeof t.language === 'string' && t.language.startsWith('en')) ?? value[0];
    if (isObject(en) && typeof en.text === 'string') return en.text;
  }
  return '';
}

/** GBFS sends flags as true/false, or as 1/0 in older versions. Missing counts as yes. */
const flag = (value: unknown) => value === undefined || value === null || value === true || value === 1 || value === '1';

const count = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

/** The feed's file addresses by name, from its gbfs.json in GBFS 2 (one list per language) or 3 (one list). */
export function feedUrls(discovery: unknown): Partial<Record<keyof typeof FALLBACK_FEEDS, string>> {
  const data = isObject(discovery) && isObject(discovery.data) ? discovery.data : undefined;
  if (!data) return {};
  const lists = Array.isArray(data.feeds) ? [data.feeds] : [data.en, ...Object.values(data)].flatMap((d) => (isObject(d) && Array.isArray(d.feeds) ? [d.feeds] : []));
  const out: Partial<Record<keyof typeof FALLBACK_FEEDS, string>> = {};
  for (const list of lists) {
    for (const f of list as unknown[]) {
      if (!isObject(f) || typeof f.url !== 'string') continue;
      if ((f.name === 'station_information' || f.name === 'station_status') && !out[f.name]) out[f.name] = f.url;
    }
  }
  return out;
}

interface DockInfo {
  name: string;
  lat: number;
  lon: number;
}

export function parseStationInformation(body: unknown): Map<string, DockInfo> {
  const stations = isObject(body) && isObject(body.data) && Array.isArray(body.data.stations) ? body.data.stations : [];
  const out = new Map<string, DockInfo>();
  for (const s of stations as unknown[]) {
    if (!isObject(s) || (typeof s.station_id !== 'string' && typeof s.station_id !== 'number')) continue;
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    out.set(String(s.station_id), { name: text(s.name), lat: round5(lat), lon: round5(lon) });
  }
  return out;
}

type DockStatus = Pick<BikeDock, 'bikes' | 'ebikes' | 'docks' | 'renting' | 'returning'>;

export function parseStationStatus(body: unknown): Map<string, DockStatus> {
  const stations = isObject(body) && isObject(body.data) && Array.isArray(body.data.stations) ? body.data.stations : [];
  const out = new Map<string, DockStatus>();
  for (const s of stations as unknown[]) {
    if (!isObject(s) || (typeof s.station_id !== 'string' && typeof s.station_id !== 'number')) continue;
    // A dock taken out (for the winter, or for street work) isn't on the street to use.
    if (!flag(s.is_installed)) continue;
    const bikes = count(s.num_bikes_available) ?? count(s.num_vehicles_available);
    const docks = count(s.num_docks_available);
    if (bikes === undefined || docks === undefined) continue;
    const ebikes = count(s.num_ebikes_available);
    out.set(String(s.station_id), {
      bikes,
      ...(ebikes !== undefined && { ebikes: Math.min(ebikes, bikes) }),
      docks,
      renting: flag(s.is_renting),
      returning: flag(s.is_returning),
    });
  }
  return out;
}

export interface BikeStatus {
  updatedAt?: string;
  docks: number;
  lastError?: string;
}

export class BikeStore {
  private info?: { at: number; docks: Map<string, DockInfo> };
  private status?: { at: number; docks: Map<string, DockStatus> };
  private urls?: { at: number; information: string; status: string };
  private refreshing?: Promise<void>;
  /** Every dock with its counts, worked out once per update of either. */
  private joined?: { info: unknown; status: unknown; docks: BikeDock[] };
  lastError?: string;

  constructor(
    private fetcher: JsonFetcher = fetchJson,
    private discoveryUrl = CITI_BIKE_GBFS,
    private clock = () => Date.now(),
  ) {}

  /** The docks inside `bbox`, fetching fresh counts first when there are none yet. */
  async docks(bbox: Bbox): Promise<{ updatedAt?: string; docks: BikeDock[] }> {
    const now = this.clock();
    const fresh = this.status && now - this.status.at < STATUS_MAX_AGE_MS && this.info && now - this.info.at < INFO_MAX_AGE_MS;
    if (!fresh) {
      const refresh = this.refresh();
      // With counts already in hand, answer with them and let the new ones arrive for the next request.
      if (!this.status || now - this.status.at >= STATUS_STALE_MS || !this.info) await refresh;
    }
    if (!this.status || !this.info || this.clock() - this.status.at >= STATUS_STALE_MS) return { docks: [] };
    const [west, south, east, north] = bbox;
    return {
      updatedAt: new Date(this.status.at).toISOString(),
      docks: this.all().filter((d) => d.lon >= west && d.lon <= east && d.lat >= south && d.lat <= north),
    };
  }

  private all(): BikeDock[] {
    const { info, status } = this;
    if (!info || !status) return [];
    if (this.joined?.info === info && this.joined.status === status) return this.joined.docks;
    const docks: BikeDock[] = [];
    for (const [id, s] of status.docks) {
      const place = info.docks.get(id);
      if (place) docks.push({ id, ...place, ...s });
    }
    // A stable order, so the app's map doesn't redraw docks that only moved in the list.
    docks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.joined = { info, status, docks };
    return docks;
  }

  /** One refresh at a time: requests arriving meanwhile wait for the same one. */
  private refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async load(): Promise<void> {
    try {
      const now = this.clock();
      if (!this.urls || now - this.urls.at > INFO_MAX_AGE_MS) {
        const found = await this.fetcher(this.discoveryUrl).then(feedUrls, () => ({}) as ReturnType<typeof feedUrls>);
        this.urls = {
          at: now,
          information: found.station_information ?? FALLBACK_FEEDS.station_information,
          status: found.station_status ?? FALLBACK_FEEDS.station_status,
        };
      }
      const needInfo = !this.info || now - this.info.at >= INFO_MAX_AGE_MS;
      const [info, status] = await Promise.all([
        needInfo ? this.fetcher(this.urls.information).then(parseStationInformation) : undefined,
        this.fetcher(this.urls.status).then(parseStationStatus),
      ]);
      // An empty answer is a feed hiccup; the last good one stands.
      if (info?.size) this.info = { at: now, docks: info };
      if (status.size) this.status = { at: now, docks: status };
      if (!status.size || (needInfo && !info?.size)) throw new Error('Citi Bike feed listed no docks');
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error).message;
      // Ask again from scratch next time, in case the feed moved.
      this.urls = undefined;
    }
  }

  health(): BikeStatus {
    return {
      updatedAt: this.status && new Date(this.status.at).toISOString(),
      docks: this.status?.docks.size ?? 0,
      ...(this.lastError && { lastError: this.lastError }),
    };
  }
}
