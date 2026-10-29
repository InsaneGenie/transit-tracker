import { StyleSheet, Text, View } from 'react-native';
import { colorFor, displayName, textColorFor } from '../../web/src/vehicles';
import type { RouteInfo } from './api';
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

export { lineStatus, vehicleCount } from '../../web/src/lines';

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  text: { fontWeight: '800' },
});
