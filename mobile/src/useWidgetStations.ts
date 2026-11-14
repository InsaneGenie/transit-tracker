import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pickId,
  widgetDirections,
  widgetTimeline,
  type WidgetStationArrivals,
  type WidgetStationPick,
} from '../../web/src/widgetTimeline';
import { tidyStopName } from '../../web/src/vehicles';
import { fetchArrivals } from './api';
import { widgetModules } from './widgets/native';

const WIDGET_STATIONS_KEY = 'transit-tracker:widget-stations';
/** Enough for a few widgets; each one costs a request whenever the widget is refreshed. */
export const MAX_WIDGET_STATIONS = 6;
/** How often the widget's times are refreshed while the app is open. */
const REFRESH_MS = 2 * 60_000;

/** A station saved for the widget, with its line's badge so the widget can draw it without the line list. */
export interface WidgetStation extends WidgetStationPick {
  badge: string;
  color: string;
  textColor: string;
  mode: 'subway' | 'bus' | 'rail';
}

function parseStations(saved: string | null): WidgetStation[] {
  try {
    const list: unknown = JSON.parse(saved ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(
      (s): s is WidgetStation =>
        s &&
        typeof s.line === 'string' &&
        typeof s.stopId === 'string' &&
        typeof s.name === 'string' &&
        typeof s.lat === 'number' &&
        typeof s.lon === 'number' &&
        typeof s.badge === 'string' &&
        typeof s.color === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * The stations shown on the Home Screen and Lock Screen widget. While the app is open their next arrivals
 * are fetched every couple of minutes and handed to the widget as an hour-long countdown, so the widget
 * stays right for a while after the app is closed.
 */
export function useWidgetStations(active: boolean) {
  const widget = widgetModules()?.ArrivalsWidget ?? null;
  const [stations, setStations] = useState<WidgetStation[]>([]);
  const [restored, setRestored] = useState(false);
  // Each station's last good arrivals, kept when a refresh fails so the widget doesn't go blank.
  const lastGood = useRef(new Map<string, { at: number; arrivals: WidgetStationArrivals }>());

  useEffect(() => {
    if (!widget) return;
    AsyncStorage.getItem(WIDGET_STATIONS_KEY)
      .then((saved) => setStations(parseStations(saved)))
      .catch(() => {})
      .finally(() => setRestored(true));
  }, [widget]);

  const save = (next: WidgetStation[]) => {
    setStations(next);
    AsyncStorage.setItem(WIDGET_STATIONS_KEY, JSON.stringify(next)).catch(() => {});
  };

  const has = useCallback((p: Pick<WidgetStationPick, 'line' | 'stopId'>) => stations.some((s) => pickId(s) === pickId(p)), [stations]);

  /** Adds a station to the widget, or takes it off. Returns false when the widget is already full. */
  const toggle = (station: WidgetStation): boolean => {
    if (has(station)) {
      save(stations.filter((s) => pickId(s) !== pickId(station)));
      return true;
    }
    if (stations.length >= MAX_WIDGET_STATIONS) return false;
    save([...stations, station]);
    return true;
  };

  // The widget's list of stations to choose from (hold the widget, Edit Widget).
  useEffect(() => {
    if (!widget || !restored) return;
    try {
      widget.setConfigurationParameterEnum('station', [
        { name: 'First saved station', value: 'first' },
        ...stations.map((s) => ({ name: `${s.badge} · ${tidyStopName(s.name)}`, value: pickId(s) })),
      ]);
    } catch (err) {
      console.warn('Could not list the widget stations', err);
    }
  }, [widget, restored, stations]);

  // Fresh times for the widget while the app is open.
  useEffect(() => {
    if (!widget || !restored || !active) return;
    const controller = new AbortController();
    const refresh = async () => {
      const now = Date.now();
      const results = await Promise.all(
        stations.map(async (s): Promise<{ at: number; arrivals: WidgetStationArrivals } | null> => {
          const id = pickId(s);
          try {
            const { directions } = await fetchArrivals(s.line, { lat: s.lat, lon: s.lon }, controller.signal);
            const fresh = {
              at: now,
              arrivals: {
                id,
                badge: s.badge,
                color: s.color,
                textColor: s.textColor,
                mode: s.mode,
                station: tidyStopName(s.name),
                directions: widgetDirections(directions, tidyStopName),
              },
            };
            lastGood.current.set(id, fresh);
            return fresh;
          } catch {
            return lastGood.current.get(id) ?? null;
          }
        }),
      );
      if (controller.signal.aborted) return;
      const known = results.filter((r): r is NonNullable<typeof r> => r !== null);
      // Nothing came back (the server may be waking up): leave the widget showing what it had.
      if (stations.length && !known.length) return;
      // The timeline counts from the oldest times shown, so none of them look fresher than they are.
      const fetchedAt = known.length ? Math.min(...known.map((r) => r.at)) : now;
      const entries = widgetTimeline(
        known.map((r) => r.arrivals),
        fetchedAt,
      );
      try {
        widget.updateTimeline(entries.map((e) => ({ date: new Date(e.date), props: e.props })));
      } catch (err) {
        console.warn('Could not update the widget', err);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [widget, restored, active, stations]);

  return { supported: widget !== null, stations, has, toggle };
}
