import { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { colorFor, legendGroups, MODE_LABELS, textColorFor } from '../../web/src/vehicles';
import type { RouteInfo } from './api';
import { palette } from './theme';

interface Props {
  visible: boolean;
  routes: RouteInfo[];
  /** The lines picked so far. */
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

/** Asked on the first launch: which lines they ride. Their picks become their lines in the Lines tab. */
export function LinesSheet({ visible, routes, chosen, dark, onChange, onClose }: Props) {
  const c = palette(dark);
  const [busSearch, setBusSearch] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  // While searching, only the matching bus routes are listed, right under the search box.
  const searching = busSearch.trim().length > 0;
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const toggle = (r: RouteInfo) =>
    onChange(chosenSet.has(r.key) ? chosen.filter((k) => k !== r.key) : [...chosen, r.key]);

  // Every bus route, by borough; typing narrows the lists down.
  const busGroups = useMemo(() => {
    const q = busSearch.trim().toLowerCase();
    const matches = (r: RouteInfo) => r.name.toLowerCase().startsWith(q) || r.longName?.toLowerCase().includes(q);
    return legendGroups(routes, 'bus')
      .map((g) => ({ ...g, routes: q ? g.routes.filter(matches) : g.routes }))
      .filter((g) => g.routes.length);
  }, [routes, busSearch]);

  const heading = (text: string) => <Text style={[styles.h3, { color: c.muted }]}>{text}</Text>;
  const button = (r: RouteInfo) => (
    <LineButton key={r.key} route={r} on={chosenSet.has(r.key)} dark={dark} onToggle={() => toggle(r)} />
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: c.card }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>Which lines do you ride?</Text>
          <Pressable onPress={() => { onChange([]); onClose(); }} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.link, { color: c.accent }]}>Skip</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: c.muted }]}>
          Pick the subway, train and bus lines you use, and the map shows just those. You can add or remove lines any
          time in the Lines tab.
        </Text>
        {/* Up here rather than down with the bus lines, so the keyboard never covers what is typed. */}
        <TextInput
          style={[styles.search, { color: c.text, borderColor: c.border }]}
          placeholder="Find a bus route, e.g. M15"
          placeholderTextColor={c.muted}
          value={busSearch}
          onChangeText={(text) => {
            setBusSearch(text);
            scroll.current?.scrollTo({ y: 0, animated: false });
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="done"
        />

        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.body}
        >
          {routes.length === 0 && <Text style={{ color: c.muted }}>The list of lines loads once the server answers.</Text>}

          {!searching && legendGroups(routes, 'subway').length > 0 && (
            <View>
              {heading(MODE_LABELS.subway)}
              {legendGroups(routes, 'subway').map((g) => (
                <View style={styles.row} key={g.color ?? g.routes[0].key}>
                  {g.routes.map(button)}
                </View>
              ))}
            </View>
          )}

          {!searching &&
            legendGroups(routes, 'rail').map((g) => (
              <View key={g.title}>
                {heading(g.title)}
                {g.routes.map(button)}
              </View>
            ))}

          {routes.length > 0 && (
            <View>
              {heading(MODE_LABELS.bus)}
              {busGroups.length === 0 && routes.some((r) => r.mode === 'bus') && (
                <Text style={{ color: c.muted }}>No bus route matches.</Text>
              )}
              {busGroups.map((g) => (
                <View key={g.title}>
                  <Text style={[styles.h4, { color: c.muted }]}>{g.title}</Text>
                  <View style={styles.row}>{g.routes.map(button)}</View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
        <View style={[styles.footer, { borderColor: c.border }]}>
          <Pressable onPress={onClose} accessibilityRole="button" style={[styles.finish, { backgroundColor: c.accent }]}>
            <Text style={styles.finishText}>
              {chosen.length ? `Show my ${chosen.length} line${chosen.length > 1 ? 's' : ''}` : 'Show every line'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  title: { flex: 1, fontSize: 22, fontWeight: '700' },
  link: { fontSize: 16 },
  hint: { paddingHorizontal: 20, marginTop: 4, fontSize: 14 },
  body: { padding: 20, paddingBottom: 60, gap: 18 },
  h3: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  h4: { fontSize: 14, fontWeight: '600', marginTop: 6, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  line: { borderRadius: 20 },
  railLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  off: { opacity: 0.3 },
  lineBadge: { minWidth: 36, height: 36, borderRadius: 18, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  railBadge: { minWidth: 14, width: 14, height: 14, borderRadius: 7, paddingHorizontal: 0 },
  lineBadgeText: { fontSize: 14, fontWeight: '800' },
  railName: { fontSize: 15 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36, borderTopWidth: StyleSheet.hairlineWidth },
  finish: { alignItems: 'center', paddingVertical: 13, borderRadius: 12 },
  finishText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginHorizontal: 20, marginTop: 12 },
});
