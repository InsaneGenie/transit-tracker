import { StyleSheet, Text, View } from 'react-native';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../../web/src/alerts';
import { colorFor, displayName, textColorFor } from '../../web/src/vehicles';
import type { AlertSeverity, RouteInfo } from './api';
import { ModeIcon } from './ModeIcon';

/** A line's badge: the subway's round bullet, a bus route's rounded square, a commuter line's diamond. */
export function LineBadge({ route, size = 34 }: { route: Pick<RouteInfo, 'mode' | 'name' | 'color'>; size?: number }) {
  const color = colorFor({ routeColor: route.color, mode: route.mode });
  if (route.mode === 'rail') return <ModeIcon mode="rail" size={size} color={color} ink="#ffffff" />;
  const name = displayName(route.name);
  return (
    <View
      style={[
        styles.badge,
        { minWidth: size, height: size, backgroundColor: color, borderRadius: route.mode === 'bus' ? size * 0.26 : size / 2 },
      ]}
    >
      <Text
        style={[styles.text, { color: textColorFor(color), fontSize: size * (name.length > 3 ? 0.34 : 0.42) }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}

/** "14 trains", "1 bus". */
export function vehicleCount(n: number, mode: RouteInfo['mode']): string {
  const noun = mode === 'bus' ? (n === 1 ? 'bus' : 'buses') : n === 1 ? 'train' : 'trains';
  return `${n} ${noun}`;
}

/**
 * How a line is running, from its worst alert and how many vehicles are out: "Delays", "Good service",
 * or "Not running now". `count` is undefined until the counts load.
 */
export function lineStatus(alert: AlertSeverity | undefined, count: number | undefined): { text: string; color?: string } {
  if (alert && alert !== 'info') return { text: SEVERITY_LABELS[alert], color: SEVERITY_COLORS[alert] };
  if (count === 0) return { text: 'Not running now' };
  return { text: 'Good service', color: '#16a34a' };
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  text: { fontWeight: '800' },
});
