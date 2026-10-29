import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from './theme';

export type Tab = 'map' | 'lines';

/** The bar's height above the home indicator. */
export const TAB_BAR_HEIGHT = 52;

/** A folded map. */
function MapIcon({ color }: { color: string }) {
  return (
    <View style={styles.mapIcon}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.mapPanel, { borderColor: color, transform: [{ skewY: i === 1 ? '12deg' : '-12deg' }] }]} />
      ))}
    </View>
  );
}

/** A list of lines, each with its bullet. */
function LinesIcon({ color }: { color: string }) {
  return (
    <View style={styles.linesIcon}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.linesRow}>
          <View style={[styles.linesDot, { backgroundColor: color }]} />
          <View style={[styles.linesBar, { backgroundColor: color }]} />
        </View>
      ))}
    </View>
  );
}

/** Map and Lines along the bottom of the screen. A dot on Lines means one of your lines has trouble. */
export function TabBar({
  tab,
  alertColor,
  dark,
  bottomInset,
  onTab,
}: {
  tab: Tab;
  alertColor?: string;
  dark: boolean;
  bottomInset: number;
  onTab: (tab: Tab) => void;
}) {
  const c = palette(dark);
  const item = (t: Tab, label: string, icon: (color: string) => ReactNode) => {
    const color = t === tab ? c.accent : c.muted;
    return (
      <Pressable
        key={t}
        onPress={() => onTab(t)}
        accessibilityRole="tab"
        accessibilityState={{ selected: t === tab }}
        accessibilityLabel={t === 'lines' && alertColor ? `${label}, service alerts on your lines` : label}
        style={styles.item}
      >
        <View>
          {icon(color)}
          {t === 'lines' && alertColor && <View style={[styles.alert, { backgroundColor: alertColor, borderColor: c.card }]} />}
        </View>
        <Text style={[styles.label, { color }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View
      style={[styles.bar, { backgroundColor: c.card, borderColor: c.border, height: TAB_BAR_HEIGHT + bottomInset, paddingBottom: bottomInset }]}
      accessibilityRole="tablist"
    >
      {item('map', 'Map', (color) => <MapIcon color={color} />)}
      {item('lines', 'Lines', (color) => <LinesIcon color={color} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 11, fontWeight: '600' },
  mapIcon: { flexDirection: 'row', width: 24, height: 22, alignItems: 'center' },
  mapPanel: { width: 8, height: 18, borderWidth: 1.75, marginHorizontal: -0.9 },
  linesIcon: { width: 24, height: 22, justifyContent: 'space-between', paddingVertical: 2 },
  linesRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  linesDot: { width: 5, height: 5, borderRadius: 2.5 },
  linesBar: { flex: 1, height: 2.5, borderRadius: 1.25 },
  alert: { position: 'absolute', top: -3, right: -6, width: 11, height: 11, borderRadius: 5.5, borderWidth: 2 },
});
