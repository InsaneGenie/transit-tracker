import { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Switch, Text, View, type PanResponderInstance } from 'react-native';
import { MODE_LABELS } from '../../web/src/vehicles';
import type { AlertSeverity, RouteInfo } from './api';
import { LineBadge, lineStatus, vehicleCount } from './LineBadge';
import type { palette } from './theme';

/** How long a finger holds a badge before it can be dragged, and how far it may wander before then. */
const HOLD_MS = 250;
const SLOP = 8;

type Rect = { x: number; y: number; w: number; h: number };

interface Props {
  /** Your lines, in your order. */
  lines: RouteInfo[];
  hiddenRoutes: string[];
  alertSummary: Record<string, AlertSeverity>;
  counts: Record<string, number> | null;
  c: ReturnType<typeof palette>;
  /** Puts your lines in this order. */
  onReorder: (keys: string[]) => void;
  onToggleRoute: (key: string) => void;
  onRemove: (key: string) => void;
  onOpen: (key: string) => void;
  /** Called with true while a badge is being dragged, so the list can stop scrolling. */
  onDragging: (dragging: boolean) => void;
}

/**
 * Your lines as rows of badges, like a station sign. A faded badge has its route switched off. Tap one
 * for a card with its details and route switch; press and hold one to drag it to a new place.
 */
export function MyLineBadges({ lines, hiddenRoutes, alertSummary, counts, c, onReorder, onToggleRoute, onRemove, onOpen, onDragging }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const offset = useRef(new Animated.ValueXY()).current;
  // Where each badge sits in the rows, from its last layout.
  const rects = useRef(new Map<string, Rect>());
  const latest = useRef({ lines, onReorder, onDragging });
  latest.current = { lines, onReorder, onDragging };
  const responders = useRef(new Map<string, PanResponderInstance>());

  const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  const responder = (key: string) => {
    const existing = responders.current.get(key);
    if (existing) return existing;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dragging = false;
    let moved = false;
    let start = { x: 0, y: 0 };
    const finish = () => {
      clearTimeout(timer);
      if (!dragging) return;
      dragging = false;
      latest.current.onDragging(false);
      Animated.spring(offset, { toValue: { x: 0, y: 0 }, useNativeDriver: true, speed: 30 }).start(() => setDragKey((k) => (k === key ? null : k)));
    };
    const created = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Until the hold ends the list may take the touch to scroll; once dragging, the badge keeps it.
      onPanResponderTerminationRequest: () => !dragging,
      onShouldBlockNativeResponder: () => false,
      onPanResponderGrant: () => {
        moved = false;
        const rect = rects.current.get(key);
        start = rect ? center(rect) : { x: 0, y: 0 };
        offset.setValue({ x: 0, y: 0 });
        timer = setTimeout(() => {
          dragging = true;
          setDragKey(key);
          latest.current.onDragging(true);
        }, HOLD_MS);
      },
      onPanResponderMove: (_, g) => {
        if (!dragging) {
          if (Math.hypot(g.dx, g.dy) > SLOP) {
            moved = true;
            clearTimeout(timer);
          }
          return;
        }
        const at = { x: start.x + g.dx, y: start.y + g.dy };
        const keys = latest.current.lines.map((r) => r.key);
        const over = keys.find((k) => {
          const r = rects.current.get(k);
          return r && at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h;
        });
        if (over && over !== key) {
          const order = keys.filter((k) => k !== key);
          order.splice(keys.indexOf(over), 0, key);
          latest.current.onReorder(order);
        }
        // Keep the badge under the finger, wherever its own place in the rows now is.
        const slot = rects.current.get(key);
        const home = slot ? center(slot) : start;
        offset.setValue({ x: at.x - home.x, y: at.y - home.y });
      },
      onPanResponderRelease: () => {
        const tapped = !dragging && !moved;
        finish();
        if (tapped) setPicked((p) => (p === key ? null : key));
      },
      onPanResponderTerminate: finish,
    });
    responders.current.set(key, created);
    return created;
  };

  const shown = lines.find((r) => r.key === picked);

  return (
    <View>
      <View style={styles.badges}>
        {lines.map((r) => {
          const s = lineStatus(alertSummary[r.key], counts ? (counts[r.key] ?? 0) : undefined);
          const hidden = hiddenRoutes.includes(r.key);
          const dragged = dragKey === r.key;
          return (
            <Animated.View
              key={r.key}
              {...responder(r.key).panHandlers}
              onLayout={(e) => {
                const { x, y, width, height } = e.nativeEvent.layout;
                rects.current.set(r.key, { x, y, w: width, h: height });
              }}
              accessible
              accessibilityRole="button"
              accessibilityState={{ expanded: picked === r.key }}
              accessibilityLabel={`${r.name}: ${s.text}${hidden ? ', route hidden' : ''}`}
              accessibilityHint="Shows its details. Press and hold to move it."
              style={[
                styles.badge,
                picked === r.key && { borderColor: c.accent },
                dragged && [styles.dragged, { transform: [...offset.getTranslateTransform(), { scale: 1.15 }] }],
              ]}
            >
              <View style={hidden && styles.faded}>
                <LineBadge route={r} size={38} />
              </View>
              {s.color && <View style={[styles.dot, { backgroundColor: s.color, borderColor: c.card }]} />}
            </Animated.View>
          );
        })}
      </View>
      {shown && (
        <Details
          r={shown}
          drawn={!hiddenRoutes.includes(shown.key)}
          alert={alertSummary[shown.key]}
          counts={counts}
          c={c}
          onToggleRoute={() => onToggleRoute(shown.key)}
          onOpen={() => onOpen(shown.key)}
          onRemove={() => {
            setPicked(null);
            onRemove(shown.key);
          }}
        />
      )}
    </View>
  );
}

