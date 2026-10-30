import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PanResponderGestureState,
} from 'react-native';
import { palette } from './theme';

export type DrawerStop = 'low' | 'peek' | 'full';

interface Props {
  /** How tall the sheet is when pushed all the way down, when it rests over the map, and when pulled up. */
  low: number;
  peek: number;
  full: number;
  stop: DrawerStop;
  onStopChange: (stop: DrawerStop) => void;
  dark: boolean;
  bottomInset: number;
  children: ReactNode;
}

/** The sheet's height when pushed all the way down: its handle and a "My lines" bar, above the home indicator. */
export const DRAWER_LOW = 44;

/**
 * The Lines sheet, resting along the bottom of the map with your lines in view. Pull it up for every line
 * and search, or push it down to a thin bar for more map. Only its top bar takes the drag, so its list
 * still scrolls when pulled up.
 */
export function LinesDrawer({ low, peek, full, stop, onStopChange, dark, bottomInset, children }: Props) {
  const c = palette(dark);
  const heightFor = (s: DrawerStop) => (s === 'full' ? full : s === 'peek' ? peek : low);
  const height = useRef(new Animated.Value(heightFor(stop))).current;
  const live = useRef({ low, peek, full, onStopChange, start: 0 });
  Object.assign(live.current, { low, peek, full, onStopChange });

  // Follows a change from outside (a button, the screen turning, more lines to show).
  useEffect(() => {
    Animated.spring(height, { toValue: heightFor(stop), useNativeDriver: false, bounciness: 0, speed: 18 }).start();
  }, [stop, low, peek, full, height]);

  const settle = (_: unknown, g: PanResponderGestureState) => {
    const { low, peek, full, start, onStopChange } = live.current;
    // Where the sheet was headed: a flick carries it on toward the next stop.
    const aim = start - g.dy - g.vy * 150;
    const stops: [DrawerStop, number][] = [
      ['low', low],
      ['peek', peek],
      ['full', full],
    ];
    const [next, h] = stops.reduce((a, b) => (Math.abs(b[1] - aim) < Math.abs(a[1] - aim) ? b : a));
    Animated.spring(height, { toValue: h, useNativeDriver: false, bounciness: 0, speed: 18 }).start();
    onStopChange(next);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        height.stopAnimation((h) => (live.current.start = h));
      },
      onPanResponderMove: (_, g) => {
        const { low, full, start } = live.current;
        height.setValue(Math.min(full, Math.max(low * 0.85, start - g.dy)));
      },
      onPanResponderRelease: settle,
      onPanResponderTerminate: settle,
    }),
  ).current;

  // Pushed down, the lines fade out and a "My lines" bar takes their place.
  const lowered = height.interpolate({ inputRange: [low, low + 40], outputRange: [1, 0], extrapolate: 'clamp' });
  const shown = height.interpolate({ inputRange: [low + 10, low + 60], outputRange: [0, 1], extrapolate: 'clamp' });
  const tap = () => onStopChange(stop === 'low' ? 'peek' : stop === 'peek' ? 'full' : 'peek');

  return (
    <Animated.View style={[styles.sheet, { height, backgroundColor: c.card, paddingBottom: bottomInset }]}>
      <View {...pan.panHandlers}>
        <View style={styles.grab}>
          <Pressable
            onPress={tap}
            hitSlop={{ top: 10, bottom: 6, left: 60, right: 60 }}
            accessibilityRole="button"
            accessibilityLabel={stop === 'full' ? 'Lower the lines' : 'Show more lines'}
            style={styles.handleTap}
          >
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </Pressable>
        </View>
      </View>
      <Animated.View style={[styles.body, { opacity: shown }]} pointerEvents={stop === 'low' ? 'none' : 'auto'}>
        {children}
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        style={[styles.lowBar, { opacity: lowered }]}
        pointerEvents={stop === 'low' ? 'auto' : 'none'}
      >
        <Pressable
          onPress={() => onStopChange('peek')}
          accessibilityRole="button"
          accessibilityLabel="Show my lines"
          style={styles.lowTap}
        >
          <Text style={[styles.lowText, { color: c.text }]}>My lines</Text>
          <Text style={[styles.lowText, { color: c.muted }]}>⌃</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 12,
  },
  grab: { paddingTop: 8, paddingBottom: 6 },
  handleTap: { alignSelf: 'center' },
  handle: { width: 36, height: 5, borderRadius: 3 },
  body: { flex: 1 },
  lowBar: { position: 'absolute', left: 0, right: 0, top: 14, height: DRAWER_LOW - 14 },
  lowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  lowText: { fontSize: 14, fontWeight: '600' },
});
