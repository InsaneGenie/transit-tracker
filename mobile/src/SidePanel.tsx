import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { palette } from './theme';

interface Props {
  width: number;
  top: number;
  bottom: number;
  /** Takes the whole height (the Lines list), rather than only as tall as what it shows. */
  fill?: boolean;
  dark: boolean;
  children: ReactNode;
}

/**
 * A card down the left side of the map on an iPad or another wide screen, like the site's panels on a
 * computer, in place of the sheets along the bottom on a phone.
 */
export function SidePanel({ width, top, bottom, fill, dark, children }: Props) {
  const c = palette(dark);
  const grow = fill ? styles.fill : styles.shrink;
  return (
    <View style={[styles.wrap, { width, top, bottom }]} pointerEvents="box-none">
      {/* The shadow sits outside the clipped part, since iOS draws no shadow on a view that clips. */}
      <View style={[styles.card, grow, { backgroundColor: c.card }]}>
        <View style={[styles.clip, grow]}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12 },
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  card: {
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 12,
  },
  clip: { borderRadius: 18, overflow: 'hidden' },
});
