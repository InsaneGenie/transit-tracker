import { SUBWAY_STATIONS_URL } from './accessibility.js';

export type Mode = 'subway' | 'bus' | 'rail';

export interface FeedConfig {
  id: string;
  agency: string;
  mode: Mode;
  /** GTFS-Realtime protobuf URLs. Several URLs are merged into one feed. */
  realtimeUrls: string[];
  /** Static GTFS zips, used for stop names, route colors, track shapes and estimating positions. */
  staticUrls?: string[];
  /**
   * "full" also learns travel times between stops, which estimating positions needs. "stops" skips that
   * (it means reading every scheduled stop time) for feeds whose vehicles all report GPS.
   */
  staticDetail?: 'full' | 'stops';
  /** Where to learn which stations are accessible, when the schedule doesn't say (see accessibility.ts). */
  accessibilityUrl?: string;
  /** Realtime ids carry an agency prefix the schedule lacks, like `MTA NYCT_M15` for route `M15`. */
  agencyPrefixedIds?: boolean;
  /**
   * Trip updates keep the stops a train has already passed (the subway's drop them), so a trip whose
   * first listed stop is still ahead has not left its first stop yet.
   */
  keepsPastStops?: boolean;
  /**
   * Vehicle bearings are degrees counter-clockwise from east (SIRI's convention, which Bus Time keeps in its
   * GTFS-Realtime feed) rather than GTFS-Realtime's clockwise from north.
   */
  bearingFromEast?: boolean;
  /** Environment variable holding an API key, appended as `?key=`. The feed is skipped when it is unset. */
  apiKeyEnv?: string;
  pollSeconds: number;
}

const MTA_RT = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/';
const MTA_STATIC = 'https://rrgtfsfeeds.s3.amazonaws.com/';

const subwayGroups = ['gtfs', 'gtfs-ace', 'gtfs-bdfm', 'gtfs-g', 'gtfs-jz', 'gtfs-nqrw', 'gtfs-l', 'gtfs-si'];

/**
 * New York State feeds. Other states are added as more entries here.
 * Upstate agencies (CDTA, NFTA, RTS, Centro) are not listed yet: their realtime URLs still need confirming.
 */
export const FEEDS: FeedConfig[] = [
  {
    id: 'mta-subway',
    agency: 'MTA New York City Transit',
    mode: 'subway',
    realtimeUrls: subwayGroups.map((g) => `${MTA_RT}nyct%2F${g}`),
    staticUrls: [`${MTA_STATIC}gtfs_subway.zip`],
    accessibilityUrl: SUBWAY_STATIONS_URL,
    pollSeconds: 20,
  },
  {
    id: 'mta-lirr',
    agency: 'Long Island Rail Road',
    mode: 'rail',
    realtimeUrls: [`${MTA_RT}lirr%2Fgtfs-lirr`],
    staticUrls: [`${MTA_STATIC}gtfslirr.zip`],
    keepsPastStops: true,
    pollSeconds: 30,
  },
  {
    id: 'mta-mnr',
    agency: 'Metro-North Railroad',
    mode: 'rail',
    realtimeUrls: [`${MTA_RT}mnr%2Fgtfs-mnr`],
    staticUrls: [`${MTA_STATIC}gtfsmnr.zip`],
    keepsPastStops: true,
    pollSeconds: 30,
  },
  {
    id: 'mta-bus',
    agency: 'MTA Bus',
    mode: 'bus',
    // Positions, plus trip updates for each bus's upcoming stops and arrival times.
    realtimeUrls: ['https://gtfsrt.prod.obanyc.com/vehiclePositions', 'https://gtfsrt.prod.obanyc.com/tripUpdates'],
    staticUrls: ['gtfs_bx', 'gtfs_b', 'gtfs_m', 'gtfs_q', 'gtfs_si', 'gtfs_busco'].map((z) => `${MTA_STATIC}${z}.zip`),
    staticDetail: 'stops',
    agencyPrefixedIds: true,
    bearingFromEast: true,
    apiKeyEnv: 'MTA_BUSTIME_KEY',
    pollSeconds: 30,
  },
];
