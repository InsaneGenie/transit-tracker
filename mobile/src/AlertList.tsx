import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { alertLineKey, alertParts, alertTitle, alertWhen, SEVERITY_COLORS } from '../../web/src/alerts';
import { colorFor, textColorFor } from '../../web/src/vehicles';
import type { RouteInfo, ServiceAlert } from './api';
import { palette } from './theme';

/** Collapsed, only this many show, so the stops stay in reach. */
const SHOWN = 2;

/** Alert text with each `[A]` drawn in the line's color. */
function AlertText({ text, routes }: { text: string; routes: Map<string, RouteInfo> }) {
  return alertParts(text).map((p, i) => {
    if ('text' in p) return p.text;
    if ('icon' in p) return p.icon;
    const route = routes.get(alertLineKey(p.line));
    const color = route ? colorFor({ routeColor: route.color, mode: route.mode }) : '#64748b';
    return (
      <Text key={i} style={[styles.line, { backgroundColor: color, color: textColorFor(color) }]}>
        {` ${p.line} `}
      </Text>
    );
  });
}

function AlertItem({ alert, routes, dark }: { alert: ServiceAlert; routes: Map<string, RouteInfo>; dark: boolean }) {
  const c = palette(dark);
  const [open, setOpen] = useState(false);
  const severity = SEVERITY_COLORS[alert.severity];
  const paragraphs = alert.description?.split(/\n{2,}/).filter((p) => p.trim()) ?? [];
  return (
    <Pressable
      onPress={() => setOpen((o) => !o)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [
        styles.alert,
        { borderLeftColor: severity, backgroundColor: `${severity}${dark ? '24' : '14'}` },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.kind}>
        <View style={[styles.dot, { backgroundColor: severity }]} />
        <Text style={[styles.title, { color: severity }]}>{alertTitle(alert)}</Text>
        <Text style={[styles.when, { color: c.muted }]} numberOfLines={1}>
          · {alertWhen(alert)}
        </Text>
        <Text style={[styles.chevron, { color: c.muted }]}>{open ? '▴' : '▾'}</Text>
      </View>
      <Text style={[styles.text, { color: c.text }]} numberOfLines={open ? undefined : 2}>
        <AlertText text={alert.header} routes={routes} />
      </Text>
      {open && alert.when && <Text style={[styles.text, styles.period, { color: c.muted }]}>{alert.when}</Text>}
      {open &&
        paragraphs.map((p, i) => (
          <Text key={i} style={[styles.text, styles.paragraph, { color: c.text }]}>
            <AlertText text={p} routes={routes} />
          </Text>
        ))}
    </Pressable>
  );
}

/** Delays, suspensions and planned changes on a line, from the MTA. Tap one for the details. */
export function AlertList({
  alerts,
  routes,
  dark,
  empty,
}: {
  alerts: ServiceAlert[] | null;
  routes: Map<string, RouteInfo>;
  dark: boolean;
  empty?: string;
}) {
  const c = palette(dark);
  const [all, setAll] = useState(false);
  if (!alerts?.length) {
    return empty && alerts ? <Text style={[styles.empty, { color: c.muted }]}>{empty}</Text> : null;
  }
  const shown = all ? alerts : alerts.slice(0, SHOWN);
  return (
    <View style={styles.list} accessibilityLabel="Service alerts">
      {shown.map((a) => (
        <AlertItem key={a.id} alert={a} routes={routes} dark={dark} />
      ))}
      {alerts.length > SHOWN && (
        <Pressable onPress={() => setAll((x) => !x)} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.more, { color: c.accent }]}>
            {all ? 'Show fewer' : `${alerts.length - SHOWN} more alert${alerts.length - SHOWN > 1 ? 's' : ''}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6, marginBottom: 10 },
  alert: { borderLeftWidth: 3, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, gap: 3 },
  pressed: { opacity: 0.6 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 13, fontWeight: '700' },
  when: { flex: 1, fontSize: 13 },
  chevron: { fontSize: 13 },
  text: { fontSize: 14, lineHeight: 20 },
  line: { fontSize: 12, fontWeight: '800' },
  period: { fontWeight: '600', marginTop: 4 },
  paragraph: { marginTop: 6 },
  more: { fontSize: 14, fontWeight: '600', paddingVertical: 2 },
  empty: { fontSize: 13, marginBottom: 10 },
});
