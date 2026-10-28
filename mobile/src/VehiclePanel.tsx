import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colorFor, displayName, formatEta, MODE_LABELS, textColorFor, tidyStopName } from '../../web/src/vehicles';
import type { VehicleDetail } from './api';
import { palette } from './theme';

const MAX_STOPS = 12;

interface Props {
  detail: VehicleDetail;
  following: boolean;
  dark: boolean;
  bottomInset: number;
  onFollow: () => void;
  onClose: () => void;
}

/** The tapped vehicle's line, where it is and its next stops, as a sheet along the bottom. */
export function VehiclePanel({ detail, following, dark, bottomInset, onFollow, onClose }: Props) {
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
      <View style={[styles.handle, { backgroundColor: c.border }]} />
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
        <Text style={[styles.muted, { color: c.muted }]}>
          {vehicle.source === 'gps' ? '● Live GPS position' : '○ Estimated from arrival times'}
        </Text>
        <Pressable
          onPress={onFollow}
          accessibilityRole="button"
          accessibilityState={{ selected: following }}
          style={[styles.follow, { borderColor: c.border }, following && { backgroundColor: c.accent, borderColor: c.accent }]}
        >
          <Text style={[styles.followText, { color: following ? '#ffffff' : c.text }]}>
            {following ? 'Following' : 'Follow'}
          </Text>
        </Pressable>
      </View>

      {upcoming.length > 0 ? (
        <ScrollView style={styles.stops}>
          {upcoming.slice(0, MAX_STOPS).map((s, i) => (
            <View key={s.stopId} style={styles.stop}>
              <View style={[styles.stopDot, { borderColor: color }, i === 0 && { backgroundColor: color }]} />
              <Text style={[styles.stopName, { color: c.text }]} numberOfLines={1}>
                {s.name ? tidyStopName(s.name) : s.stopId}
              </Text>
              <Text style={[styles.eta, { color: c.muted }]}>{formatEta(s.time)}</Text>
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={[styles.muted, { color: c.muted }]}>No upcoming stops reported for this vehicle.</Text>
      )}
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
  handle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { minWidth: 40, height: 40, borderRadius: 20, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 16, fontWeight: '800' },
  title: { flex: 1 },
  titleText: { fontSize: 16, fontWeight: '700' },
  muted: { fontSize: 13 },
  close: { fontSize: 18, padding: 4 },
  where: { fontSize: 15, fontWeight: '600', marginTop: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  follow: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  followText: { fontSize: 14, fontWeight: '600' },
  stops: { flexGrow: 0, flexShrink: 1 },
  stop: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10 },
  stopDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  stopName: { flex: 1, fontSize: 14 },
  eta: { fontSize: 14, fontVariant: ['tabular-nums'] },
});
