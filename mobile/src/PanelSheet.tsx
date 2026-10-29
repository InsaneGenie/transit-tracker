import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderHandlers,
  type PanResponderGestureState,
} from 'react-native';

/** What a panel needs to be dragged: handlers for its top part, and its handle. */
export interface Sheet {
  grab: GestureResponderHandlers;
  expanded: boolean;
  toggle: () => void;
}

interface Props {
  /** The panel's usual height, and how tall it gets when dragged up. */
  half: number;
  full: number;
  /** The panel's height once it settles, for the map's padding. */
  onHeight: (height: number) => void;
  onClose: () => void;
  children: (sheet: Sheet) => ReactNode;
}

/**
 * A panel along the bottom of the screen that can be dragged up to nearly the whole screen to see more of
 * its list, back down to half, or down further to close it. Only the panel's top part takes the drag, so
 * its list still scrolls. The height follows the finger without redrawing the map underneath.
 */
export function PanelSheet({ half, full, onHeight, onClose, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const maxHeight = useRef(new Animated.Value(half)).current;
  // Slides up into place when it opens, rather than appearing all at once.
  const rise = useRef(new Animated.Value(half)).current;
  useEffect(() => {
    Animated.spring(rise, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 16 }).start();
  }, [rise]);
  const live = useRef({ half, full, expanded, onClose, onHeight, height: 0, start: 0, moving: false });
  Object.assign(live.current, { half, full, expanded, onClose, onHeight });

  // The screen turned, so its halves changed.
  useEffect(() => {
    maxHeight.setValue(live.current.expanded ? full : half);
  }, [half, full, maxHeight]);

  const settleAt = (to: number, then?: () => void) => {
    live.current.moving = true;
    Animated.spring(maxHeight, { toValue: to, useNativeDriver: false, bounciness: 0, speed: 18 }).start(() => {
      live.current.moving = false;
      live.current.onHeight(live.current.height);
      then?.();
    });
  };

  const settle = (_: unknown, g: PanResponderGestureState) => {
    const { half, full, expanded, start, onClose } = live.current;
    const end = start - g.dy;
    const flungUp = g.vy < -0.5;
    const flungDown = g.vy > 0.8 && g.dy > 40;
    if (flungUp || (!flungDown && end > (half + full) / 2)) {
      setExpanded(true);
      settleAt(full);
    } else if (end < Math.min(start, half) * 0.6 || (!expanded && flungDown)) {
      settleAt(0, onClose);
    } else {
      setExpanded(false);
      settleAt(half);
    }
  };

  const pan = useRef(
    PanResponder.create({
      // Take over from a button only once the finger is clearly moving up or down.
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        maxHeight.stopAnimation();
        live.current.moving = true;
        live.current.start = live.current.height;
      },
      onPanResponderMove: (_, g) => {
        maxHeight.setValue(Math.min(live.current.full, Math.max(0, live.current.start - g.dy)));
      },
      onPanResponderRelease: (e, g) => settle(e, g),
      onPanResponderTerminate: (e, g) => settle(e, g),
    }),
  ).current;

  const toggle = () => {
    setExpanded(!expanded);
    settleAt(expanded ? half : full);
  };

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: rise }] }]} pointerEvents="box-none">
      <Animated.View
        style={[styles.sheet, { maxHeight }]}
        onLayout={(e) => {
          live.current.height = e.nativeEvent.layout.height;
          // Moving the map's padding every frame would make the map jump around under the finger.
          if (!live.current.moving) live.current.onHeight(live.current.height);
        }}
        pointerEvents="box-none"
      >
        {children({ grab: pan.panHandlers, expanded, toggle })}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The bar at the top of a panel. Drag it, or tap it to make the panel taller or shorter again. A panel down
 * the side of an iPad isn't dragged, so it has only a little space there instead.
 */
export function SheetHandle({ sheet, color }: { sheet?: Sheet; color: string }) {
  if (!sheet) return <View style={styles.noHandle} />;
  return (
    <Pressable
      onPress={sheet.toggle}
      hitSlop={{ top: 8, bottom: 4, left: 40, right: 40 }}
      accessibilityRole="button"
      accessibilityLabel={sheet.expanded ? 'Make the panel smaller' : 'Make the panel taller'}
      style={styles.handleTap}
    >
      <View style={[styles.handle, { backgroundColor: color }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: { justifyContent: 'flex-end' },
  handleTap: { alignSelf: 'center', paddingBottom: 10 },
  handle: { width: 36, height: 5, borderRadius: 3 },
  noHandle: { height: 8 },
});
