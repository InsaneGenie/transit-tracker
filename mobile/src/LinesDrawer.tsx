import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View, type PanResponderGestureState } from 'react-native';
import { palette } from './theme';

interface Props {
  /** How tall the sheet rests over the map, and how tall it gets when pulled up. */
  peek: number;
  full: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  dark: boolean;
  bottomInset: number;
  children: ReactNode;
}

/**
 * The Lines sheet, resting along the bottom of the map with your lines in view. Pull it up for every line
 * and search, or push it back down to see the map. Only its top bar takes the drag, so its list still
 * scrolls when pulled up.
 */
export function LinesDrawer({ peek, full, expanded, onExpandedChange, dark, bottomInset, children }: Props) {
  const c = palette(dark);
  const height = useRef(new Animated.Value(expanded ? full : peek)).current;
  const live = useRef({ peek, full, expanded, onExpandedChange, start: 0 });
  Object.assign(live.current, { peek, full, expanded, onExpandedChange });

  // Follows a change from outside (a button, the screen turning, more lines to show).
  useEffect(() => {
    Animated.spring(height, { toValue: expanded ? full : peek, useNativeDriver: false, bounciness: 0, speed: 18 }).start();
  }, [expanded, peek, full, height]);

  const settle = (_: unknown, g: PanResponderGestureState) => {
    const { peek, full, start, onExpandedChange } = live.current;
    const end = start - g.dy;
    const up = g.vy < -0.5 || (g.vy <= 0.8 && end > (peek + full) / 2);
    Animated.spring(height, { toValue: up ? full : peek, useNativeDriver: false, bounciness: 0, speed: 18 }).start();
    onExpandedChange(up);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        height.stopAnimation((h) => (live.current.start = h));
      },
      onPanResponderMove: (_, g) => {
        const { peek, full, start } = live.current;
        height.setValue(Math.min(full, Math.max(peek * 0.6, start - g.dy)));
      },
      onPanResponderRelease: settle,
      onPanResponderTerminate: settle,
    }),
  ).current;

  return (
    <Animated.View style={[styles.sheet, { height, backgroundColor: c.card, paddingBottom: bottomInset }]}>
      <View {...pan.panHandlers} style={styles.grab}>
        <Pressable
          onPress={() => onExpandedChange(!expanded)}
          hitSlop={{ top: 10, bottom: 6, left: 60, right: 60 }}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Lower the lines' : 'Show all lines'}
          style={styles.handleTap}
        >
          <View style={[styles.handle, { backgroundColor: c.border }]} />
        </Pressable>
      </View>
      <View style={styles.body}>{children}</View>
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
});
