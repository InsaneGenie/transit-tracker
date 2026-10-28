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
import { colorFor, MODE_LABELS, routeKey } from '../web/src/vehicles';
import {
  fetchRoutes,
  fetchVehicleDetail,
  fetchVehicles,
  NotFoundError,
  type Mode,
  type RouteInfo,
  type Vehicle,
  type VehicleDetail,
} from './src/api';
import { LinesSheet } from './src/LinesSheet';
import { boundsOf, LABEL_MIN_ZOOM, MAX_MARKERS, nearestToCenter, pollMsFor, VEHICLE_MIN_ZOOM, zoomOf } from './src/region';
import { MODE_DOT, palette } from './src/theme';
import { VehicleMarker } from './src/VehicleMarker';
import { VehiclePanel } from './src/VehiclePanel';

const ALL_MODES: Mode[] = ['subway', 'rail', 'bus'];
const LINES_KEY = 'transit-tracker:lines';
/** How often the tapped vehicle is refreshed. */
const SELECTED_POLL_MS = 3000;
const NEW_YORK: Region = { latitude: 40.73, longitude: -73.97, latitudeDelta: 0.08, longitudeDelta: 0.06 };

type Status = 'connecting' | 'live' | 'error' | 'zoomedOut';

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

  const shown = useMemo(() => {
    const chosen = vehicles.filter(
      (v) => v.id !== selectedId && modes.includes(v.mode) && (!lines.length || lines.includes(routeKey(v))),
    );
    return nearestToCenter(chosen, region);
  }, [vehicles, modes, lines, selectedId, region]);
  const inView = vehicles.filter((v) => modes.includes(v.mode) && (!lines.length || lines.includes(routeKey(v)))).length;
  // The tapped vehicle comes from its own, more frequent updates.
  const selected = detail?.vehicle.id === selectedId ? detail.vehicle : vehicles.find((v) => v.id === selectedId);

  const labelled = zoom >= LABEL_MIN_ZOOM;
  const pathColor = detail ? colorFor(detail.vehicle) : undefined;
  const panelOpen = detail !== null && detail.vehicle.id === selectedId;

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
          mapPadding={{ top: insets.top + 96, right: 0, bottom: panelOpen ? panelHeight : insets.bottom, left: 0 }}
        >
          {detail && detail.vehicle.id === selectedId && detail.path.length > 1 && (
            <Polyline
              coordinates={detail.path.map(([lon, lat]) => ({ latitude: lat, longitude: lon }))}
              strokeColor={pathColor}
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {detail?.vehicle.id === selectedId &&
            detail.upcoming
              .filter((s) => s.lat !== undefined && s.lon !== undefined)
              .map((s) => (
                <Marker
                  key={`stop-${s.stopId}`}
                  coordinate={{ latitude: s.lat!, longitude: s.lon! }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                  title={s.name}
                >
                  <View style={[styles.stopDot, { borderColor: pathColor, backgroundColor: c.card }]} />
                </Marker>
              ))}
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

      {!panelOpen && (
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
          { backgroundColor: c.chip, bottom: (panelOpen ? panelHeight : insets.bottom) + 16 },
        ]}
      >
        <Text style={[styles.locateIcon, { color: c.accent }]}>➤</Text>
      </Pressable>

      {panelOpen && (
        <View style={[styles.panelWrap, { maxHeight: height * 0.5 }]} onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} pointerEvents="box-none">
          <VehiclePanel
            detail={detail}
            following={following}
            dark={dark}
            bottomInset={insets.bottom}
            onFollow={() => setFollowing((f) => !f)}
            onClose={() => select(null)}
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
});
