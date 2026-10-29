import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colorFor, displayName, MODE_LABELS, tidyStopName, transferLines } from '../../web/src/vehicles';
import { towards } from '../../web/src/lines';
import { AlertList } from './AlertList';
import { fetchLineVehicles, type LineVehicle, type RouteInfo, type RouteLine, type ServiceAlert, type UpcomingStop } from './api';
import { LineBadge, vehicleCount } from './LineBadge';
import { palette } from './theme';
import { Transfers } from './VehiclePanel';

/** Each station's row on the strip; vehicles are placed by it, so every row is the same height. */
const ROW = 56;
const MARKER = 28;
/** The strip's line runs down this far from the left. */
const TRACK_X = 22;
const POLL_MS = 10_000;

interface Props {
  lineKey: string;
  info?: RouteInfo;
  /** Its route and stations; null while loading. */
  line: RouteLine | null;
  routes: Map<string, RouteInfo>;
  alerts: ServiceAlert[] | null;
  count?: number;
  starred: boolean;
  active: boolean;
  dark: boolean;
  topInset: number;
  onBack: () => void;
  onStar: () => void;
  onShowOnMap: () => void;
  onStation: (stop: UpcomingStop) => void;
  onVehicle: (v: LineVehicle) => void;
}

/** The line's vehicles along its stations, kept fresh. Null until they first load, or if they can't be. */
function useLineVehicles(key: string, active: boolean): LineVehicle[] | null {
  const [vehicles, setVehicles] = useState<LineVehicle[] | null>(null);
  useEffect(() => {
    setVehicles(null);
    if (!active) return;
    const controller = new AbortController();
    const load = () =>
      fetchLineVehicles(key, controller.signal)
        .then((r) => setVehicles(r.vehicles))
        .catch(() => {});
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [key, active]);
  return vehicles;
}

/** A line's own page: its alerts, and its trains or buses moving down a strip of its stations. */
export function LinePage({
  lineKey,
  info,
  line,
  routes,
  alerts,
  count,
  starred,
  active,
  dark,
  topInset,
  onBack,
  onStar,
  onShowOnMap,
  onStation,
  onVehicle,
}: Props) {
  const c = palette(dark);
  const vehicles = useLineVehicles(lineKey, active);
  const [heading, setHeading] = useState<1 | -1>(1);
  const mode = info?.mode ?? line?.mode ?? 'subway';
  const color = colorFor({ routeColor: info?.color ?? line?.color, mode });
  const name = displayName(info?.name ?? lineKey.split(':')[1] ?? '?');
  const noun = mode === 'bus' ? 'buses' : 'trains';
  const stops = line?.stops ?? [];
  const ordered = heading === 1 ? stops : [...stops].reverse();
  const going = useMemo(() => (vehicles ?? []).filter((v) => v.heading === heading), [vehicles, heading]);
  const out = count ?? vehicles?.length;

  return (
    <View style={[styles.page, { backgroundColor: c.card, paddingTop: topInset }]}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" style={styles.back}>
        <Text style={[styles.backText, { color: c.accent }]}>‹ Lines</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <LineBadge route={{ mode, name, color: info?.color ?? line?.color }} size={48} />
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
              {info?.longName || (mode === 'rail' ? name : `${MODE_LABELS[mode]} ${name}`)}
            </Text>
            <Text style={[styles.muted, { color: c.muted }]}>
              {out === undefined ? info?.agency : out ? `${vehicleCount(out, mode)} running` : `No ${noun} running now`}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onShowOnMap}
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, { backgroundColor: c.accent }, pressed && styles.pressed]}
          >
            <Text style={[styles.buttonText, { color: '#ffffff' }]}>Show on map</Text>
          </Pressable>
          <Pressable
            onPress={onStar}
            accessibilityRole="button"
            accessibilityState={{ selected: starred }}
            style={({ pressed }) => [styles.button, { backgroundColor: c.raised }, pressed && styles.pressed]}
          >
            <Text style={[styles.buttonText, { color: starred ? '#eab308' : c.text }]}>
              {starred ? '★ My line' : '☆ Add to my lines'}
            </Text>
          </Pressable>
        </View>

        <AlertList alerts={alerts} routes={routes} dark={dark} empty="No delays or service changes on this line right now." />

        {!line ? (
          <Text style={[styles.muted, { color: c.muted }]}>Loading the line…</Text>
        ) : stops.length === 0 ? (
          <Text style={[styles.muted, { color: c.muted }]}>
            The schedule doesn't list this line's stops, but its route and {noun} are on the map.
          </Text>
        ) : (
          <>
            <View style={[styles.segment, { backgroundColor: c.raised }]} accessibilityRole="tablist">
              {([1, -1] as const).map((h) => (
                <Pressable
                  key={h}
                  onPress={() => setHeading(h)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: h === heading }}
                  style={[styles.segmentItem, h === heading && { backgroundColor: c.segmentOn }]}
                >
                  <Text style={[styles.segmentText, { color: c.text }, h === heading && styles.segmentTextOn]} numberOfLines={1}>
                    To {towards(vehicles ?? [], h, stops) ?? (h === 1 ? 'the end' : 'the start')}
                  </Text>
                </Pressable>
              ))}
            </View>
            {vehicles === null && (
              <Text style={[styles.muted, styles.note, { color: c.muted }]}>Finding the {noun} on this line…</Text>
            )}

            <View style={{ height: ordered.length * ROW }}>
              <View
                style={[styles.track, { backgroundColor: color, top: ROW / 2, height: Math.max(ordered.length - 1, 0) * ROW }]}
              />
              {ordered.map((s, i) => (
                <Pressable
                  key={`${s.stopId}-${i}`}
                  onPress={() => onStation(s)}
                  disabled={s.lat === undefined || s.lon === undefined}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.station, pressed && styles.pressed]}
                >
                  <View style={[styles.stationDot, { borderColor: color, backgroundColor: c.card }]} />
                  <View style={styles.stationText}>
                    <Text style={[styles.stationName, { color: c.text }]} numberOfLines={1}>
                      {s.name ? tidyStopName(s.name) : s.stopId}
                    </Text>
                    <Transfers lines={transferLines(s.transfers, routes)} muted={c.muted} />
                  </View>
                </Pressable>
              ))}
              {going.map((v) => {
                const place = heading === 1 ? v.at : stops.length - 1 - v.at;
                return (
                  <Pressable
                    key={v.vehicle.id}
                    onPress={() => onVehicle(v)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`${name} ${mode === 'bus' ? 'bus' : 'train'}${v.destination ? ` to ${tidyStopName(v.destination)}` : ''}`}
                    style={[styles.vehicle, { top: place * ROW + ROW / 2 - MARKER / 2 }]}
                  >
                    <View style={styles.vehicleRing}>
                      <LineBadge route={{ mode, name, color: info?.color ?? line.color }} size={MARKER - 4} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  back: { alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8 },
  backText: { fontSize: 17 },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 24, fontWeight: '800' },
  muted: { fontSize: 14 },
  note: { marginTop: -4 },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  segment: { flexDirection: 'row', borderRadius: 9, padding: 2 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderRadius: 7 },
  segmentText: { fontSize: 14 },
  segmentTextOn: { fontWeight: '700' },
  track: { position: 'absolute', left: TRACK_X - 3, width: 6, borderRadius: 3 },
  station: { height: ROW, flexDirection: 'row', alignItems: 'center' },
  stationDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, marginLeft: TRACK_X - 7 },
  stationText: { flex: 1, minWidth: 0, marginLeft: 22 },
  stationName: { fontSize: 15, fontWeight: '500' },
  vehicle: { position: 'absolute', left: TRACK_X - MARKER / 2 },
  vehicleRing: {
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
});
