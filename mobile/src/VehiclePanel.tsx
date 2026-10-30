import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colorFor,
  displayName,
  formatEta,
  MODE_LABELS,
  sameStation,
  textColorFor,
  tidyStopName,
  transferLines,
} from '../../web/src/vehicles';
import { AccessLine, WithAccess } from './AccessIcon';
import { AlertList } from './AlertList';
import type { ArrivalDirection, RouteInfo, ServiceAlert, Station, UpcomingStop, VehicleDetail } from './api';
import { SheetHandle, type Sheet } from './PanelSheet';
import { palette } from './theme';

const MAX_STOPS = 12;

interface Props {
  detail: VehicleDetail;
  /** Only the vehicle is known so far; its stops are on their way. */
  loading?: boolean;
  /** Every line by key, to show transfers with their colors. */
  routes: Map<string, RouteInfo>;
  following: boolean;
  /** The station picked on the map or in this list, highlighted here. */
  station: Station | null;
  /** Lines you can transfer to at that station, as route keys. */
  stationTransfers: string[];
  showTransfers: boolean;
  onShowTransfers: (show: boolean) => void;
  /** The line's vehicles on their way to the picked station, both ways; null while loading. */
  arrivals: ArrivalDirection[] | null;
  /** Delays and service changes on the vehicle's line; null while loading. */
  alerts: ServiceAlert[] | null;
  /** Tapping one of them opens it. */
  onArrival: (vehicleId: string) => void;
  /** Tapping a transfer line at the station shows that whole line. */
  onLine: (key: string) => void;
  dark: boolean;
  bottomInset: number;
  /** Makes the panel draggable; without it the handle is only drawn. */
  sheet?: Sheet;
  onFollow: () => void;
  /** Show every station on the vehicle's line, not just the ones ahead. */
  onAllStations: () => void;
  /** Tapping a stop in the list brings it into view. */
  onStop: (stop: UpcomingStop) => void;
  onClose: () => void;
}

/**
 * The other lines that call at a stop: subway bullets, or a color swatch and name for rail and buses.
 * With `onPick`, each one is a button that opens that line, drawn a little bigger to be easy to tap.
 */
