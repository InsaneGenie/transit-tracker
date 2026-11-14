import { memo, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Marker, type Region } from 'react-native-maps';
import {
  BIKE_COLOR,
  BIKE_MIN_ZOOM,
  BIKE_POLL_MS,
  bikeArea,
  bikesText,
  covers,
  dockColor,
  docksText,
  hasBikes,
  updatedText,
} from '../../web/src/bikes';
import { fetchBikes, type BikeDock } from './api';
import { boundsOf, type Bounds } from './region';
import { palette } from './theme';

const BIKE_GLYPH = require('../assets/vehicles/bike.png');

/** The most docks drawn at once, since each is a native view; the ones nearest the middle win. */
const MAX_DOCKS = 150;

/** Docks show their bike count from this zoom; further out they are plain dots. */
const COUNT_MIN_ZOOM = 15;

export interface BikeState {
  /** The docks loaded for the area around the view. */
  docks: BikeDock[];
  updatedAt?: string;
  /** Zoomed out too far to show docks. */
  zoomIn: boolean;
  /** The last try to load them failed. */
  error: boolean;
}

const NONE: BikeState = { docks: [], zoomIn: false, error: false };

/**
 * Citi Bike docks around the view while `on`: loaded for a little more than the view, so a short pan asks
 * for nothing, then again each minute while the app is open.
 */
export function useBikeDocks(on: boolean, region: Region, zoom: number, active: boolean): BikeState {
  const [state, setState] = useState<BikeState>(NONE);
  const loaded = useRef<{ area: Bounds | null; at: number }>({ area: null, at: 0 });
  useEffect(() => {
    if (!on) {
      loaded.current = { area: null, at: 0 };
      setState(NONE);
      return;
    }
    if (!active) return;
    if (zoom < BIKE_MIN_ZOOM) {
      loaded.current = { area: null, at: 0 };
      setState({ ...NONE, zoomIn: true });
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const want = bikeArea(boundsOf(region));
      try {
        const r = await fetchBikes(want, controller.signal);
        loaded.current = { area: r.zoomIn ? null : want, at: Date.now() };
        setState({ docks: r.docks, updatedAt: r.updatedAt, zoomIn: Boolean(r.zoomIn), error: false });
      } catch {
        if (controller.signal.aborted) return;
        // Keep showing what was loaded; try again sooner than usual.
        setState((s) => ({ ...s, zoomIn: false, error: true }));
        timer = setTimeout(load, 15_000);
        return;
      }
      timer = setTimeout(load, BIKE_POLL_MS);
    };
    const { area, at } = loaded.current;
    const age = Date.now() - at;
    if (area && covers(area, boundsOf(region)) && age < BIKE_POLL_MS) timer = setTimeout(load, BIKE_POLL_MS - age);
    else void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // `zoom` comes from `region`.
  }, [on, region, active]);
  return state;
}

/** The docks inside the view, at most MAX_DOCKS of them nearest its middle, in a fixed order. */
export function docksInView(docks: BikeDock[], region: Region): BikeDock[] {
  const [west, south, east, north] = boundsOf(region);
  const inView = docks.filter((d) => d.lon >= west && d.lon <= east && d.lat >= south && d.lat <= north);
  if (inView.length <= MAX_DOCKS) return inView;
  const k = Math.cos((region.latitude * Math.PI) / 180);
  const dist = (d: BikeDock) => ((d.lon - region.longitude) * k) ** 2 + (d.lat - region.latitude) ** 2;
  // Apple Maps redraws a marker that moves in the list, so the nearest are put back in the server's order.
  const nearest = new Set([...inView].sort((a, b) => dist(a) - dist(b)).slice(0, MAX_DOCKS));
  return inView.filter((d) => nearest.has(d));
}

