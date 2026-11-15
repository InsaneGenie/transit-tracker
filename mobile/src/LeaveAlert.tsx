import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { alertStatus, sameDirection, WALK_CHOICES, watchLabel, type LeaveControls } from '../../web/src/leaveAlert';
import { tidyStopName } from '../../web/src/vehicles';
import { palette } from './theme';
import type { LeaveAlert } from './useLeaveAlert';

const GO = '#15803d';

/** A direction's heading in a station's arrivals, with its bell, and the walk times once the bell is tapped. */
export function DirectionHeading({
  heading,
  destinations,
  leave,
  dark,
}: {
  heading: ReactNode;
  destinations: string[];
  leave?: LeaveControls;
  dark: boolean;
}) {
  const c = palette(dark);
  const [asking, setAsking] = useState(false);
  const on = leave?.watching != null && sameDirection(destinations, leave.watching);
  return (
    <View>
      <View style={styles.top}>
        <View style={styles.shrink}>{heading}</View>
        {leave && !on && !asking && (
          <Pressable
            onPress={() => setAsking(true)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Tell me when to leave for one of these"
            style={({ pressed }) => [styles.bell, { borderColor: c.border, backgroundColor: c.card }, pressed && styles.pressed]}
          >
            <Text style={[styles.bellText, { color: c.text }]}>🔔 Alert me</Text>
          </Pressable>
        )}
      </View>
      {leave && on && (
        <View style={[styles.box, styles.onBox, { backgroundColor: c.card, borderLeftColor: c.accent }]} accessibilityLiveRegion="polite">
          <Text style={[styles.onText, { color: dark ? '#93c5fd' : c.accent }]}>🔔 {leave.status ?? 'Alert on'}</Text>
          <Pressable onPress={leave.onStop} hitSlop={8} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
            <Text style={[styles.link, { color: c.muted }]}>Stop alert</Text>
          </Pressable>
        </View>
      )}
      {leave && !on && asking && (
        <View style={[styles.box, { backgroundColor: c.card }]} accessibilityLabel="Your walk to the station">
          <Text style={[styles.ask, { color: c.muted }]}>How long is your walk here? You'll be told when to leave.</Text>
          <View style={styles.choices}>
            {WALK_CHOICES.map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  setAsking(false);
                  leave.onStart(destinations, m);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${m} minute walk`}
                style={({ pressed }) => [
                  styles.choice,
                  { backgroundColor: c.raised, borderColor: m === leave.walk ? c.accent : c.border },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.choiceText, { color: c.text }]}>{m} min</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setAsking(false)} hitSlop={6} accessibilityRole="button" style={styles.cancel}>
              <Text style={[styles.link, { color: c.muted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

/** The alert that is on, over the map: its countdown; tapping it opens the station. */
export function LeaveBanner({
  alert,
  dark,
  style,
  onOpen,
}: {
  alert: LeaveAlert;
  dark: boolean;
  style?: StyleProp<ViewStyle>;
  onOpen: () => void;
}) {
  const c = palette(dark);
  const { watch, plan, now, notifyState } = alert;
  if (!watch) return null;
  const go = plan?.kind === 'leave';
  const station = watch.station.name ? tidyStopName(watch.station.name) : 'your stop';
  const text = go ? '#ffffff' : c.text;
  const sub = go ? '#ffffff' : c.muted;
  return (
    <View
      style={[styles.banner, { backgroundColor: go ? GO : c.chip, borderColor: go ? GO : c.accent }, style]}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityHint="Shows this station"
        style={({ pressed }) => [styles.bannerMain, pressed && styles.pressed]}
      >
        <Text style={styles.bannerIcon}>{go ? '🏃' : '🔔'}</Text>
        <View style={styles.shrink}>
          <Text style={[styles.bannerTitle, { color: text }]} numberOfLines={1}>
            {alertStatus(watch, plan, now)}
          </Text>
          <Text style={[styles.bannerSub, { color: sub }]} numberOfLines={2}>
            {watchLabel(watch)} at {station} · {watch.walkMinutes} min walk
            {notifyState === 'denied' ? ' · Notifications are off in Settings, so keep the app open' : ''}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={alert.stop} hitSlop={8} accessibilityRole="button" accessibilityLabel="Stop alert" style={styles.bannerClose}>
        <Text style={[styles.bannerCloseText, { color: sub }]}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  shrink: { flexShrink: 1, flexGrow: 1 },
  pressed: { opacity: 0.5 },
  bell: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  bellText: { fontSize: 12, fontWeight: '600' },
  box: { borderRadius: 10, padding: 10, marginTop: 2, marginBottom: 6, gap: 8 },
  onBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderLeftWidth: 3 },
  onText: { flexShrink: 1, fontSize: 13, fontWeight: '700' },
  link: { fontSize: 13, fontWeight: '600' },
  ask: { fontSize: 13 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  choice: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, minWidth: 56, alignItems: 'center' },
  choiceText: { fontSize: 13, fontWeight: '600' },
  cancel: { paddingHorizontal: 6, paddingVertical: 7 },
  banner: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 16,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  bannerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  bannerIcon: { fontSize: 20 },
  bannerTitle: { fontSize: 15, fontWeight: '700' },
  bannerSub: { fontSize: 12 },
  bannerClose: { padding: 8 },
  bannerCloseText: { fontSize: 16, fontWeight: '600' },
});
