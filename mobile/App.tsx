import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, type LatLng, type MapPressEvent, type Region } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colorFor, displayName, facingWay, MODE_LABELS, routeKey, sameStation, tidyStopName, transferLines } from '../web/src/vehicles';
import {
  fetchAlerts,
  fetchAlertSummary,
  fetchArrivals,
  fetchLineCounts,
  fetchRouteLines,
  fetchRoutePaths,
  fetchRoutes,
  fetchVehicleDetail,
  fetchVehicles,
  NotFoundError,
  type AlertSeverity,
  type ArrivalDirection,
  type LineVehicle,
  type Mode,
  type RouteInfo,
  type RouteLine,
  type RoutePath,
  type ServiceAlert,
  type Station,
  type UpcomingStop,
  type Vehicle,
  type VehicleDetail,
} from './src/api';
import { GuideSheet } from './src/GuideSheet';
import { LinePage } from './src/LinePage';
import { LinePanel } from './src/LinePanel';
import { LinesScreen } from './src/LinesScreen';
import { LinesSheet } from './src/LinesSheet';
import { ModeIcon } from './src/ModeIcon';
import { LinesDrawer } from './src/LinesDrawer';
import { PanelSheet, type Sheet } from './src/PanelSheet';
import { boundsOf, LABEL_MIN_ZOOM, MAX_MARKERS, nearestToCenter, pollMsFor, VEHICLE_MIN_ZOOM, zoomOf } from './src/region';
import { SidePanel } from './src/SidePanel';
import { MODE_DOT, palette } from './src/theme';
import { StopMarker, VehicleMarker } from './src/VehicleMarker';
import { VehiclePanel } from './src/VehiclePanel';

const ALL_MODES: Mode[] = ['subway', 'rail', 'bus'];
const LINES_KEY = 'transit-tracker:lines';
const HIDDEN_ROUTES_KEY = 'transit-tracker:hidden-routes';
const GUIDE_SEEN_KEY = 'transit-tracker:guide-seen';
const SURVEY_DONE_KEY = 'transit-tracker:survey-done';
const ALL_ROUTES_KEY = 'transit-tracker:all-routes';
/** The server draws at most this many lines per request. */
const MAX_DRAWN_LINES = 60;
const STATION_LABEL_HEIGHT = 20;
// From this wide (an iPad, or a big iPhone window), panels go down the left side instead of along the bottom.
const WIDE_MIN_WIDTH = 700;
/** How often the tapped vehicle is refreshed. */
const SELECTED_POLL_MS = 3000;
/**
 * A path as the map wants it, worked out once per path. Handing a line the same array again lets it be
 * skipped, instead of every route's points being sent across to the map on each update.
 */
const pathCache = new WeakMap<[number, number][], LatLng[]>();
function latLngs(path: [number, number][]): LatLng[] {
  let out = pathCache.get(path);
  if (!out) {
    out = path.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
    pathCache.set(path, out);
  }
  return out;
}

const byId = (a: Vehicle, b: Vehicle) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const NEW_YORK: Region = { latitude: 40.73, longitude: -73.97, latitudeDelta: 0.08, longitudeDelta: 0.06 };

/** A vehicle's details, or only what the map knew about it while they load. */
type ShownDetail = VehicleDetail & { loading?: boolean };

type Status = 'connecting' | 'live' | 'error' | 'zoomedOut';

/**
 * A line opened from a station's transfers or one of its stations on the map. `back` is the vehicle and
 * station it was opened from; `atStation` keeps the map on the tapped station instead of the whole line.
 */
type ViewLine = {
  key: string;
  back?: { vehicleId: string; label: string; station: Station | null };
  atStation?: boolean;
  /** The stops ahead of the vehicle it was opened from, so its stations read in that vehicle's direction. */
  ahead?: UpcomingStop[];
};
/** Picked lines' stations show from this zoom; further out they would crowd the map. */
const OTHER_STOPS_MIN_ZOOM = 12;
/** The most of their stations drawn at once, since every one is a native view. */
const MAX_OTHER_STOPS = 200;
/** Station names appear beside the drawn stations from this zoom, at most this many at once. */
const STATION_NAMES_MIN_ZOOM = 13.5;
const MAX_STATION_NAMES = 60;
/** Each name's box is this wide; longer names are cut short. */
const STATION_NAME_WIDTH = 150;