/** The Citi Bike part of the status line. */
export function bikeStatus(b: BikeState, inView: number): string {
  if (b.zoomIn) return 'Zoom in for Citi Bike docks';
  if (b.error && !b.docks.length) return "Can't load Citi Bike docks";
  return `${inView.toLocaleString()} Citi Bike ${inView === 1 ? 'dock' : 'docks'}`;
}

interface DockProps {
  dock: BikeDock;
  /** Big enough to show its bike count. */
  counted: boolean;
  outline: string;
  onPress: (id: string) => void;
}

/**
 * A dock: a dot, blue with bikes to take and gray without, with its bike count once zoomed in. Its view is
 * drawn once, so the key it is given must change with what it shows.
 */
export const DockMarker = memo(function DockMarker({ dock, counted, outline, onPress }: DockProps) {
  const size = counted ? 22 : 12;
  return (
    <Marker
      coordinate={{ latitude: dock.lat, longitude: dock.lon }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={0}
      onPress={() => onPress(dock.id)}
      accessibilityLabel={`Citi Bike dock ${dock.name}: ${bikesText(dock)}`}
    >
      {/* A fingertip-sized square takes the tap; collapsable={false} keeps it, so the dot stays centered. */}
      <View style={styles.hit} collapsable={false}>
        <View
          style={[
            styles.dot,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: dockColor(dock), borderColor: outline },
          ]}
        >
          {counted && (
            <Text style={styles.count} numberOfLines={1}>
              {dock.renting ? dock.bikes : 0}
            </Text>
          )}
        </View>
      </View>
    </Marker>
  );
});

/** What a tapped dock has: its bikes and open docks, and when Citi Bike last counted them. */
export function BikeCard({ dock, updatedAt, dark, onClose }: { dock: BikeDock; updatedAt?: string; dark: boolean; onClose: () => void }) {
  const c = palette(dark);
  return (
    <View style={[styles.card, { backgroundColor: c.card }]} accessibilityLabel={`Citi Bike dock ${dock.name}`}>
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: BIKE_COLOR }]}>
          <Image source={BIKE_GLYPH} style={styles.cardGlyph} />
        </View>
        <Text style={[styles.cardName, { color: c.text }]} numberOfLines={2}>
          {dock.name || 'Citi Bike dock'}
        </Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={styles.close}>
          <Text style={[styles.closeText, { color: c.muted }]}>×</Text>
        </Pressable>
      </View>
      <Text style={[styles.line, hasBikes(dock) ? [styles.bikes, { color: dark ? '#38bdf8' : BIKE_COLOR }] : { color: c.muted }]}>
        {bikesText(dock)}
      </Text>
      <Text style={[styles.line, { color: dock.returning && dock.docks > 0 ? c.text : c.muted }]}>{docksText(dock)}</Text>
      {!!updatedAt && <Text style={[styles.updated, { color: c.muted }]}>Citi Bike · {updatedText(updatedAt)}</Text>}
    </View>
  );
}

/** The Citi Bike switch's icon: a bicycle in a circle, hollow when switched off, like the mode icons. */
export function BikeChipIcon({ on, size = 16 }: { on: boolean; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? BIKE_COLOR : 'transparent',
        borderColor: BIKE_COLOR,
        borderWidth: on ? 0 : 1.5,
      }}
    >
      <Image source={BIKE_GLYPH} style={{ width: size * 0.7, height: size * 0.7, tintColor: on ? '#ffffff' : BIKE_COLOR }} />
    </View>
  );
}

export { COUNT_MIN_ZOOM };

const styles = StyleSheet.create({
  hit: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  dot: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  count: { color: '#ffffff', fontSize: 10, fontWeight: '800' },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    gap: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  cardIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardGlyph: { width: 15, height: 15, tintColor: '#ffffff' },
  cardName: { flex: 1, fontSize: 15, fontWeight: '700' },
  close: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 22, lineHeight: 24 },
  line: { fontSize: 14 },
  bikes: { fontWeight: '700' },
  updated: { fontSize: 12, marginTop: 3 },
});
