export type Mode = 'subway' | 'bus' | 'rail';

export interface FeedConfig {
  id: string;
  agency: string;
  mode: Mode;
  /** GTFS-Realtime protobuf URLs. Several URLs are merged into one feed. */
  realtimeUrls: string[];
  /** Static GTFS zip, used for stop names, route colors and estimating positions. */
  staticUrl?: string;
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
    staticUrl: `${MTA_STATIC}gtfs_subway.zip`,
    pollSeconds: 20,
  },
  {
    id: 'mta-lirr',
    agency: 'Long Island Rail Road',
    mode: 'rail',
    realtimeUrls: [`${MTA_RT}lirr%2Fgtfs-lirr`],
    staticUrl: `${MTA_STATIC}gtfslirr.zip`,
    pollSeconds: 30,
  },
  {
    id: 'mta-mnr',
    agency: 'Metro-North Railroad',
    mode: 'rail',
    realtimeUrls: [`${MTA_RT}mnr%2Fgtfs-mnr`],
    staticUrl: `${MTA_STATIC}gtfsmnr.zip`,
    pollSeconds: 30,
  },
  {
    id: 'mta-bus',
    agency: 'MTA Bus',
    mode: 'bus',
    realtimeUrls: ['https://gtfsrt.prod.obanyc.com/vehiclePositions'],
    apiKeyEnv: 'MTA_BUSTIME_KEY',
    pollSeconds: 30,
  },
];
