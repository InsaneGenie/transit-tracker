import { Pressable, ScrollView, Text, View } from 'react-native';
import { colorFor, displayName, MODE_LABELS, sameStation, textColorFor, tidyStopName, transferLines } from '../../web/src/vehicles';
import { AccessLine, WithAccess } from './AccessIcon';
import { AlertList } from './AlertList';
import type { ArrivalDirection, RouteInfo, RouteLine, ServiceAlert, Station, UpcomingStop } from './api';
import { SheetHandle, type Sheet } from './PanelSheet';
import { palette } from './theme';
import { Arrivals, panelStyles as styles, Transfers } from './VehiclePanel';

interface Props {
  /** The line being shown, from the Lines list. */
  info?: RouteInfo;
  /** Its route and stations; null while loading. */
  line: RouteLine | null;
  routes: Map<string, RouteInfo>;
  station: Station | null;
  /** The line's vehicles on their way to the picked station. */
  arrivals: ArrivalDirection[] | null;
  /** Delays and service changes on the line; null while loading. */
  alerts: ServiceAlert[] | null;
  /** Where Back goes, e.g. "the A train"; no Back button without it. */
  backLabel?: string;
  dark: boolean;
  bottomInset: number;
  /** Makes the panel draggable; without it the handle is only drawn. */
  sheet?: Sheet;
  onBack: () => void;
  onStop: (stop: UpcomingStop) => void;
  onArrival: (vehicleId: string) => void;
  /** Tapping a transfer at the picked station shows that line instead. */
  onLine: (key: string) => void;
  onClose: () => void;
}

/** A whole line, opened from a station's transfers: its stations here, its route and vehicles on the map. */
export function LinePanel({
  info,
  line,
  routes,
  station,
  arrivals,
  alerts,
  backLabel,
  dark,
  bottomInset,
  sheet,
  onBack,
  onStop,
  onArrival,
  onLine,
  onClose,
}: Props) {
  const c = palette(dark);
  const mode = info?.mode ?? line?.mode ?? 'subway';
  const color = colorFor({ routeColor: info?.color ?? line?.color, mode });
  const name = displayName(info?.name ?? line?.key.split(':')[1] ?? '?');
  const noun = mode === 'bus' ? 'bus' : 'train';
  const stationTransfers = transferLines(station?.transfers, routes).filter((r) => r.key !== line?.key);

  return (
    <View
      style={[styles.panel, { backgroundColor: c.card, paddingBottom: bottomInset + 12 }]}
      accessibilityLabel={`${name} line`}
    >
      {/* Dragging anywhere above the list moves the panel up or down. */}
      <View {...sheet?.grab}>
        <SheetHandle sheet={sheet} color={c.border} />
        <View style={styles.header}>
          <View style={[styles.badge, { backgroundColor: color }]}>
            <Text style={[styles.badgeText, { color: textColorFor(color) }]}>{name}</Text>
          </View>
          <View style={styles.title}>
            <Text style={[styles.titleText, { color: c.text }]} numberOfLines={2}>
              {info?.longName || `${MODE_LABELS[mode]} ${name}`}
            </Text>
            {info?.agency && <Text style={[styles.muted, { color: c.muted }]}>{info.agency}</Text>}
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[styles.close, { color: c.muted }]}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.meta}>
          <Text style={[styles.muted, { color: c.muted }]}>Every station and {noun} on this line</Text>
          {backLabel && (
            <Pressable onPress={onBack} accessibilityRole="button" style={[styles.follow, { borderColor: c.border }]}>
              <Text style={[styles.followText, { color: c.text }]}>Back to {backLabel}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView style={styles.body}>
        <AlertList alerts={alerts} routes={routes} dark={dark} empty="No delays or service changes on this line right now." />

        {station && (
          <View style={[styles.stationCard, { borderColor: color }]} accessibilityLabel="Picked station">
            <View style={styles.stationText}>
              <Text style={[styles.titleText, { color: c.text }]} numberOfLines={1}>
                {station.name ? tidyStopName(station.name) : 'Station'}
              </Text>
              <AccessLine stop={station} color={c.muted} />
              {stationTransfers.length > 0 ? (
                <Transfers lines={stationTransfers} muted={c.muted} onPick={onLine} />
              ) : (
                <Text style={[styles.muted, { color: c.muted }]}>No transfers here</Text>
              )}
            </View>
            <Arrivals directions={arrivals} noun={noun} dark={dark} onPick={onArrival} />
          </View>
        )}

        {!line ? (
          <Text style={[styles.muted, { color: c.muted }]}>Loading the line…</Text>
        ) : line.stops.length > 0 ? (
          <View>
            {line.stops.map((s) => {
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
                  <View style={[styles.stopDot, { borderColor: color }]} />
                  <View style={styles.stopText}>
                    <WithAccess stop={s}>
                      <Text style={[styles.stopName, styles.shrink, { color: c.text }]} numberOfLines={1}>
                        {s.name ? tidyStopName(s.name) : s.stopId}
                      </Text>
                    </WithAccess>
                    <Transfers lines={transferLines(s.transfers, routes)} muted={c.muted} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.muted, { color: c.muted }]}>
            The schedule doesn't list this line's stops, but its route and {noun === 'bus' ? 'buses' : 'trains'} are on
            the map.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
