export type Theme = 'light' | 'dark';

const rad = Math.PI / 180;

/** Height of the sun above the horizon in degrees, from the NOAA low-precision formulas. */
export function solarElevation(date: Date, lat: number, lon: number): number {
  const d = date.getTime() / 86_400_000 - 10_957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * rad; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * rad; // tilt of the earth's axis
  const declination = Math.asin(Math.sin(e) * Math.sin(L));
  const rightAscension = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
  const siderealDeg = (18.697374558 + 24.06570982441908 * d) * 15 + lon;
  const hourAngle = (siderealDeg - rightAscension) * rad;
  return (
    Math.asin(
      Math.sin(lat * rad) * Math.sin(declination) +
        Math.cos(lat * rad) * Math.cos(declination) * Math.cos(hourAngle),
    ) / rad
  );
}

// New York City. The whole state shares sunset to within half an hour, which is close enough here.
const NYC = { lat: 40.73, lon: -73.97 };

/** Dark map after sunset, light after sunrise. `?theme=light` or `?theme=dark` in the address forces one. */
export function themeFor(date: Date, search = typeof location === 'undefined' ? '' : location.search): Theme {
  const forced = new URLSearchParams(search).get('theme');
  if (forced === 'light' || forced === 'dark') return forced;
  return solarElevation(date, NYC.lat, NYC.lon) < -0.833 ? 'dark' : 'light';
}
