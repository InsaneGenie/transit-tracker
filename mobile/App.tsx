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
import MapView, { Marker, Polyline, type MapPressEvent, type Region } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colorFor, displayName, facingWay, MODE_LABELS, routeKey, sameStation, tidyStopName, transferLines } from '../web/src/vehicles';
import {
  fetchArrivals,
  fetchRouteLines,
  fetchRoutes,
  fetchVehicleDetail,
  fetchVehicles,
  NotFoundError,
  type ArrivalDirection,
  type Mode,
  type RouteInfo,
  type RouteLine,
  type Station,
  type UpcomingStop,
  type Vehicle,
  type VehicleDetail,
} from './src/api';
import { LinePanel } from './src/LinePanel';
import { LinesSheet } from './src/LinesSheet';
import { boundsOf, LABEL_MIN_ZOOM, MAX_MARKERS, nearestToCenter, pollMsFor, VEHICLE_MIN_ZOOM, zoomOf } from './src/region';
import { MODE_DOT, palette } from './src/theme';
import { VehicleMarker } from './src/VehicleMarker';
import { VehiclePanel } from './src/VehiclePanel';

const ALL_MODES: Mode[] = ['subway', 'rail', 'bus'];
const LINES_KEY = 'transit-tracker:lines';
/** The server draws at most this many lines per request. */
const MAX_DRAWN_LINES = 60;
const STATION_LABEL_HEIGHT = 20;
/** How often the tapped vehicle is refreshed. */
const SELECTED_POLL_MS = 3000;
const NEW_YORK: Region = { latitude: 40.73, longitude: -73.97, latitudeDelta: 0.08, longitudeDelta: 0.06 };

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
  const [station, setStation] = useState<Station | null>(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const [transferRoutes, setTransferRoutes] = useState<RouteLine[]>([]);
  const [filterRoutes, setFilterRoutes] = useState<RouteLine[]>([]);
  const [arrivals, setArrivals] = useState<ArrivalDirection[] | null>(null);
  // Set when a vehicle is picked from the station's arrivals, so the station stays picked.
  const keepStation = useRef(false);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [linesOpen, setLinesOpen] = useState(false);
  const [region, setRegion] = useState<Region>(NEW_YORK);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [locating, setLocating] = useState(false);
  const [showsUser, setShowsUser] = useState(false);

  const zoom = zoomOf(region, width);

  // The line filter is remembered between launches.
  useEffect(() => {
    AsyncStorage.getItem(LINES_KEY)
      .then((saved) => {
        const parsed: unknown = JSON.parse(saved ?? '[]');
        if (Array.isArray(parsed)) setLines(parsed.filter((k): k is string => typeof k === 'string'));
      })
      .catch(() => {});
  }, []);
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

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setFollowing(id !== null);
    if (id === null) setDetail(null);
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

  // The lines picked in Lines are drawn as soon as they're picked.
  useEffect(() => {
    setFilterRoutes([]);
    if (!lines.length || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRouteLines(lines.slice(0, MAX_DRAWN_LINES), controller.signal)
        .then((r) => {
          setFilterRoutes(r.lines);
          // Schedules can still be loading; ask again for the lines not found yet.
          if (r.lines.length < Math.min(lines.length, MAX_DRAWN_LINES)) timer = setTimeout(load, 15_000);
        })
        .catch(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [lines, active]);

  // Lines drawn under the tapped vehicle's own: the picked lines and the picked station's transfers.
  const otherLines = useMemo(() => {
    // A line opened on its own is shown alone.
    if (viewLine && !detail) return [];
    const byKey = new Map([...filterRoutes, ...transferRoutes].map((l) => [l.key, l]));
    return [...byKey.values()];
  }, [filterRoutes, transferRoutes, viewLine, detail]);

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
    const maxLonDelta = (360 * width) / (512 * 2 ** (VEHICLE_MIN_ZOOM + 0.5));
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
  const shownLines = viewLine ? [viewLine.key] : lines;
  const shownModes = viewLine && viewRoute && !modes.includes(viewRoute.mode) ? [...modes, viewRoute.mode] : modes;
  const isShown = (v: Vehicle) =>
    shownModes.includes(v.mode) && (!shownLines.length || shownLines.includes(routeKey(v)));
  const shown = useMemo(
    () => nearestToCenter(vehicles.filter((v) => v.id !== selectedId && isShown(v)), region),
    [vehicles, shownModes.join(), shownLines.join(), selectedId, region],
  );
  const inView = vehicles.filter(isShown).length;
  // The tapped vehicle comes from its own, more frequent updates.
  const selected = detail?.vehicle.id === selectedId ? detail.vehicle : vehicles.find((v) => v.id === selectedId);

  const labelled = zoom >= LABEL_MIN_ZOOM;
  const pathColor = detail ? colorFor(detail.vehicle) : undefined;
  const panelOpen = detail !== null && detail.vehicle.id === selectedId;
  // The line panel shows when a line is open on its own and no vehicle is.
  const lineOpen = !panelOpen && viewLine !== null;
  const anyPanel = panelOpen || lineOpen;
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

  const onMapPress = (e: MapPressEvent) => {
    if (e.nativeEvent.action !== 'marker-press') select(null);
  };

  return (
    <View style={styles.fill}>
      <StatusBar style={dark ? 'light' : 'dark'} />
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
          mapPadding={{ top: insets.top + 96, right: 0, bottom: anyPanel ? panelHeight : insets.bottom, left: 0 }}
        >
          {/* Lines picked in Lines and the picked station's transfers, under the tapped vehicle's own line. */}
          {/* A vehicle's line sits faintly behind its path ahead; a line open on its own is drawn solid. */}
          {[...otherLines.filter((l) => l.key !== ownLine?.key), ...(ownLine ? [ownLine] : [])].flatMap((line) => {
            const color = colorFor({ routeColor: line.color, mode: line.mode });
            const own = line === ownLine;
            return line.paths.map((path, i) => (
              <Polyline
                key={`route-${own ? 'own' : 'other'}-${line.key}-${i}`}
                coordinates={path.map(([lon, lat]) => ({ latitude: lat, longitude: lon }))}
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
              coordinates={detail.path.map(([lon, lat]) => ({ latitude: lat, longitude: lon }))}
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
            <Marker
              key={`other-stop-${line.key}-${stop.stopId}-${dark ? 'd' : 'l'}`}
              coordinate={{ latitude: stop.lat!, longitude: stop.lon! }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => openLineStation(line.key, stop)}
            >
              <View
                style={[
                  styles.stopDot,
                  styles.otherStopDot,
                  { borderColor: colorFor({ routeColor: line.color, mode: line.mode }), backgroundColor: c.card },
                ]}
              />
            </Marker>
          ))}
          {/* Every station on the line (buses have none listed, so their next stops instead). */}
          {stationDots
            .filter((s) => s.lat !== undefined && s.lon !== undefined)
            .map((s) => (
              <Marker
                key={`stop-${ownLine?.key ?? ''}-${s.stopId}`}
                coordinate={{ latitude: s.lat!, longitude: s.lon! }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={() => pickStation(s)}
              >
                <View style={[styles.stopDot, { borderColor: ownColor, backgroundColor: c.card }]} />
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
          {shown.map((v) => (
            <VehicleMarker
              // Remount when the label appears or goes, since the marker's view isn't redrawn otherwise.
              key={`${v.id}:${labelled ? 'l' : 'd'}`}
              vehicle={v}
              labelled={labelled}
              selected={false}
              dark={dark}
              onPress={select}
            />
          ))}
          {selected && (
            <VehicleMarker key={`selected:${selected.id}`} vehicle={selected} labelled selected dark={dark} onPress={select} />
          )}
        </MapView>
      </View>

      <View style={[styles.toolbar, { top: insets.top + 8 }]} pointerEvents="box-none">
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
                <View style={[styles.chipDot, { backgroundColor: MODE_DOT[mode] }]} />
                <Text style={[styles.chipText, { color: c.text }]}>{MODE_LABELS[mode]}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setLinesOpen(true)}
            accessibilityRole="button"
            style={[styles.chip, { backgroundColor: lines.length ? c.accent : c.chip }]}
          >
            <Text style={[styles.chipText, { color: lines.length ? '#ffffff' : c.text }]}>
              {lines.length ? `Lines (${lines.length})` : 'Lines'}
            </Text>
          </Pressable>
        </View>
      </View>

      {!anyPanel && (
        <View style={[styles.status, { bottom: insets.bottom + 16, backgroundColor: c.chip }]} pointerEvents="none">
          <View
            style={[
              styles.statusDot,
              { backgroundColor: status === 'live' ? '#16a34a' : status === 'error' ? '#dc2626' : '#9ca3af' },
            ]}
          />
          <Text style={[styles.statusText, { color: c.text }]}>{statusText}</Text>
        </View>
      )}

      <Pressable
        onPress={locate}
        disabled={locating}
        accessibilityRole="button"
        accessibilityLabel="Show my location"
        style={[
          styles.locate,
          { backgroundColor: c.chip, bottom: (anyPanel ? panelHeight : insets.bottom) + 16 },
        ]}
      >
        <Text style={[styles.locateIcon, { color: c.accent }]}>➤</Text>
      </Pressable>

      {panelOpen && (
        <View style={[styles.panelWrap, { maxHeight: height * 0.5 }]} onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} pointerEvents="box-none">
          <VehiclePanel
            detail={detail}
            routes={routesByKey}
            following={following}
            dark={dark}
            bottomInset={insets.bottom}
            onFollow={() => setFollowing((f) => !f)}
            onAllStations={openOwnLine}
            station={station}
            stationTransfers={stationTransfers}
            showTransfers={showTransfers}
            onShowTransfers={setShowTransfers}
            arrivals={arrivals}
            onArrival={(id) => {
              if (id === selectedId) return;
              keepStation.current = true;
              select(id);
            }}
            onLine={(key) => openLine(key)}
            onStop={pickStation}
            onClose={() => select(null)}
          />
        </View>
      )}

      {lineOpen && viewLine && (
        <View
          style={[styles.panelWrap, { maxHeight: height * 0.5 }]}
          onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
          pointerEvents="box-none"
        >
          <LinePanel
            info={routesByKey.get(viewLine.key)}
            line={listedRoute}
            routes={routesByKey}
            station={station}
            arrivals={arrivals}
            backLabel={viewLine.back?.label}
            dark={dark}
            bottomInset={insets.bottom}
            onBack={closeLine}
            onStop={pickStation}
            onArrival={(id) => {
              keepStation.current = true;
              select(id);
            }}
            onLine={(key) => openLine(key)}
            onClose={() => {
              setViewLine(null);
              setStation(null);
            }}
          />
        </View>
      )}

      <LinesSheet
        visible={linesOpen}
        routes={routes}
        modes={modes}
        chosen={lines}
        dark={dark}
        onChange={changeLines}
        onClose={() => setLinesOpen(false)}
      />
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
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 14, fontWeight: '600' },
  status: {
    position: 'absolute',
    alignSelf: 'center',
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
  locateIcon: { fontSize: 18, transform: [{ rotate: '-45deg' }] },
  panelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  stopDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  otherStopDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  stationRing: { width: 28, height: 28, borderRadius: 14, borderWidth: 3 },
  // A fixed-size box, so the marker's size is known before the text is laid out.
  stationLabel: { width: 180, height: STATION_LABEL_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  stationLabelText: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
