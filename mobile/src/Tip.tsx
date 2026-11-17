import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { parseSeen, serializeSeen, TIPS_SEEN_KEY, tipText, type TipId } from '../../web/src/tips';
import { palette } from './theme';

// Tips stay hidden until storage has answered, so one never flashes up for someone who dismissed it.
let seen: Set<TipId> | null = null;
let loading = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function load() {
  if (seen || loading) return;
  loading = true;
  AsyncStorage.getItem(TIPS_SEEN_KEY)
    .then((raw) => (seen = parseSeen(raw)))
    .catch(() => (seen = new Set()))
    .finally(notify);
}

function save() {
  AsyncStorage.setItem(TIPS_SEEN_KEY, serializeSeen(seen ?? new Set())).catch(() => {});
}

function dismiss(id: TipId) {
  seen = new Set(seen ?? []).add(id);
  save();
  notify();
}

/** Brings every tip back, from the guide's "Show tips again". */
export function resetTips() {
  seen = new Set();
  save();
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether tip `id` is still up, so the button it's about can pulse. */
export function useTipOpen(id: TipId): boolean {
  useEffect(load, []);
  return !useSyncExternalStore(subscribe, () => !seen || seen.has(id));
}

/**
 * A ring that glows on the edge of the button a tip is about, until the tip is dismissed. Put it
 * inside the button, last; `radius` matches the button's corners. It stays on the button's own
 * edge so a scroll view can't cut it off.
 */
export function CoachRing({ id, radius }: { id: TipId; radius: number }) {
  const open = useTipOpen(id);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) return;
    // One pulse every 1.8 s, each starting from nothing.
    const pulseOnce = () => {
      pulse.setValue(0);
      Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: Platform.OS !== 'web' }).start();
    };
    pulseOnce();
    let timer: ReturnType<typeof setInterval> | undefined = setInterval(pulseOnce, 1800);
    // With Reduce Motion on, the ring stays still instead.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((still) => {
        if (!still || !timer) return;
        clearInterval(timer);
        timer = undefined;
        pulse.stopAnimation();
        pulse.setValue(0.3);
      })
      .catch(() => {});
    return () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      pulse.stopAnimation();
    };
  }, [open, pulse]);
  if (!open) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          borderRadius: radius,
          opacity: pulse.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] }),
        },
      ]}
    />
  );
}

/** A one-time tip shown where a feature lives, until it's dismissed. */
export function Tip({ id, noun, dark }: { id: TipId; noun?: string; dark: boolean }) {
  if (!useTipOpen(id)) return null;
  const c = palette(dark);
  return (
    <View
      accessibilityRole="text"
      style={[styles.tip, { backgroundColor: dark ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.08)', borderColor: dark ? 'rgba(96,165,250,0.35)' : 'rgba(37,99,235,0.25)' }]}
    >
      <Text style={styles.icon}>💡</Text>
      <Text style={[styles.text, { color: c.text }]}>{tipText(id, { noun, touch: true })}</Text>
      <Pressable onPress={() => dismiss(id)} hitSlop={10} accessibilityRole="button">
        <Text style={[styles.ok, { color: dark ? '#60a5fa' : c.accent }]}>Got it</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  icon: { fontSize: 14, lineHeight: 20 },
  text: { flex: 1, fontSize: 14, lineHeight: 20 },
  ring: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderWidth: 2.5, borderColor: '#2563eb' },
  ok: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