export function Transfers({
  lines,
  muted,
  onPick,
}: {
  lines: RouteInfo[];
  muted: string;
  onPick?: (key: string) => void;
}) {
  if (!lines.length) return null;
  return (
    <View
      style={[styles.transfers, onPick && styles.transfersPick]}
      accessibilityLabel={onPick ? undefined : `Transfer to ${lines.map((r) => r.name).join(', ')}`}
    >
      {lines.map((r) => {
        const color = colorFor({ routeColor: r.color, mode: r.mode });
        const badge =
          r.mode === 'subway' ? (
            <View style={[styles.bullet, { backgroundColor: color }, onPick && styles.bulletPick]}>
              <Text style={[styles.bulletText, { color: textColorFor(color) }, onPick && styles.bulletTextPick]}>
                {r.name}
              </Text>
            </View>
          ) : (
            <View style={styles.named}>
              <View style={[styles.swatch, { backgroundColor: color }]} />
              <Text style={[styles.namedText, { color: muted }]}>{r.name}</Text>
            </View>
          );
        return onPick ? (
          <Pressable
            key={r.key}
            onPress={() => onPick(r.key)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Show the ${r.name} line`}
            style={({ pressed }) => pressed && styles.pressed}
          >
            {badge}
          </Pressable>
        ) : (
          <View key={r.key}>{badge}</View>
        );
      })}
    </View>
  );
}

/** The line's vehicles still heading to the picked station, by direction, soonest first. */
export function Arrivals({
  directions,
  selectedId,
  noun,
  dark,
  onPick,
}: {
  directions: ArrivalDirection[] | null;
  /** The open vehicle, marked in the list. */
  selectedId?: string;
  noun: string;
  dark: boolean;
  onPick: (vehicleId: string) => void;
}) {
  const c = palette(dark);
  const nouns = noun === 'bus' ? 'buses' : `${noun}s`;
  if (!directions) return <Text style={[styles.muted, { color: c.muted }]}>Finding the {nouns} on the way…</Text>;
  if (!directions.length)
    return <Text style={[styles.muted, { color: c.muted }]}>No {nouns} on the way here right now.</Text>;
  return (
    <View style={styles.arrivals}>
      {directions.map((d) => (
        <View key={d.arrivals[0].vehicle.id} accessibilityLabel={`To ${d.destinations.join(', ')}`}>
          <Text style={[styles.arrivalsHeading, { color: c.muted }]}>
            {d.destinations.length ? `To ${d.destinations.map(tidyStopName).join(' / ')}` : 'On the way'}
          </Text>
          {d.arrivals.map(({ vehicle: v, time, stopsAway }) => {
            const stop = v.stopName && tidyStopName(v.stopName);
            const where = v.status === 'STOPPED_AT' && stop ? `At ${stop}` : stop ? `Heading to ${stop}` : 'On the way';
            const away = stopsAway === 0 ? 'Next stop' : `${stopsAway} stop${stopsAway === 1 ? '' : 's'} away`;
            const current = v.id === selectedId;
            return (
              <Pressable
                key={v.id}
                onPress={() => onPick(v.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                style={({ pressed }) => [
                  styles.arrival,
                  current && { backgroundColor: c.border },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.sourceDot, { color: c.muted }]}>{v.source === 'gps' ? '●' : '○'}</Text>
                <View style={styles.stopText}>
                  <Text style={[styles.stopName, { color: c.text }]} numberOfLines={1}>
                    {where}
                  </Text>
                  <Text style={[styles.small, { color: c.muted }]}>{current ? `This ${noun} · ${away}` : away}</Text>
                </View>
                <Text style={[styles.eta, { color: c.muted }]}>{formatEta(time)}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** The tapped vehicle's line, where it is and its next stops, as a sheet along the bottom. */
export function VehiclePanel({
  detail,
  loading,
  routes,
  following,
  station,
  stationTransfers,
  showTransfers,
  onShowTransfers,
  arrivals,
  alerts,
  onArrival,
  onLine,
  dark,
  bottomInset,
  sheet,
  onFollow,
  onAllStations,
  onStop,
  onClose,
}: Props) {
  const c = palette(dark);
  const { vehicle, upcoming, routeLongName } = detail;
  const color = colorFor(vehicle);
  const name = displayName(vehicle.routeName ?? vehicle.routeId ?? '?');
  const stopName = vehicle.stopName && tidyStopName(vehicle.stopName);
  const next = upcoming[0]?.name ? tidyStopName(upcoming[0].name) : stopName;
  const where =
    vehicle.status === 'STOPPED_AT' && stopName ? `At ${stopName}` : next ? `Next stop: ${next}` : undefined;

  return (
    <View style={[styles.panel, { backgroundColor: c.card, paddingBottom: bottomInset + 12 }]}>
      {/* Dragging anywhere above the list moves the panel up or down. */}
      <View {...sheet?.grab}>
        <SheetHandle sheet={sheet} color={c.border} />
        <View style={styles.header}>
          <View style={[styles.badge, { backgroundColor: color }]}>
            <Text style={[styles.badgeText, { color: textColorFor(color) }]}>{name}</Text>
          </View>
          <View style={styles.title}>
            <Text style={[styles.titleText, { color: c.text }]} numberOfLines={2}>
              {routeLongName || `${MODE_LABELS[vehicle.mode]} ${name}`}
            </Text>
            <Text style={[styles.muted, { color: c.muted }]}>{vehicle.agency}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[styles.close, { color: c.muted }]}>✕</Text>
          </Pressable>
        </View>

        {where && <Text style={[styles.where, { color: c.text }]}>{where}</Text>}
        <View style={styles.meta}>
          <Text style={[styles.muted, styles.metaText, { color: c.muted }]}>
            {vehicle.source === 'gps' ? '● Live GPS position' : '○ Estimated from arrival times'}
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={onAllStations} accessibilityRole="button" style={[styles.follow, { borderColor: c.border }]}>
              <Text style={[styles.followText, { color: c.text }]}>All stations</Text>
            </Pressable>
            <Pressable
              onPress={onFollow}
              accessibilityRole="button"
              accessibilityState={{ selected: following }}
              style={[
                styles.follow,
                { borderColor: c.border },
                following && { backgroundColor: c.accent, borderColor: c.accent },
              ]}
            >
              <Text style={[styles.followText, { color: following ? '#ffffff' : c.text }]}>
                {following ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView style={styles.body}>
        <AlertList alerts={alerts} routes={routes} dark={dark} />

        {station && (
          <View style={[styles.stationCard, { borderColor: color }]} accessibilityLabel="Picked station">
            <View style={styles.stationTop}>
              <View style={styles.stationText}>
                <Text style={[styles.titleText, { color: c.text }]} numberOfLines={1}>
                  {station.name ? tidyStopName(station.name) : 'Station'}
                </Text>
                <AccessLine stop={station} color={c.muted} />
                {stationTransfers.length > 0 ? (
                  <Transfers lines={transferLines(stationTransfers, routes)} muted={c.muted} onPick={onLine} />
                ) : (
                  <Text style={[styles.muted, { color: c.muted }]}>No transfers here</Text>
                )}
              </View>
              {stationTransfers.length > 0 && (
                <Pressable
                  onPress={() => onShowTransfers(!showTransfers)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: showTransfers }}
                  style={[
                    styles.follow,
                    { borderColor: c.border },
                    showTransfers && { backgroundColor: c.accent, borderColor: c.accent },
                  ]}
                >
                  <Text style={[styles.followText, { color: showTransfers ? '#ffffff' : c.text }]}>
                    {showTransfers ? 'Hide transfers' : 'Show transfers'}
                  </Text>
                </Pressable>
              )}
            </View>
            <Arrivals
              directions={arrivals}
              selectedId={vehicle.id}
              noun={vehicle.mode === 'bus' ? 'bus' : 'train'}
              dark={dark}
              onPick={onArrival}
            />
          </View>
        )}

        {upcoming.length > 0 ? (
          <View>
            {upcoming.slice(0, MAX_STOPS).map((s, i) => {
              const chosen = station !== null && sameStation(s, station);
              return (
                <Pressable
                  key={s.stopId}
                  style={({ pressed }) => [
                    styles.stop,
                    chosen && { backgroundColor: `${color}26` },
                    pressed && styles.pressed,
                  ]}
                  disabled={s.lat === undefined || s.lon === undefined}
                  onPress={() => onStop(s)}
                  accessibilityRole="button"
                >
                  <View style={[styles.stopDot, { borderColor: color }, i === 0 && { backgroundColor: color }]} />
                  <View style={styles.stopText}>
                    <WithAccess stop={s}>
                      <Text style={[styles.stopName, styles.shrink, { color: c.text }]} numberOfLines={1}>
                        {s.name ? tidyStopName(s.name) : s.stopId}
                      </Text>
                    </WithAccess>
                    <Transfers lines={transferLines(s.transfers, routes)} muted={c.muted} />
                  </View>
                  <Text style={[styles.eta, { color: c.muted }]}>{formatEta(s.time)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.muted, { color: c.muted }]}>
            {loading ? 'Finding its next stops…' : 'No upcoming stops reported for this vehicle.'}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexShrink: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 16, fontWeight: '800' },
  title: { flex: 1 },
  titleText: { fontSize: 16, fontWeight: '700' },
  muted: { fontSize: 13 },
  close: { fontSize: 18, padding: 4 },
  where: { fontSize: 15, fontWeight: '600', marginTop: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  metaText: { flexShrink: 1, marginRight: 8 },
  actions: { flexDirection: 'row', gap: 6 },
  follow: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  followText: { fontSize: 14, fontWeight: '600' },
  body: { flexGrow: 0, flexShrink: 1 },
  small: { fontSize: 12 },
  arrivals: { marginTop: 8, gap: 6 },
  arrivalsHeading: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  arrival: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  sourceDot: { fontSize: 10 },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 6,
    marginHorizontal: -6,
    borderRadius: 8,
    gap: 10,
  },
  stationTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stationCard: {
    borderLeftWidth: 4,
    borderRadius: 8,
    paddingVertical: 8,
    paddingLeft: 10,
    marginBottom: 8,
  },
  stationText: { flex: 1, gap: 4 },
  stopDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  pressed: { opacity: 0.5 },
  stopText: { flex: 1, gap: 3 },
  stopName: { fontSize: 14 },
  shrink: { flexShrink: 1 },
  transfers: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  transfersPick: { gap: 8, marginTop: 2 },
  bulletPick: { minWidth: 26, height: 26, borderRadius: 13 },
  bulletTextPick: { fontSize: 13 },
  bullet: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletText: { fontSize: 10, fontWeight: '800' },
  named: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
  namedText: { fontSize: 12 },
  eta: { fontSize: 14, fontVariant: ['tabular-nums'] },
});

/** Shared with the line panel, which is laid out the same way. */
export { styles as panelStyles };