/** The picked line's name, how it's running, and what you can do with it. */
function Details({
  r,
  drawn,
  alert,
  counts,
  c,
  onToggleRoute,
  onOpen,
  onRemove,
}: {
  r: RouteInfo;
  drawn: boolean;
  alert: AlertSeverity | undefined;
  counts: Record<string, number> | null;
  c: ReturnType<typeof palette>;
  onToggleRoute: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const count = counts?.[r.key];
  const s = lineStatus(alert, counts ? (count ?? 0) : undefined);
  return (
    <View style={[styles.card, { backgroundColor: c.raised }]}>
      <View style={styles.cardHead}>
        <View style={styles.cardText}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {r.mode === 'rail' ? r.name : (r.longName ?? `${MODE_LABELS[r.mode]} ${r.name}`)}
          </Text>
          <Text style={[styles.meta, { color: c.muted }]} numberOfLines={1}>
            <Text style={{ color: s.color ?? c.muted }}>{s.text}</Text>
            {count ? ` · ${vehicleCount(count, r.mode)} running` : ''}
          </Text>
        </View>
        <View style={styles.routeToggle}>
          <Text style={[styles.routeLabel, { color: c.muted }]}>Route</Text>
          <Switch
            value={drawn}
            onValueChange={onToggleRoute}
            accessibilityLabel={`Show the ${r.name} route and vehicles on the map`}
            style={styles.switch}
          />
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, { backgroundColor: c.accent }, pressed && styles.pressed]}
        >
          <Text style={[styles.buttonText, { color: '#ffffff' }]}>Open line</Text>
        </Pressable>
        <Pressable onPress={onRemove} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={[styles.buttonText, { color: c.text }]}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { padding: 3, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  dragged: { zIndex: 10, elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  faded: { opacity: 0.35 },
  dot: { position: 'absolute', top: 1, right: 1, width: 13, height: 13, borderRadius: 7, borderWidth: 2 },
  card: { marginTop: 10, padding: 12, borderRadius: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardText: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, marginTop: 2 },
  routeToggle: { alignItems: 'center', gap: 2 },
  routeLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  switch: { transform: [{ scale: 0.8 }] },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  button: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