/** A line's whole route with its stations. Retries while the server may still be starting. */
function useRouteLine(key: string | null, active: boolean): RouteLine | null {
  const [line, setLine] = useState<RouteLine | null>(null);
  useEffect(() => {
    setLine(null);
    if (!key || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRouteLines([key], controller.signal)
        .then((r) => {
          setLine(r.lines[0] ?? null);
          if (!r.lines.length) timer = setTimeout(load, 15_000);
        })
        .catch(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, active]);
  return line;
}

/** Every subway and rail line's route, loaded the first time they are asked for. */
function useAllRoutes(on: boolean, active: boolean): RoutePath[] {
  const [lines, setLines] = useState<RoutePath[]>([]);
  const loaded = lines.length > 0;
  useEffect(() => {
    if (!on || !active || loaded) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRoutePaths(controller.signal)
        .then((r) => {
          setLines(r.lines);
          // Schedules can still be loading; ask again until both kinds of line are there.
          if (new Set(r.lines.map((l) => l.mode)).size < 2) timer = setTimeout(load, 15_000);
        })
        .catch(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [on, active, loaded]);
  return lines;
}

/** Alerts change every few minutes at most. */
const ALERT_POLL_MS = 120_000;

/** Service alerts on these lines, kept fresh while the app is on screen; null while loading. */
function useLineAlerts(keys: string[], active: boolean): ServiceAlert[] | null {
  const [alerts, setAlerts] = useState<ServiceAlert[] | null>(null);
  const joined = keys.slice(0, MAX_DRAWN_LINES).join(',');
  useEffect(() => {
    if (!joined || !active) {
      setAlerts(null);
      return;
    }
    const controller = new AbortController();
    const load = () =>
      fetchAlerts(joined.split(','), controller.signal)
        .then((r) => setAlerts(r.alerts))
        .catch(() => {});
    void load();
    const timer = setInterval(load, ALERT_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [joined, active]);
  return alerts;
}

/** Which lines have trouble right now, by line key. */
function useAlertSummary(active: boolean): Record<string, AlertSeverity> {
  const [summary, setSummary] = useState<Record<string, AlertSeverity>>({});
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = () =>
      fetchAlertSummary(controller.signal)
        .then((r) => setSummary(r.lines))
        .catch(() => {});
    void load();
    const timer = setInterval(load, ALERT_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active]);
  return summary;
}

/** How many vehicles are out on each line, kept fresh while asked for; null until loaded. */
function useLineCounts(active: boolean): Record<string, number> | null {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = () =>
      fetchLineCounts(controller.signal)
        .then((r) => setCounts(r.lines))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active]);
  return counts;
}

/** Whether the app is on screen; nothing is fetched while it's in the background. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

function TransitMap() {
  const dark = useColorScheme() === 'dark';
  const c = palette(dark);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const active = useAppActive();
  const mapRef = useRef<MapView>(null);

  const [modes, setModes] = useState<Mode[]>(ALL_MODES);
  const [lines, setLines] = useState<string[]>([]);
  // Your lines whose routes are not drawn on the map; their vehicles still show.
  const [hiddenRoutes, setHiddenRoutes] = useState<string[]>([]);
  const [station, setStation] = useState<Station | null>(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const [transferRoutes, setTransferRoutes] = useState<RouteLine[]>([]);
  const [filterRoutes, setFilterRoutes] = useState<RouteLine[]>([]);
  const [arrivals, setArrivals] = useState<ArrivalDirection[] | null>(null);
  // Set when a vehicle is picked from the station's arrivals, so the station stays picked.
  const keepStation = useRef(false);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  // The Lines sheet over the map: pulled up, and how tall it rests to show your lines.
  const [linesUp, setLinesUp] = useState(false);
  const [peekHeight, setPeekHeight] = useState(160);
  // The line whose own page is open in the Lines sheet.
  const [linePage, setLinePage] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  // Every line's route drawn on the map, without opening Lines.
  const [allRoutesOn, setAllRoutesOn] = useState(false);
  const [region, setRegion] = useState<Region>(NEW_YORK);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [detail, setDetail] = useState<ShownDetail | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [locating, setLocating] = useState(false);
  const [showsUser, setShowsUser] = useState(false);

  const zoom = zoomOf(region, width);

  // The line filter, and which of its routes are hidden, are remembered between launches.
  useEffect(() => {
    const restore = (key: string, set: (keys: string[]) => void) =>
      AsyncStorage.getItem(key)
        .then((saved) => {
          const parsed: unknown = JSON.parse(saved ?? '[]');
          if (Array.isArray(parsed)) set(parsed.filter((k): k is string => typeof k === 'string'));
        })
        .catch(() => {});
    void restore(LINES_KEY, setLines);
    void restore(HIDDEN_ROUTES_KEY, setHiddenRoutes);
    AsyncStorage.getItem(ALL_ROUTES_KEY)
      .then((saved) => setAllRoutesOn(saved === '1'))
      .catch(() => {});
  }, []);
  // On the first launch, ask which lines they ride, then show the guide. People who already saw the
  // guide had the app before the question was added, so they are not asked.
  useEffect(() => {
    AsyncStorage.multiGet([SURVEY_DONE_KEY, GUIDE_SEEN_KEY])
      .then(([[, surveyed], [, seen]]) => {
        if (surveyed === null && seen === null) setSurveyOpen(true);
        else if (seen === null) setGuideOpen(true);
        if (surveyed === null && seen !== null) AsyncStorage.setItem(SURVEY_DONE_KEY, '1').catch(() => {});
      })
      .catch(() => {});
  }, []);
  const closeSurvey = () => {
    setSurveyOpen(false);
    AsyncStorage.setItem(SURVEY_DONE_KEY, '1').catch(() => {});
    AsyncStorage.getItem(GUIDE_SEEN_KEY)
      .then((seen) => {
        // A moment for the survey sheet to slide away, since iOS shows one sheet at a time.
        if (seen === null) setTimeout(() => setGuideOpen(true), 400);
      })
      .catch(() => {});
  };
  const closeGuide = () => {
    setGuideOpen(false);
    AsyncStorage.setItem(GUIDE_SEEN_KEY, '1').catch(() => {});
  };
  const changeHiddenRoutes = (next: string[]) => {
    setHiddenRoutes(next);
    AsyncStorage.setItem(HIDDEN_ROUTES_KEY, JSON.stringify(next)).catch(() => {});
  };
  const toggleAllRoutes = () => {
    setAllRoutesOn(!allRoutesOn);
    AsyncStorage.setItem(ALL_ROUTES_KEY, allRoutesOn ? '' : '1').catch(() => {});
  };
  const changeLines = (next: string[]) => {
    setLines(next);
    AsyncStorage.setItem(LINES_KEY, JSON.stringify(next)).catch(() => {});
  };
  const routesByKey = useMemo(() => new Map(routes.map((r) => [r.key, r])), [routes]);

  // The whole route of the tapped vehicle's line, with its stations.
  const selectedLine = detail ? routeKey(detail.vehicle) : null;
  const routeLine = useRouteLine(selectedLine, active);
  // A line opened from a station's transfers, and where Back returns to.
  const [viewLine, setViewLine] = useState<ViewLine | null>(null);
  const viewRoute = useRouteLine(viewLine?.key ?? null, active);
  // Its stations listed the way the vehicle it was opened from is going.
  const listedRoute = useMemo(
    () => (viewRoute && viewLine?.ahead ? { ...viewRoute, stops: facingWay(viewRoute.stops, viewLine.ahead) } : viewRoute),
    [viewRoute, viewLine?.ahead],
  );

  // Delays, suspensions and planned changes: for the open vehicle's or line's panel, and the picked lines.
  const alertSummary = useAlertSummary(active);
  const panelAlerts = useLineAlerts([(detail ? selectedLine : viewLine?.key) ?? ''].filter(Boolean), active);
  // The Lines sheet: how many vehicles each line has out, and the open line's route and alerts.
  const onLines = active;
  const lineCounts = useLineCounts(onLines);
  const pageRoute = useRouteLine(linePage, onLines);
  const pageAlerts = useLineAlerts(linePage ? [linePage] : [], onLines);

  // A picked station belongs to the vehicle it was picked for, or to the line when one of its arrivals is picked.
  useEffect(() => {
    if (keepStation.current) {
      keepStation.current = false;
      return;
    }
    setStation(null);
    setShowTransfers(false);
  }, [selectedId]);

  // Every vehicle of the line on its way to the picked station, both ways, kept fresh.
  useEffect(() => {
    setArrivals(null);
    const line = selectedLine ?? viewLine?.key;
    if (!station || !line || !active) return;
    const controller = new AbortController();
    const place = { lat: station.lat, lon: station.lon };
    const load = () =>
      fetchArrivals(line, place, controller.signal)
        .then((r) => setArrivals(r.directions))
        .catch(() => {});
    void load();
    const timer = setInterval(load, SELECTED_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [station?.lat, station?.lon, selectedLine, viewLine?.key, active]);

  // The lines you can change to at the picked station, without express twins (7X beside the 7).
  const stationTransfers = useMemo(
    () => transferLines(station?.transfers, routesByKey).map((r) => r.key),
    [station, routesByKey],
  );

  // Their whole routes, when asked for.
  useEffect(() => {
    setTransferRoutes([]);
    if (!showTransfers || !stationTransfers.length) return;
    const controller = new AbortController();
    fetchRouteLines(stationTransfers, controller.signal)
      .then((r) => setTransferRoutes(r.lines))
      .catch(() => {});
    return () => controller.abort();
  }, [showTransfers, stationTransfers]);

  // Already allowed to use the location from an earlier launch: show the blue dot straight away.
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((p) => setShowsUser(p.granted))
      .catch(() => {});
  }, []);

  // The list of lines. Retry until the server is up, since a sleeping server takes a minute to wake.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRoutes(controller.signal)
        .then(({ routes }) => {
          setRoutes(routes);
          // Schedules can still be loading; ask again until every mode has its lines.
          if (new Set(routes.map((r) => r.mode)).size < ALL_MODES.length) timer = setTimeout(load, 15_000);
        })
        .catch(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active]);

  // Vehicles on screen, fetched again whenever the map stops moving and then on a timer.
  useEffect(() => {
    if (!active) return;
    if (zoom < VEHICLE_MIN_ZOOM) {
      setVehicles([]);
      setStatus('zoomedOut');
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const { vehicles } = await fetchVehicles(boundsOf(region), controller.signal);
        setVehicles(vehicles);
        setStatus('live');
      } catch {
        if (controller.signal.aborted) return;
        setStatus((s) => (s === 'connecting' ? s : 'error'));
      }
      timer = setTimeout(load, pollMsFor(zoom));
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // `zoom` comes from `region`.
  }, [region, active]);

  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;
  const select = useCallback((id: string | null, given?: Vehicle) => {
    setSelectedId(id);
    setFollowing(id !== null);
    if (id === null) {
      setDetail(null);
      return;
    }
    // Open the panel and move the map straight away with what the map already knows; its stops follow.
    const known = given ?? vehiclesRef.current.find((v) => v.id === id);
    setDetail((d) => (d?.vehicle.id === id || !known ? d : { vehicle: known, upcoming: [], path: [], loading: true }));
  }, []);

  // Keep the tapped vehicle's position, stops and arrival times fresh.
  useEffect(() => {
    if (!selectedId || !active) return;
    const controller = new AbortController();
    const load = () =>
      fetchVehicleDetail(selectedId, controller.signal)
        .then(setDetail)
        .catch((err: unknown) => {
          // The trip ended or left the feed.
          if (err instanceof NotFoundError) select(null);
        });
    void load();
    const timer = setInterval(load, SELECTED_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selectedId, active, select]);

  // Follow the tapped vehicle. The map's bottom padding keeps it clear of the panel.
  useEffect(() => {
    if (!following || !detail || detail.vehicle.id !== selectedId) return;
    mapRef.current?.animateCamera(
      { center: { latitude: detail.vehicle.lat, longitude: detail.vehicle.lon } },
      { duration: 800 },
    );
  }, [detail, following, selectedId]);

  // Reordering your lines changes none of the drawn ones, so it fetches nothing.
  const drawnKeys = [...lines.slice(0, MAX_DRAWN_LINES)].sort().join(',');
  // The lines picked in Lines are drawn as soon as they're picked.
  useEffect(() => {
    setFilterRoutes([]);
    if (!drawnKeys || !active) return;
    const keys = drawnKeys.split(',');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRouteLines(keys, controller.signal)
        .then((r) => {
          setFilterRoutes(r.lines);
          // Schedules can still be loading; ask again for the lines not found yet.
          if (r.lines.length < keys.length) timer = setTimeout(load, 15_000);
        })
        .catch(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [drawnKeys, active]);

  // Lines drawn under the tapped vehicle's own: the picked lines and the picked station's transfers.
  const otherLines = useMemo(() => {
    // A line opened on its own is shown alone.
    if (viewLine && !detail) return [];
    const drawn = filterRoutes.filter((l) => !hiddenRoutes.includes(l.key));
    const byKey = new Map([...drawn, ...transferRoutes].map((l) => [l.key, l]));
    return [...byKey.values()];
  }, [filterRoutes, hiddenRoutes, transferRoutes, viewLine, detail]);

  // Every line's route, for the kinds of vehicle shown. A line opened on its own is shown alone. They
  // are made once per change, since there are a lot of them.
  const everyRoute = useAllRoutes(allRoutesOn, active);
  const allRouteLines = useMemo(() => {
    if (!allRoutesOn || (viewLine && !detail)) return null;
    return everyRoute
      .filter((l) => modes.includes(l.mode))
      .flatMap((line) => {
        const color = colorFor({ routeColor: line.color, mode: line.mode });
        return line.paths.map((path, i) => (
          <Polyline
            key={`route-all-${line.key}-${i}`}
            coordinates={latLngs(path)}
            strokeColor={`${color}99`}
            strokeWidth={2}
            lineCap="round"
            lineJoin="round"
          />
        ));
      });
  }, [allRoutesOn, everyRoute, modes, viewLine, detail]);

  // Pick a station from the stop list or the map and bring it to the middle. Stations on the line and in
  // the stop list have different ids for the same place (127 and 127N), so look its transfers up by place.
  const pickStation = (stop: UpcomingStop) => {
    if (stop.lat === undefined || stop.lon === undefined) return;
    const known = [
      ...(stop.transfers ? [stop] : []),
      ...(routeLine?.stops ?? []),
      ...(viewRoute?.stops ?? []),
      ...(detail?.upcoming ?? []),
    ].find((s) => s.transfers && sameStation(s, stop));
    setFollowing(false);
    setStation({ stopId: stop.stopId, name: stop.name, lat: stop.lat, lon: stop.lon, transfers: known?.transfers });
    mapRef.current?.animateCamera({ center: { latitude: stop.lat, longitude: stop.lon } }, { duration: 600 });
  };

  // Show a transfer line on its own. Back returns to the vehicle and station it was opened from.
  const openLine = (key: string, at?: Station, ahead?: UpcomingStop[]) => {
    const back = detail
      ? {
          vehicleId: detail.vehicle.id,
          label: `the ${displayName(detail.vehicle.routeName ?? detail.vehicle.routeId ?? '')} ${detail.vehicle.mode === 'bus' ? 'bus' : 'train'}`,
          station,
        }
      : viewLine?.back;
    setViewLine({ key, back, atStation: Boolean(at), ahead });
    setStation(at ?? null);
    setShowTransfers(false);
    // Closing the vehicle would otherwise drop the station just picked.
    if (at && selectedId) keepStation.current = true;
    select(null);
    if (at) mapRef.current?.animateCamera({ center: { latitude: at.lat, longitude: at.lon } }, { duration: 600 });
  };

  // Every station on the open vehicle's line, from its drawn route or the panel.
  const openOwnLine = () => {
    if (selectedLine) openLine(selectedLine, undefined, detail?.upcoming);
  };

  // A station of a picked line, tapped on the map, opens that line there.
  const openLineStation = (key: string, stop: UpcomingStop) => {
    if (stop.lat === undefined || stop.lon === undefined) return;
    setFollowing(false);
    openLine(key, { stopId: stop.stopId, name: stop.name, lat: stop.lat, lon: stop.lon, transfers: stop.transfers });
  };

  // From a line's page in the Lines sheet: the line on the map, at one of its stations when one is given.
  const showLineOnMap = (key: string, stop?: UpcomingStop) => {
    setLinesUp(false);
    setLinePage(null);
    if (stop?.lat !== undefined && stop.lon !== undefined) {
      setFollowing(false);
      openLine(key, { stopId: stop.stopId, name: stop.name, lat: stop.lat, lon: stop.lon, transfers: stop.transfers });
    } else {
      openLine(key);
    }
  };

  // A train or bus tapped on a line's page: close enough on the map to see it, and its card open.
  const showVehicleOnMap = ({ vehicle }: LineVehicle) => {
    setLinesUp(false);
    setLinePage(null);
    setViewLine(null);
    setStation(null);
    select(vehicle.id, vehicle);
    mapRef.current?.animateToRegion(
      { latitude: vehicle.lat, longitude: vehicle.lon, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      600,
    );
  };

  const closeViewLine = () => {
    setViewLine(null);
    setStation(null);
  };

  // Once the vehicle's panel is back, pick its station again and bring it into view beside the panel.
  const [restoreStation, setRestoreStation] = useState<Station | null>(null);
  const closeLine = () => {
    const back = viewLine?.back;
    setViewLine(null);
    setStation(null);
    if (back) {
      select(back.vehicleId);
      // Show the station it was opened from, not the vehicle; with no station, follow the vehicle again.
      if (back.station) {
        setFollowing(false);
        setRestoreStation(back.station);
      }
    }
  };
  useEffect(() => {
    if (!restoreStation || !detail) return;
    setStation(restoreStation);
    setRestoreStation(null);
    mapRef.current?.animateCamera(
      { center: { latitude: restoreStation.lat, longitude: restoreStation.lon } },
      { duration: 600 },
    );
  }, [detail, restoreStation]);

  // Show the whole of a line opened on its own. Long lines don't fit on a phone at a zoom where vehicles
  // show, so stay close enough to see them, centered on the line.
  useEffect(() => {
    const points = viewRoute?.paths.flat() ?? [];
    if (!points.length || viewLine?.atStation) return;
    const [west, south, east, north] = points.reduce(
      (b, [lon, lat]) => [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const maxLonDelta = (360 * mapWidth) / (512 * 2 ** (VEHICLE_MIN_ZOOM + 0.5));
    // The part of the map above the line panel is roughly as tall as the screen is wide.
    mapRef.current?.animateToRegion(
      {
        latitude: (south + north) / 2,
        longitude: (west + east) / 2,
        latitudeDelta: Math.min((north - south) * 1.2, maxLonDelta),
        longitudeDelta: Math.min((east - west) * 1.2, maxLonDelta),
      },
      600,
    );
    // Only when a new line arrives, not when the screen turns.
  }, [viewRoute]);

  const locate = async () => {
    setLocating(true);
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      setShowsUser(granted);
      if (!granted) return;
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setFollowing(false);
      mapRef.current?.animateToRegion(
        { latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        600,
      );
    } catch {
      // Location services are off; leave the map where it is.
    } finally {
      setLocating(false);
    }
  };

  // A line opened on its own shows only its vehicles, even if its kind of vehicle is switched off.
  // Your lines with their route switched on; a line switched off hides its vehicles too.
  const shownLines = viewLine ? [viewLine.key] : lines.length ? lines.filter((k) => !hiddenRoutes.includes(k)) : null;
  const shownModes = viewLine && viewRoute && !modes.includes(viewRoute.mode) ? [...modes, viewRoute.mode] : modes;
  const isShown = (v: Vehicle) =>
    shownModes.includes(v.mode) && (!shownLines || shownLines.includes(routeKey(v)));
  // Kept in a fixed order: Apple Maps takes a dot off the map and puts it back whenever it moves in the
  // list, and the server lists vehicles in a different order each time, which made dots blink.
  const shown = useMemo(
    () => nearestToCenter(vehicles.filter((v) => v.id !== selectedId && isShown(v)), region).sort(byId),
    [vehicles, shownModes.join(), shownLines?.join() ?? null, selectedId, region],
  );
  const inView = vehicles.filter(isShown).length;
  // The tapped vehicle comes from its own, more frequent updates.
  const selected = detail?.vehicle.id === selectedId ? detail.vehicle : vehicles.find((v) => v.id === selectedId);
  // The tapped vehicle among the rest, in the same fixed order.
  const markers = selected ? [...shown, selected].sort(byId) : shown;

  const labelled = zoom >= LABEL_MIN_ZOOM;
  const pathColor = detail ? colorFor(detail.vehicle) : undefined;
  const panelOpen = detail !== null && detail.vehicle.id === selectedId;
  // The line panel shows when a line is open on its own and no vehicle is.
  const lineOpen = !panelOpen && viewLine !== null;
  const anyPanel = panelOpen || lineOpen;
  // On an iPad the panels and Lines sit in a column down the left, and the map is beside them.
  const wide = width >= WIDE_MIN_WIDTH;
  const sideWidth = wide ? Math.min(400, Math.round(width * 0.42)) : 0;
  const sideLeft = wide ? sideWidth + 24 : 0;
  const mapWidth = width - sideLeft;
  // On a phone, a panel takes the bottom half of the screen, or nearly all of it when dragged up.
  const mapHeight = height - insets.bottom;
  const halfPanel = mapHeight * 0.5;
  const fullPanel = mapHeight - insets.top - 12;
  // The map keeps its padding at half, so dragging the panel up covers the map rather than moving it.
  const panelPad = Math.min(panelHeight, halfPanel);
  // With no panel open, the Lines sheet rests along the bottom, tall enough to show your lines.
  const peekLimit = height * 0.45;
  const linesPeek = Math.min(peekHeight + 24 + insets.bottom, peekLimit);
  // A line's card opening below badges that already fill the lowered sheet pulls the sheet up to show it.
  const lastPeek = useRef(0);
  const onPeekHeight = (h: number) => {
    if (lastPeek.current && h - lastPeek.current > 60 && h + 24 + insets.bottom > peekLimit) setLinesUp(true);
    lastPeek.current = h;
    setPeekHeight(h);
  };
  const bottomPad = wide ? insets.bottom : anyPanel ? panelPad + insets.bottom : linesPeek;
  // The line drawn boldest, with its stations: the vehicle's own, or the line open on its own.
  const ownLine = panelOpen ? routeLine : lineOpen ? viewRoute : null;
  const ownColor = panelOpen
    ? pathColor
    : ownLine
      ? colorFor({ routeColor: ownLine.color, mode: ownLine.mode })
      : undefined;
  const stationDots = panelOpen
    ? routeLine?.stops.length
      ? routeLine.stops
      : detail.upcoming
    : lineOpen
      ? (viewRoute?.stops ?? [])
      : [];
  // The picked lines' stations in view, when zoomed in enough. The open line's own are drawn above.
  const otherStops = useMemo(() => {
    if (zoom < OTHER_STOPS_MIN_ZOOM) return [];
    const [west, south, east, north] = boundsOf(region);
    return otherLines
      .filter((l) => l.key !== ownLine?.key)
      .flatMap((line) =>
        line.stops
          .filter((s) => s.lat !== undefined && s.lon !== undefined && s.lon >= west && s.lon <= east && s.lat >= south && s.lat <= north)
          .map((stop) => ({ line, stop })),
      )
      .slice(0, MAX_OTHER_STOPS);
  }, [otherLines, ownLine?.key, region, zoom]);

  // Names beside the drawn stations once zoomed in to street level, the open line's first. A name that would
  // run into one already placed is left out, so a crowded stretch shows the ones that fit.
  const stationNames = useMemo(() => {
    if (zoom < STATION_NAMES_MIN_ZOOM) return [];
    const [west, south, east, north] = boundsOf(region);
    const toScreen = (s: UpcomingStop) => ({
      x: ((s.lon! - west) / (east - west)) * mapWidth,
      y: ((north - s.lat!) / (north - south)) * mapHeight,
    });
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    if (anyPanel && station) placed.push({ ...toScreen(station), w: 90, h: 50 });
    const out: { stop: UpcomingStop; name: string }[] = [];
    const candidates = [...stationDots, ...otherStops.map((o) => o.stop)];
    for (const stop of candidates) {
      if (out.length >= MAX_STATION_NAMES) break;
      if (stop.lat === undefined || stop.lon === undefined || !stop.name) continue;
      if (stop.lon < west || stop.lon > east || stop.lat < south || stop.lat > north) continue;
      const name = tidyStopName(stop.name);
      // The picked station already has its name under its ring.
      if (anyPanel && station?.name && name === tidyStopName(station.name)) continue;
      const at = toScreen(stop);
      // The name starts just right of the dot.
      const box = { x: at.x + 7, y: at.y - 8, w: Math.min(name.length * 6.5 + 4, STATION_NAME_WIDTH), h: 16 };
      const hits = (b: (typeof placed)[number]) =>
        box.x < b.x + b.w + 4 && b.x < box.x + box.w + 4 && box.y < b.y + b.h && b.y < box.y + box.h;
      // Also keeps a station shared by two drawn lines from being named twice.
      if (placed.some(hits)) continue;
      placed.push(box);
      out.push({ stop, name });
    }
    return out;
  }, [zoom, region, mapWidth, mapHeight, stationDots, otherStops, anyPanel, station]);

  // Station dots keep the same tap handlers from one update to the next, so they aren't redrawn each time.
  const stopTaps = useRef({ pickStation, openLineStation });
  stopTaps.current = { pickStation, openLineStation };
  const onOwnStop = useCallback((stop: UpcomingStop) => stopTaps.current.pickStation(stop), []);
  const onOtherStop = useCallback(
    (stop: UpcomingStop, key: string) => stopTaps.current.openLineStation(key, stop),
    [],
  );

  const statusText =
    status === 'zoomedOut'
      ? 'Zoom in to see vehicles'
      : status === 'connecting'
        ? 'Connecting to live data…'
        : status === 'error'
          ? "Can't reach the live data server"
          : inView > MAX_MARKERS
            ? `${inView.toLocaleString()} vehicles, zoom in to see them all`
            : `${inView.toLocaleString()} vehicles in view`;

  // What the panels and the Lines sheet show; a phone holds them in sheets, an iPad down the side.
  const vehiclePanel = (sheet?: Sheet) =>
    detail && (
      <VehiclePanel
        sheet={sheet}
        detail={detail}
        loading={detail.loading}
        routes={routesByKey}
        following={following}
        dark={dark}
        bottomInset={wide ? 0 : insets.bottom}
        onFollow={() => setFollowing((f) => !f)}
        onAllStations={openOwnLine}
        station={station}
        stationTransfers={stationTransfers}
        showTransfers={showTransfers}
        onShowTransfers={setShowTransfers}
        arrivals={arrivals}
        alerts={panelAlerts}
        onArrival={(id) => {
          if (id === selectedId) return;
          keepStation.current = true;
          select(id);
        }}
        onLine={(key) => openLine(key)}
        onStop={pickStation}
        onClose={() => select(null)}
      />
    );
  const linePanel = (sheet?: Sheet) =>
    viewLine && (
      <LinePanel
        sheet={sheet}
        info={routesByKey.get(viewLine.key)}
        line={listedRoute}
        routes={routesByKey}
        station={station}
        arrivals={arrivals}
        alerts={panelAlerts}
        backLabel={viewLine.back?.label}
        dark={dark}
        bottomInset={wide ? 0 : insets.bottom}
        onBack={closeLine}
        onStop={pickStation}
        onArrival={(id) => {
          keepStation.current = true;
          select(id);
        }}
        onLine={(key) => openLine(key)}
        onClose={closeViewLine}
      />
    );
  const linesContent = linePage ? (
    <LinePage
      key={linePage}
      lineKey={linePage}
      info={routesByKey.get(linePage)}
      line={pageRoute}
      routes={routesByKey}
      alerts={pageAlerts}
      count={lineCounts?.[linePage]}
      starred={lines.includes(linePage)}
      active={onLines}
      dark={dark}
      topInset={0}
      onBack={() => setLinePage(null)}
      onStar={() => changeLines(lines.includes(linePage) ? lines.filter((k) => k !== linePage) : [...lines, linePage])}
      onShowOnMap={() => showLineOnMap(linePage)}
      onStation={(s) => showLineOnMap(linePage, s)}
      onVehicle={showVehicleOnMap}
    />
    ) : (
    <LinesScreen
      routes={routes}
      chosen={lines}
      hiddenRoutes={hiddenRoutes}
      alertSummary={alertSummary}
      counts={lineCounts}
      dark={dark}
      expanded={wide || linesUp}
      onExpand={() => setLinesUp(true)}
      onPeekHeight={onPeekHeight}
      onChange={changeLines}
      onHiddenRoutesChange={changeHiddenRoutes}
      onOpen={setLinePage}
    />
  );

  const onMapPress = (e: MapPressEvent) => {
    if (e.nativeEvent.action !== 'marker-press') select(null);
  };

  return (
    <View style={styles.fill}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={styles.fill}>
        {/* Touching the map means the user wants to look elsewhere, so stop following. */}
        <View style={styles.fill} onTouchStart={() => following && setFollowing(false)}>
          <MapView
            ref={mapRef}
            style={styles.fill}
            initialRegion={NEW_YORK}
            onRegionChangeComplete={setRegion}
            onPress={onMapPress}
            showsUserLocation={showsUser}
            showsCompass
            showsPointsOfInterests={false}
            pitchEnabled={false}
            userInterfaceStyle={dark ? 'dark' : 'light'}
            mapPadding={{ top: insets.top + 96, right: 0, bottom: bottomPad, left: sideLeft }}
          >
            {/* Every line's route, when switched on, under everything else. */}
            {allRouteLines}
            {/* Lines picked in Lines and the picked station's transfers, under the tapped vehicle's own line. */}
            {/* A vehicle's line sits faintly behind its path ahead; a line open on its own is drawn solid. */}
            {[...otherLines.filter((l) => l.key !== ownLine?.key), ...(ownLine ? [ownLine] : [])].flatMap((line) => {
              const color = colorFor({ routeColor: line.color, mode: line.mode });
              const own = line === ownLine;
              return line.paths.map((path, i) => (
                <Polyline
                  key={`route-${own ? 'own' : 'other'}-${line.key}-${i}`}
                  coordinates={latLngs(path)}
                  strokeColor={`${color}${own ? (panelOpen ? '80' : 'e6') : 'b3'}`}
                  strokeWidth={own ? 4 : 3}
                  lineCap="round"
                  lineJoin="round"
                  tappable={own && panelOpen}
                  onPress={own && panelOpen ? openOwnLine : undefined}
                />
              ));
            })}
            {detail && detail.vehicle.id === selectedId && detail.path.length > 1 && (
              <Polyline
                coordinates={latLngs(detail.path)}
                strokeColor={pathColor}
                strokeWidth={5}
                lineCap="round"
                lineJoin="round"
                tappable
                onPress={openOwnLine}
              />
            )}
            {/* Stations of the picked lines: tapping one opens that line there. */}
            {otherStops.map(({ line, stop }) => (
              <StopMarker
                key={`other-stop-${line.key}-${stop.stopId}-${dark ? 'd' : 'l'}`}
                stop={stop}
                lineKey={line.key}
                color={colorFor({ routeColor: line.color, mode: line.mode })}
                background={c.card}
                small
                onPress={onOtherStop}
              />
            ))}
            {/* Every station on the line (buses have none listed, so their next stops instead). */}
            {stationDots
              .filter((s) => s.lat !== undefined && s.lon !== undefined)
              .map((s) => (
                <StopMarker
                  key={`stop-${ownLine?.key ?? ''}-${s.stopId}-${dark ? 'd' : 'l'}`}
                  stop={s}
                  lineKey={ownLine?.key ?? ''}
                  color={ownColor}
                  background={c.card}
                  onPress={onOwnStop}
                />
              ))}
            {stationNames.map(({ stop, name }) => (
              <Marker
                key={`station-name-${stop.stopId}-${dark ? 'd' : 'l'}`}
                coordinate={{ latitude: stop.lat!, longitude: stop.lon! }}
                // The name's box starts just right of the dot.
                centerOffset={{ x: 7 + STATION_NAME_WIDTH / 2, y: 0 }}
                tracksViewChanges={false}
              >
                <View style={styles.stationName} pointerEvents="none">
                  <Text
                    style={[styles.stationNameText, { color: c.text, textShadowColor: c.card }]}
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                </View>
              </Marker>
            ))}
            {/* The picked station's ring and name. They are two markers of fixed size: Apple Maps centers a
                marker's view on its coordinate using the size it had when first drawn, and one view holding
                text could be drawn before the text was laid out, which put the ring off the station. */}
            {anyPanel && station && (
              <Marker
                key={`station-ring-${station.stopId}-${dark ? 'd' : 'l'}`}
                coordinate={{ latitude: station.lat, longitude: station.lon }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                zIndex={3}
              >
                <View style={[styles.stationRing, { borderColor: dark ? '#f9fafb' : '#111827' }]} />
              </Marker>
            )}
            {anyPanel && station?.name && (
              <Marker
                key={`station-name-${station.stopId}-${dark ? 'd' : 'l'}`}
                coordinate={{ latitude: station.lat, longitude: station.lon }}
                // Below the ring: half the ring, a small gap and half the label.
                centerOffset={{ x: 0, y: 14 + 4 + STATION_LABEL_HEIGHT / 2 }}
                tracksViewChanges={false}
                zIndex={3}
              >
                <View style={styles.stationLabel}>
                  <Text style={[styles.stationLabelText, { color: c.text, backgroundColor: c.chip }]} numberOfLines={1}>
                    {tidyStopName(station.name)}
                  </Text>
                </View>
              </Marker>
            )}
            {markers.map((v) => {
              const isSelected = v.id === selectedId;
              return (
                <VehicleMarker
                  // Remount when the label appears or goes, since the marker's view isn't redrawn otherwise. The
                  // tapped vehicle keeps its marker when it already had a label, so it doesn't blink.
                  key={`${v.id}:${labelled || isSelected ? 'l' : 'd'}`}
                  vehicle={v}
                  labelled={labelled || isSelected}
                  selected={isSelected}
                  dark={dark}
                  onPress={select}
                />
              );
            })}
          </MapView>
        </View>

        <View style={[styles.toolbar, { top: insets.top + 8, left: sideLeft + 12 }]} pointerEvents="box-none">
          <View style={[styles.brand, { backgroundColor: c.chip }]}>
            <View style={styles.brandDot} />
            <Text style={[styles.brandText, { color: c.text }]}>NY Transit Live</Text>
          </View>
          <View style={styles.chips}>
            {ALL_MODES.map((mode) => {
              const on = modes.includes(mode);
              return (
                <Pressable
                  key={mode}
                  onPress={() => setModes((m) => (m.includes(mode) ? m.filter((x) => x !== mode) : [...m, mode]))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, { backgroundColor: c.chip }, !on && styles.chipOff]}
                >
                  <ModeIcon mode={mode} size={16} color={MODE_DOT[mode]} ink="#ffffff" hollow={!on} />
                  <Text style={[styles.chipText, { color: c.text }]}>{MODE_LABELS[mode]}</Text>
                </Pressable>
              );
            })}
            {/* The map shows only your lines while there are any; this says so and leads to them. */}
            {lines.length > 0 && (
              <Pressable
                onPress={() => setLinesUp(true)}
                accessibilityRole="button"
                accessibilityLabel={`Showing my ${lines.length} lines`}
                style={[styles.chip, { backgroundColor: c.accent }]}
              >
                <Text style={[styles.chipText, { color: '#ffffff' }]}>My lines ({lines.length})</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setGuideOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="How to use"
              style={[styles.chip, styles.helpChip, { backgroundColor: c.chip }]}
            >
              <Text style={[styles.chipText, { color: c.text }]}>?</Text>
            </Pressable>
          </View>
        </View>

        {(!anyPanel || wide) && (
          <View style={[styles.statusRow, { bottom: bottomPad + 16, left: sideLeft }]} pointerEvents="none">
            <View style={[styles.status, { backgroundColor: c.chip }]}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: status === 'live' ? '#16a34a' : status === 'error' ? '#dc2626' : '#9ca3af' },
                ]}
              />
              <Text style={[styles.statusText, { color: c.text }]}>{statusText}</Text>
            </View>
          </View>
        )}

        {(wide || !(anyPanel && panelHeight > halfPanel + 1)) && (
          <Pressable
            onPress={toggleAllRoutes}
            accessibilityRole="switch"
            accessibilityLabel="Show every line's route"
            accessibilityState={{ checked: allRoutesOn }}
            style={[
              styles.routesButton,
              { backgroundColor: allRoutesOn ? c.accent : c.chip, bottom: bottomPad + 16 + 44 + 10 },
            ]}
          >
            <View style={styles.routesIcon}>
              {['#EE352E', '#00933C', '#0039A6'].map((color) => (
                <View key={color} style={[styles.routesStripe, { backgroundColor: allRoutesOn ? '#ffffff' : color }]} />
              ))}
            </View>
            <Text style={[styles.chipText, { color: allRoutesOn ? '#ffffff' : c.text }]}>Routes</Text>
          </Pressable>
        )}

        {(wide || !(anyPanel && panelHeight > halfPanel + 1)) && (
          <Pressable
            onPress={locate}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel="Show my location"
            style={[
              styles.locate,
              { backgroundColor: c.chip, bottom: bottomPad + 16 },
            ]}
          >
            <Text style={[styles.locateIcon, { color: c.accent }]}>➤</Text>
          </Pressable>
        )}

        {panelOpen &&
          (wide ? (
            <SidePanel width={sideWidth} top={insets.top + 12} bottom={insets.bottom + 12} dark={dark}>
              {vehiclePanel()}
            </SidePanel>
          ) : (
            <PanelSheet half={halfPanel} full={fullPanel} onHeight={setPanelHeight} onClose={() => select(null)}>
              {vehiclePanel}
            </PanelSheet>
          ))}

        {lineOpen &&
          viewLine &&
          (wide ? (
            <SidePanel width={sideWidth} top={insets.top + 12} bottom={insets.bottom + 12} dark={dark}>
              {linePanel()}
            </SidePanel>
          ) : (
            <PanelSheet half={halfPanel} full={fullPanel} onHeight={setPanelHeight} onClose={closeViewLine}>
              {linePanel}
            </PanelSheet>
          ))}

        {!anyPanel &&
          (wide ? (
            <SidePanel width={sideWidth} top={insets.top + 12} bottom={insets.bottom + 12} fill dark={dark}>
              {linesContent}
            </SidePanel>
          ) : (
            <LinesDrawer
              peek={linesPeek}
              full={height - insets.top - 8}
              expanded={linesUp || linePage !== null}
              onExpandedChange={(up) => {
                setLinesUp(up);
                if (!up) setLinePage(null);
              }}
              dark={dark}
              bottomInset={insets.bottom}
            >
              {linesContent}
            </LinesDrawer>
          ))}
      </View>

      <LinesSheet
        visible={surveyOpen}
        routes={routes}
        chosen={lines}
        dark={dark}
        onChange={changeLines}
        onClose={closeSurvey}
      />

      <GuideSheet visible={guideOpen} dark={dark} onClose={closeGuide} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <TransitMap />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toolbar: { position: 'absolute', left: 12, right: 12, gap: 8 },
  brand: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
  },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2563eb' },
  brandText: { fontSize: 15, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  chipOff: { opacity: 0.45 },
  helpChip: { minWidth: 34, justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  statusRow: { position: 'absolute', right: 0, alignItems: 'center' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 14, fontWeight: '500' },
  locate: {
    position: 'absolute',
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  routesButton: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  routesIcon: { width: 14, height: 14, justifyContent: 'space-between', transform: [{ rotate: '-30deg' }] },
  routesStripe: { height: 2.5, borderRadius: 1.25 },
  locateIcon: { fontSize: 18, transform: [{ rotate: '-45deg' }] },
  stationRing: { width: 28, height: 28, borderRadius: 14, borderWidth: 3 },
  // A fixed-size box, so the marker's size is known before the text is laid out.
  stationLabel: { width: 180, height: STATION_LABEL_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  // Fixed size for the same reason; the text starts at its left edge, next to the dot.
  stationName: { width: STATION_NAME_WIDTH, height: 16, justifyContent: 'center' },
  stationNameText: { fontSize: 11, fontWeight: '700', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  stationLabelText: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
