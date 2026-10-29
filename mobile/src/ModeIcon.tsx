import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import type { Mode } from '../../web/src/api';
import { MODE_SHAPES } from '../../web/src/vehicleIcons';

/** White pictures from web/src/vehicleIcons.ts (rendered by scripts/vehicle-icons.mjs), tinted per line. */
export const GLYPHS: Record<Mode, number> = {
  bus: require('../assets/vehicles/bus.png'),
  subway: require('../assets/vehicles/subway.png'),
  rail: require('../assets/vehicles/rail.png'),
};

interface Props {
  mode: Mode;
  size: number;
  color: string;
  /** The picture's color. */
  ink: string;
  border?: { color: string; width: number };
  /** Drawn hollow, for a mode that's switched off. */
  hollow?: boolean;
}

/**
 * The same icon vehicles have on the site: subway trains are circles, buses rounded squares and
 * commuter trains diamonds, each in the line's color with its own picture.
 */
export function ModeIcon({ mode, size, color, ink, border, hollow }: Props) {
  const shape = MODE_SHAPES[mode];
  const edge = { borderColor: border?.color ?? color, borderWidth: border?.width ?? (hollow ? 1.5 : 0) };
  const fill = { backgroundColor: hollow ? 'transparent' : color };
  let outline: ViewStyle;
  if (shape === 'circle') outline = { width: size, height: size, borderRadius: size / 2 };
  else if (shape === 'square') outline = { width: size * 0.92, height: size * 0.92, borderRadius: size * 0.26 };
  // A square turned on its corner, sized so its points reach the icon's edge.
  else outline = { width: size * 0.72, height: size * 0.72, borderRadius: size * 0.08, transform: [{ rotate: '45deg' }] };
  const glyph = size * (shape === 'diamond' ? 0.56 : 0.6);
  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <View style={[outline, fill, edge]} />
      <Image source={GLYPHS[mode]} style={[styles.glyph, { width: glyph, height: glyph, tintColor: hollow ? color : ink }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  glyph: { position: 'absolute' },
});
