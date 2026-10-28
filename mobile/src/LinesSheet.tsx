import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colorFor, legendGroups, MODE_LABELS, textColorFor } from '../../web/src/vehicles';
import type { Mode, RouteInfo } from './api';
import { palette } from './theme';

const MAX_BUSES = 60;

interface Props {
  visible: boolean;
  routes: RouteInfo[];
  modes: Mode[];
  /** Line keys shown; empty means every line. */
  chosen: string[];
  dark: boolean;
  onChange: (chosen: string[]) => void;
  onClose: () => void;
}

function LineButton({ route, on, dark, onToggle }: { route: RouteInfo; on: boolean; dark: boolean; onToggle: () => void }) {
  const c = palette(dark);
  const color = colorFor({ routeColor: route.color, mode: route.mode });
  const rail = route.mode === 'rail';
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={route.longName ?? route.name}
      style={[styles.line, rail && styles.railLine, !on && styles.off]}
    >
      <View style={[styles.lineBadge, { backgroundColor: color }, rail && styles.railBadge]}>
        {!rail && <Text style={[styles.lineBadgeText, { color: textColorFor(color) }]}>{route.name}</Text>}
      </View>
      {rail && <Text style={[styles.railName, { color: c.text }]}>{route.name}</Text>}
    </Pressable>
  );
}

/** What each dot color means, and a way to show only some lines. */
export function LinesSheet({ visible, routes, modes, chosen, dark, onChange, onClose }: Props) {
  const c = palette(dark);
  const [busSearch, setBusSearch] = useState('');
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const isOn = (r: RouteInfo) => chosenSet.size === 0 || chosenSet.has(r.key);
  const toggle = (r: RouteInfo) =>
    onChange(chosenSet.has(r.key) ? chosen.filter((k) => k !== r.key) : [...chosen, r.key]);

  const buses = useMemo(() => {
    const q = busSearch.trim().toLowerCase();
    const all = legendGroups(routes, 'bus')[0]?.routes ?? [];
    const matches = q
      ? all.filter((r) => r.name.toLowerCase().startsWith(q) || r.longName?.toLowerCase().includes(q))
      : all.filter((r) => chosenSet.has(r.key));
    return matches.slice(0, MAX_BUSES);
  }, [routes, busSearch, chosenSet]);

  const heading = (text: string) => <Text style={[styles.h3, { color: c.muted }]}>{text}</Text>;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: c.card }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>Lines</Text>
          {chosen.length > 0 && (
            <Pressable onPress={() => onChange([])} hitSlop={8}>
              <Text style={[styles.link, { color: c.accent }]}>Show all</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.done, { color: c.accent }]}>Done</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: c.muted }]}>
          {chosen.length
            ? `Showing ${chosen.length} chosen line${chosen.length > 1 ? 's' : ''}.`
            : 'Tap lines to show only those.'}
        </Text>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {routes.length === 0 && <Text style={{ color: c.muted }}>The list of lines loads once the server answers.</Text>}

          {modes.includes('subway') && legendGroups(routes, 'subway').length > 0 && (
            <View>
              {heading(MODE_LABELS.subway)}
              {legendGroups(routes, 'subway').map((g) => (
                <View style={styles.row} key={g.color ?? g.routes[0].key}>
                  {g.routes.map((r) => (
                    <LineButton key={r.key} route={r} on={isOn(r)} dark={dark} onToggle={() => toggle(r)} />
                  ))}
                </View>
              ))}
            </View>
          )}

          {modes.includes('rail') &&
            legendGroups(routes, 'rail').map((g) => (
              <View key={g.title}>
                {heading(g.title)}
                {g.routes.map((r) => (
                  <LineButton key={r.key} route={r} on={isOn(r)} dark={dark} onToggle={() => toggle(r)} />
                ))}
              </View>
            ))}

          {modes.includes('bus') && (
            <View>
              {heading(MODE_LABELS.bus)}
              <TextInput
                style={[styles.search, { color: c.text, borderColor: c.border }]}
                placeholder="Find a bus route, e.g. M15"
                placeholderTextColor={c.muted}
                value={busSearch}
                onChangeText={setBusSearch}
                autoCapitalize="characters"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              <View style={styles.row}>
                {buses.map((r) => (
                  <LineButton key={r.key} route={r} on={isOn(r)} dark={dark} onToggle={() => toggle(r)} />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  title: { flex: 1, fontSize: 22, fontWeight: '700' },
  link: { fontSize: 16 },
  done: { fontSize: 17, fontWeight: '600' },
  hint: { paddingHorizontal: 20, marginTop: 4, fontSize: 14 },
  body: { padding: 20, paddingBottom: 60, gap: 18 },
  h3: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  line: { borderRadius: 20 },
  railLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  off: { opacity: 0.3 },
  lineBadge: { minWidth: 36, height: 36, borderRadius: 18, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  railBadge: { minWidth: 14, width: 14, height: 14, borderRadius: 7, paddingHorizontal: 0 },
  lineBadgeText: { fontSize: 14, fontWeight: '800' },
  railName: { fontSize: 15 },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginBottom: 10 },
});
