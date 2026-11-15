/**
 * What the iPhone app's Home Screen and Lock Screen widget shows: the next trains or buses at stations
 * picked in the app. A widget can't fetch anything itself, so each time the app has fresh arrival times
 * it hands over a timeline, one entry a minute for the next hour, and the widget counts down through
 * it with nobody looking.
 *
 * Nothing is imported at run time, like tracking.ts, so it stays easy to test and share.
 */

/** A station picked for the widget: a line at a place. */
export interface WidgetStationPick {
  /** The line, as a `RouteInfo` key, like "mta-subway:A". */
  line: string;
  stopId: string;
  name: string;
  lat: number;
  lon: number;
}

/** One picked station's arrivals as fetched, ready to be laid out. */
export interface WidgetStationArrivals {
  /** Stays the same across fetches, so a widget set to show this station keeps showing it. */
  id: string;
  /** The line's badge. */
  badge: string;
  color: string;
  textColor: string;
  mode: 'subway' | 'bus' | 'rail' | 'ferry';
  station: string;
  directions: {
    /** Where its trains or buses are headed, like "Inwood - 207 St". */
    to: string;
    /** Soonest first; seconds since 1970, like the feeds. */
    arrivals: { time: number; stopsAway: number }[];
  }[];
}

/** A widget's props: plain values only, since iOS keeps them in its settings store, which takes no nulls. */
export interface WidgetProps {
  stations: {
    id: string;
    badge: string;
    color: string;
    textColor: string;
    /** "subway" draws a round bullet; other lines a rounded tag. */
    round: boolean;
    station: string;
    directions: {
      to: string;
      /** Minutes until each of the next few arrive; 0 means now. */
      minutes: number[];
      /** How far off the next one is, like "2 stops away", while that is still fresh. */
      away: string;
    }[];
  }[];
  /** When the times were fetched, in milliseconds. 0 before anything has been. */
  updatedAt: number;
  /** "empty": no stations picked yet. "old": the times ran out; open the app for new ones. */
  state: 'ok' | 'empty' | 'old';
}

/** How far ahead a timeline goes. Past this the times are too old to show. */
export const TIMELINE_MINUTES = 60;
/** The most arrivals shown each way. */
const PER_DIRECTION = 3;
/** "2 stops away" is only true for a few minutes after it was fetched. */
const AWAY_FRESH_MS = 4 * 60_000;

export const pickId = (p: Pick<WidgetStationPick, 'line' | 'stopId'>) => `${p.line}|${p.stopId}`;

export const emptyWidgetProps = (): WidgetProps => ({ stations: [], updatedAt: 0, state: 'empty' });

function away(stopsAway: number): string {
  return stopsAway === 0 ? 'Next stop' : `${stopsAway} stop${stopsAway === 1 ? '' : 's'} away`;
}

/** The widget's props as they'll be at `at`, from times fetched at `fetchedAt` (both milliseconds). */
export function widgetPropsAt(stations: WidgetStationArrivals[], fetchedAt: number, at: number): WidgetProps {
  if (!stations.length) return emptyWidgetProps();
  if (at - fetchedAt >= TIMELINE_MINUTES * 60_000) return { stations: [], updatedAt: fetchedAt, state: 'old' };
  return {
    updatedAt: fetchedAt,
    state: 'ok',
    stations: stations.map((s) => ({
      id: s.id,
      badge: s.badge,
      color: s.color,
      textColor: s.textColor,
      round: s.mode === 'subway',
      station: s.station,
      directions: s.directions.flatMap((d) => {
        // Gone by now, unless due this very minute.
        const ahead = d.arrivals.filter((a) => a.time * 1000 > at - 30_000).slice(0, PER_DIRECTION);
        if (!ahead.length) return [];
        return [
          {
            to: d.to,
            minutes: ahead.map((a) => Math.max(0, Math.round((a.time * 1000 - at) / 60_000))),
            away: at - fetchedAt < AWAY_FRESH_MS ? away(ahead[0].stopsAway) : '',
          },
        ];
      }),
    })),
  };
}

/**
 * A timeline for the widget: an entry now, then one on each minute for the next hour, then one saying
 * the times are too old. Minutes are counted from each entry's own time, so the countdown stays right.
 */
export function widgetTimeline(stations: WidgetStationArrivals[], fetchedAt: number): { date: number; props: WidgetProps }[] {
  if (!stations.length) return [{ date: fetchedAt, props: emptyWidgetProps() }];
  const entries = [{ date: fetchedAt, props: widgetPropsAt(stations, fetchedAt, fetchedAt) }];
  const firstMinute = Math.floor(fetchedAt / 60_000) * 60_000 + 60_000;
  const end = fetchedAt + TIMELINE_MINUTES * 60_000;
  for (let t = firstMinute; t < end; t += 60_000) entries.push({ date: t, props: widgetPropsAt(stations, fetchedAt, t) });
  entries.push({ date: end, props: widgetPropsAt(stations, fetchedAt, end) });
  return entries;
}

/** The arrivals' directions as the widget names them: where they're headed, soonest first. */
export function widgetDirections(
  directions: { destinations: string[]; arrivals: { time: number; stopsAway: number }[] }[],
  tidy: (name: string) => string,
): WidgetStationArrivals['directions'] {
  return directions.map((d) => ({
    to: d.destinations.length ? d.destinations.map(tidy).join(' / ') : 'On the way',
    arrivals: d.arrivals.map((a) => ({ time: a.time, stopsAway: a.stopsAway })),
  }));
}
