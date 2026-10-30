import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { applyStationAccess, parseStationAccess } from '../src/accessibility.js';
import { buildStaticIndex } from '../src/static-gtfs.js';

const gtfs = (files: Record<string, string>) => (name: string) => (name in files ? Readable.from([files[name]]) : null);

describe('station accessibility', () => {
  it("reads wheelchair_boarding, and platforms take their station's", async () => {
    const index = await buildStaticIndex(
      gtfs({
        'stops.txt':
          'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station,wheelchair_boarding\n' +
          'GC,Grand Central,40.75,-73.97,1,,1\nGC1,Grand Central,40.75,-73.97,0,GC,\nM,Melrose,40.82,-73.91,0,,2\nU,Unknown,40.8,-73.9,0,,\n',
      }),
    );
    expect(index.stops.get('GC')?.access).toBe('full');
    expect(index.stops.get('GC1')?.access).toBe('full');
    expect(index.stops.get('M')?.access).toBeUndefined();
    expect(index.stops.get('U')?.access).toBeUndefined();
  });

  it("marks subway stations and their platforms from the MTA's station list", async () => {
    const index = await buildStaticIndex(
      gtfs({
        'stops.txt':
          'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n' +
          'R01,Astoria-Ditmars Blvd,40.775,-73.912,1,\nR03,Astoria Blvd,40.770,-73.917,1,\nR03N,Astoria Blvd,40.770,-73.917,,R03\n' +
          'A41,Jay St,40.69,-73.98,1,\nA42,Hoyt-Schermerhorn,40.68,-73.98,1,\n',
      }),
    );
    const access = parseStationAccess([
      { gtfs_stop_id: 'R01', ada: '0' },
      { gtfs_stop_id: 'R03', ada: '1', ada_northbound: '1', ada_southbound: '1' },
      { gtfs_stop_id: 'A41', ada: '2', ada_northbound: '0', ada_southbound: '1', north_direction_label: 'Manhattan', south_direction_label: 'Coney Island' },
      { gtfs_stop_id: 'A42', ada: '2', ada_notes: 'Downtown A/C only' },
    ]);
    applyStationAccess(index, access);
    expect(index.stops.get('R01')?.access).toBeUndefined();
    expect(index.stops.get('R03')?.access).toBe('full');
    expect(index.stops.get('R03N')?.access).toBe('full');
    expect(index.stops.get('A41')).toMatchObject({ access: 'partial', accessNote: 'only toward Coney Island' });
    expect(index.stops.get('A42')).toMatchObject({ access: 'partial', accessNote: 'Downtown A/C only' });
  });
});
