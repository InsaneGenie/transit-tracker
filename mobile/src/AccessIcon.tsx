import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ACCESS_BLUE, accessLabel } from '../../web/src/accessibility';
import type { UpcomingStop } from './api';

/** The white wheelchair from web/src/accessibility.ts, rendered by scripts/vehicle-icons.mjs. */
const WHEELCHAIR = require('../assets/vehicles/wheelchair.png');

type Access = Pick<UpcomingStop, 'access' | 'accessNote'>;

/** The wheelchair symbol on a blue square, beside an accessible station's name. Nothing for other stations. */
export function AccessIcon({ stop, size = 14, border, onLoad }: { stop: Access; size?: number; border?: string; onLoad?: () => void }) {
  const label = accessLabel(stop);
  if (!label) return null;
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size * 0.22 },
        border !== undefined && { borderColor: border, borderWidth: 1.5 },
      ]}
      accessible
      accessibilityLabel={label}
    >
      <Image source={WHEELCHAIR} style={{ width: size * 0.72, height: size * 0.72 }} onLoad={onLoad} />
    </View>
  );
}

/** The symbol with what it means, for a picked station's card. */
export function AccessLine({ stop, color }: { stop: Access; color: string }) {
  const label = accessLabel(stop);
  if (!label) return null;
  return (
    <View style={styles.line}>
      <AccessIcon stop={stop} />
      <Text style={[styles.lineText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: ACCESS_BLUE, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineText: { fontSize: 13, flexShrink: 1 },
  // The name gives way so the symbol always shows.
  named: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
});

/** A station's name with the wheelchair symbol after it, when it has one. */
export function WithAccess({ stop, children }: { stop: Access; children: ReactNode }) {
  if (!stop.access) return <>{children}</>;
  return (
    <View style={styles.named}>
      {children}
      <AccessIcon stop={stop} />
    </View>
  );
}
