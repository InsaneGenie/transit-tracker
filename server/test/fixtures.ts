import { Readable } from 'node:stream';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { buildStaticIndex, type GtfsFiles } from '../src/static-gtfs.js';

/** A tiny line running north to south: A -> B -> C, with a dog-leg shape between A and B. */
export const gtfs: Record<string, string> = {
  'stops.txt': `stop_id,stop_name,stop_lat,stop_lon
A,Alpha,40.80,-73.95
B,Bravo,40.79,-73.95
C,Charlie,40.78,-73.95
`,
  'routes.txt': `route_id,route_short_name,route_long_name,route_color
1,1,Test Local,EE352E
`,
  'trips.txt': `route_id,trip_id,service_id,shape_id
1,t1,wk,s1
1,t2,wk,s1
`,
  'shapes.txt': `shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon
s1,0,40.80,-73.95
s1,1,40.80,-73.94
s1,2,40.79,-73.94
s1,3,40.79,-73.95
s1,4,40.78,-73.95
`,
  'stop_times.txt': `trip_id,stop_id,arrival_time,departure_time,stop_sequence
t1,A,08:00:00,08:00:00,1
t1,B,08:02:00,08:02:00,2
t1,C,08:05:00,08:05:00,3
t2,A,25:00:00,25:00:00,1
t2,B,25:02:00,25:02:00,2
t2,C,25:05:00,25:05:00,3
`,
};

export const files: GtfsFiles = (name) => (name in gtfs ? Readable.from([gtfs[name]]) : null);
export const indexPromise = buildStaticIndex(files);

const { transit_realtime: rt } = GtfsRealtimeBindings;

export function encodeFeed(entity: GtfsRealtimeBindings.transit_realtime.IFeedEntity[]): Uint8Array {
  return rt.FeedMessage.encode(
    rt.FeedMessage.create({ header: { gtfsRealtimeVersion: '2.0', timestamp: 1_700_000_000 }, entity }),
  ).finish();
}
