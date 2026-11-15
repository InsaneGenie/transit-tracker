import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ghostSummary, headwayFor, missingTripText, SERVICE_COLORS, spacingSummary, stripMarks } from '../../web/src/ghosts';
import type { LineService, LineVehicle } from './api';
import { palette } from './theme';

/** Shown at first; the rest wait behind "Show all". */
const SHOWN = 3;

/**
 * A bus line's service against its schedule: ghost buses (scheduled trips with no bus) and, for the way the
 * page shows, how bunched up its buses are.
 */
export function ServiceCheck({ service, going, heading, dark }: { service: LineService; going: LineVehicle[]; heading: 1 | -1; dark: boolean }) {
  const c = palette(dark);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const ghosts = ghostSummary(service);
  const spacing = spacingSummary(going, headwayFor(service, heading));
  const missing = service.missing;
  const now = Date.now() / 1000;
  return (
    <View style={[styles.card, { backgroundColor: c.raised }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        disabled={!missing.length}
        accessibilityRole="button"
        accessibilityState={missing.length ? { expanded: open } : undefined}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.dot, { backgroundColor: ghosts.color ?? c.muted }]} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: c.text }]}>{ghosts.text}</Text>
          {missing.length > 0 && (
            <Text style={[styles.note, { color: c.muted }]}>Ghost buses: on the schedule, but no bus is running them</Text>
          )}
        </View>
        {missing.length > 0 && <Text style={[styles.chevron, { color: c.muted }]}>{open ? '▴' : '▾'}</Text>}
      </Pressable>
      {open && missing.length > 0 && (
        <View style={styles.missing}>
          {(all ? missing : missing.slice(0, SHOWN)).map((trip) => {
            const { title, when } = missingTripText(trip, now);
            return (
              <View key={trip.tripId}>
                <Text style={[styles.trip, { color: c.text }]}>{title}</Text>
                <Text style={[styles.note, { color: c.muted }]}>{when}</Text>
              </View>
            );
          })}
          {!all && missing.length > SHOWN && (
            <Pressable onPress={() => setAll(true)} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.trip, { color: c.accent }]}>Show all {missing.length}</Text>
            </Pressable>
          )}
        </View>
      )}
      {spacing && (
        <View style={[styles.row, styles.divided, { borderTopColor: c.border }]}>
          <View style={[styles.dot, { backgroundColor: spacing.color ?? c.muted }]} />
          <View style={styles.text}>
            <Text style={[styles.title, { color: c.text }]}>{spacing.text}</Text>
            <Text style={[styles.note, { color: c.muted }]}>This way, from where the buses are now</Text>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Bunched buses and long gaps marked along the line's strip: a ring around a bunch, a striped track over a
 * gap, each with a label at the right.
 */
export function StripMarks({ going, place, row, trackX, dark }: { going: LineVehicle[]; place: (v: LineVehicle) => number; row: number; trackX: number; dark: boolean }) {
  const c = palette(dark);
  return stripMarks(going, place).map((m) => {
    const top = m.from * row + row / 2;
    const height = (m.to - m.from) * row;
    const color = m.kind === 'bunched' ? SERVICE_COLORS.bunched : SERVICE_COLORS.long;
    return (
      <View key={m.key} pointerEvents="none" style={[styles.mark, { top, height }]}>
        {m.kind === 'bunched' ? (
          <View style={[styles.bunch, { left: trackX - 17, borderColor: color, backgroundColor: `${color}38` }]} />
        ) : (
          <View style={[styles.gapTrack, { left: trackX - 3 }]}>
            {Array.from({ length: Math.max(1, Math.floor(height / 10)) }, (_, i) => (
              <View key={i} style={[styles.dash, { backgroundColor: color, borderBottomColor: c.card }]} />
            ))}
          </View>
        )}
        <Text style={[styles.label, { backgroundColor: color }]}>{m.label}</Text>
      </View>
    );
  });
}

const styles = StyleSheet.create({
  card: { borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: 0.6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 12 },
  chevron: { fontSize: 13 },
  missing: { gap: 8, paddingLeft: 31, paddingRight: 12, paddingBottom: 12 },
  trip: { fontSize: 14 },
  mark: { position: 'absolute', left: 0, right: 0, justifyContent: 'center' },
  bunch: { position: 'absolute', top: -17, bottom: -17, width: 34, borderRadius: 17, borderWidth: 2 },
  gapTrack: { position: 'absolute', top: 0, bottom: 0, width: 6, overflow: 'hidden', borderRadius: 3 },
  dash: { height: 10, borderBottomWidth: 4 },
  label: {
    position: 'absolute',
    right: 0,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 9,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
});
