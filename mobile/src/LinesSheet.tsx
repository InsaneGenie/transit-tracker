import { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { colorFor, legendGroups, MODE_LABELS, textColorFor } from '../../web/src/vehicles';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../../web/src/alerts';
import { AlertList } from './AlertList';
import type { AlertSeverity, Mode, RouteInfo, ServiceAlert } from './api';
import { palette } from './theme';

interface Props {
  visible: boolean;
  routes: RouteInfo[];
  modes: Mode[];
  /** Line keys shown; empty means every line. */
  chosen: string[];
  /** The most serious alert on now, by line key, to mark those lines. */
  alertSummary: Record<string, AlertSeverity>;
  /** Every alert on the chosen lines; null while loading. */
  alerts: ServiceAlert[] | null;
  routesByKey: Map<string, RouteInfo>;
  dark: boolean;
  /** Asked on the first launch: which lines they ride. Nothing is lit until it is picked. */
  survey?: boolean;
  onChange: (chosen: string[]) => void;
  onClose: () => void;
}

function LineButton({
  route,
  on,
  alert,
  dark,
  onToggle,
}: {
  route: RouteInfo;
  on: boolean;
  alert?: AlertSeverity;
  dark: boolean;
  onToggle: () => void;
}) {
  const c = palette(dark);
  const color = colorFor({ routeColor: route.color, mode: route.mode });
  const rail = route.mode === 'rail';
  const name = route.longName ?? route.name;
  const mark = alert && (
    <View style={[styles.alertDot, !rail && styles.alertOnBadge, { backgroundColor: SEVERITY_COLORS[alert], borderColor: c.card }]} />
  );
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={alert ? `${name}, ${SEVERITY_LABELS[alert].toLowerCase()}` : name}
      style={[styles.line, rail && styles.railLine, !on && styles.off]}
    >
      <View style={[styles.lineBadge, { backgroundColor: color }, rail && styles.railBadge]}>
        {!rail && <Text style={[styles.lineBadgeText, { color: textColorFor(color) }]}>{route.name}</Text>}
        {!rail && mark}
      </View>
      {rail && <Text style={[styles.railName, { color: c.text }]}>{route.name}</Text>}
      {rail && mark}
    </Pressable>
  );
}

/** What each dot color means, and a way to show only some lines. */
export function LinesSheet({ visible, routes, modes, chosen, alertSummary, alerts, routesByKey, dark, survey, onChange, onClose }: Props) {
  const c = palette(dark);
  const [busSearch, setBusSearch] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  // While searching, only the matching bus routes are listed, right under the search box.
  const searching = busSearch.trim().length > 0;
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const isOn = (r: RouteInfo) => (!survey && chosenSet.size === 0) || chosenSet.has(r.key);
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: c.card }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>{survey ? 'Which lines do you ride?' : 'Lines'}</Text>
          {survey ? (
            <Pressable onPress={() => { onChange([]); onClose(); }} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.link, { color: c.accent }]}>Skip</Text>
            </Pressable>
          ) : chosen.length > 0 && (
            <Pressable onPress={() => onChange([])} hitSlop={8}>
              <Text style={[styles.link, { color: c.accent }]}>Show all</Text>
            </Pressable>
          )}
          {!survey && (
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.done, { color: c.accent }]}>Done</Text>
            </Pressable>
          )}
        </View>
        <Text style={[styles.hint, { color: c.muted }]}>
          {survey
            ? 'Pick the subway, train and bus lines you use, and the map shows just those. You can add or remove lines any time from Lines.'
            : chosen.length
            ? `Showing ${chosen.length} chosen line${chosen.length > 1 ? 's' : ''}.`
            : 'Tap lines to show only those.'}
          {!survey && Object.keys(alertSummary).length > 0 && ' A red, orange or yellow dot means delays or a service change.'}
        </Text>
        {/* Up here rather than down with the bus lines, so the keyboard never covers what is typed. */}
        {modes.includes('bus') && (
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
        )}

        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.body}
        >
          {routes.length === 0 && <Text style={{ color: c.muted }}>The list of lines loads once the server answers.</Text>}

          {!survey && !searching && chosen.length > 0 && (
            <View>
              {heading('Service alerts on your lines')}
              {alerts ? (
                <AlertList alerts={alerts} routes={routesByKey} dark={dark} empty="No delays or service changes right now." />
              ) : (
                <Text style={{ color: c.muted }}>Checking for delays…</Text>
              )}
            </View>
          )}

          {!searching && modes.includes('subway') && legendGroups(routes, 'subway').length > 0 && (
            <View>
              {heading(MODE_LABELS.subway)}
              {legendGroups(routes, 'subway').map((g) => (
                <View style={styles.row} key={g.color ?? g.routes[0].key}>
                  {g.routes.map((r) => (
                    <LineButton key={r.key} route={r} on={isOn(r)} alert={alertSummary[r.key]} dark={dark} onToggle={() => toggle(r)} />
                  ))}
                </View>
              ))}
            </View>
          )}

          {!searching && modes.includes('rail') &&
            legendGroups(routes, 'rail').map((g) => (
              <View key={g.title}>
                {heading(g.title)}
                {g.routes.map((r) => (
                  <LineButton key={r.key} route={r} on={isOn(r)} alert={alertSummary[r.key]} dark={dark} onToggle={() => toggle(r)} />
                ))}
              </View>
            ))}

          {modes.includes('bus') && (
            <View>
              {heading(MODE_LABELS.bus)}
              {busGroups.length === 0 && routes.some((r) => r.mode === 'bus') && (
                <Text style={{ color: c.muted }}>No bus route matches.</Text>
              )}
              {busGroups.map((g) => (
                <View key={g.title}>
                  <Text style={[styles.h4, { color: c.muted }]}>{g.title}</Text>
                  <View style={styles.row}>
                    {g.routes.map((r) => (
                      <LineButton key={r.key} route={r} on={isOn(r)} alert={alertSummary[r.key]} dark={dark} onToggle={() => toggle(r)} />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
        {survey && (
          <View style={[styles.footer, { borderColor: c.border }]}>
            <Pressable onPress={onClose} accessibilityRole="button" style={[styles.finish, { backgroundColor: c.accent }]}>
              <Text style={styles.finishText}>
                {chosen.length ? `Show my ${chosen.length} line${chosen.length > 1 ? 's' : ''}` : 'Show every line'}
              </Text>
            </Pressable>
          </View>
        )}
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
  h4: { fontSize: 14, fontWeight: '600', marginTop: 6, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  line: { borderRadius: 20 },
  railLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  off: { opacity: 0.3 },
  lineBadge: { minWidth: 36, height: 36, borderRadius: 18, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  railBadge: { minWidth: 14, width: 14, height: 14, borderRadius: 7, paddingHorizontal: 0 },
  lineBadgeText: { fontSize: 14, fontWeight: '800' },
  railName: { fontSize: 15 },
  alertDot: { width: 10, height: 10, borderRadius: 5 },
  alertOnBadge: { position: 'absolute', top: -2, right: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36, borderTopWidth: StyleSheet.hairlineWidth },
  finish: { alignItems: 'center', paddingVertical: 13, borderRadius: 12 },
  finishText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginHorizontal: 20, marginTop: 12 },
});
