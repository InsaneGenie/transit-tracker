import { useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { boroughLabel } from '../../web/src/lines';
import { legendGroups, MODE_LABELS } from '../../web/src/vehicles';
import type { AlertSeverity, Mode, RouteInfo } from './api';
import { LineBadge, lineStatus, vehicleCount } from './LineBadge';
import { palette } from './theme';

const BROWSE_MODES: Mode[] = ['subway', 'rail', 'bus'];
/** The borough whose buses were last shown, kept while the app runs. */
let lastBorough = 'Manhattan';

interface Props {
  routes: RouteInfo[];
  /** The lines starred as theirs; the map shows only these when there are any. */
  chosen: string[];
  /** The most serious alert on now, by line key. */
  alertSummary: Record<string, AlertSeverity>;
  /** How many vehicles are out on each line; null until loaded. */
  counts: Record<string, number> | null;
  dark: boolean;
  topInset: number;
  onChange: (chosen: string[]) => void;
  onOpen: (key: string) => void;
}

type Section = { key: string; title?: string; mine?: boolean; browse?: boolean; data: RouteInfo[] };

/** The Lines tab: your lines with how they're running, and every other line to browse and star. */
export function LinesScreen({ routes, chosen, alertSummary, counts, dark, topInset, onChange, onOpen }: Props) {
  const c = palette(dark);
  const [mode, setMode] = useState<Mode>('subway');
  const [search, setSearch] = useState('');
  // The bus list is long, so it shows one borough at a time.
  const [saved, setBorough] = useState(lastBorough);
  const pickBorough = (b: string) => {
    lastBorough = b;
    setBorough(b);
  };
  const boroughs = useMemo(() => legendGroups(routes, 'bus').map((g) => g.title), [routes]);
  const borough = boroughs.includes(saved) ? saved : (boroughs[0] ?? saved);
  const q = search.trim().toLowerCase();
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const byKey = useMemo(() => new Map(routes.map((r) => [r.key, r])), [routes]);
  const toggle = (key: string) => onChange(chosenSet.has(key) ? chosen.filter((k) => k !== key) : [...chosen, key]);

  const sections = useMemo((): Section[] => {
    if (q) {
      const matches = (r: RouteInfo) => r.name.toLowerCase().startsWith(q) || r.longName?.toLowerCase().includes(q);
      return BROWSE_MODES.map((m) => ({
        key: m,
        title: MODE_LABELS[m],
        data: legendGroups(routes, m).flatMap((g) => g.routes.filter(matches)),
      })).filter((s) => s.data.length);
    }
    const mine: Section = { key: 'mine', mine: true, data: chosen.flatMap((k) => byKey.get(k) ?? []) };
    const groups = legendGroups(routes, mode);
    // The subway is one list; rail lines go by railroad; buses show the picked borough's.
    const browse: Section[] =
      mode === 'subway'
        ? [{ key: 'subway', data: groups.flatMap((g) => g.routes) }]
        : mode === 'bus'
          ? groups.filter((g) => g.title === borough).map((g) => ({ key: g.title, data: g.routes }))
          : groups.map((g) => ({ key: g.title, title: g.title, data: g.routes }));
    if (browse.length) browse[0] = { ...browse[0], browse: true };
    else browse.push({ key: 'empty', browse: true, data: [] });
    return [mine, ...browse];
  }, [q, routes, chosen, byKey, mode, borough]);

  const status = (r: RouteInfo) => lineStatus(alertSummary[r.key], counts ? (counts[r.key] ?? 0) : undefined);

  const star = (r: RouteInfo) => {
    const on = chosenSet.has(r.key);
    return (
      <Pressable
        onPress={() => toggle(r.key)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={on ? `Remove ${r.name} from my lines` : `Add ${r.name} to my lines`}
      >
        <Text style={[styles.star, { color: on ? '#facc15' : c.border }]}>{on ? '★' : '☆'}</Text>
      </Pressable>
    );
  };

  const renderItem = ({ item: r, section }: { item: RouteInfo; section: Section }) => {
    const s = status(r);
    const count = counts?.[r.key];
    const name = r.mode === 'rail' ? r.name : (r.longName ?? `${MODE_LABELS[r.mode]} ${r.name}`);
    const statusText = (
      <Text style={[styles.meta, { color: c.muted }]} numberOfLines={1}>
        <Text style={{ color: s.color ?? c.muted }}>{section.mine && s.color ? '● ' : ''}{s.text}</Text>
        {section.mine && count ? ` · ${vehicleCount(count, r.mode)} running` : ''}
      </Text>
    );
    return (
      <Pressable
        onPress={() => onOpen(r.key)}
        accessibilityRole="button"
        accessibilityLabel={`${r.name}, ${s.text}`}
        style={({ pressed }) => [
          section.mine ? [styles.card, { backgroundColor: c.raised }] : [styles.row, { borderColor: c.border }],
          pressed && styles.pressed,
        ]}
      >
        <LineBadge route={r} />
        <View style={styles.rowText}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {name}
          </Text>
          {statusText}
        </View>
        {star(r)}
      </Pressable>
    );
  };

  const renderSectionHeader = ({ section }: { section: Section }) => {
    if (section.mine) {
      return (
        <View style={[styles.sectionHead, { backgroundColor: c.card }]}>
          <Text style={[styles.h3, { color: c.muted }]}>My lines</Text>
          {chosen.length > 0 && (
            <Pressable onPress={() => onChange([])} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.link, { color: c.accent }]}>Clear</Text>
            </Pressable>
          )}
        </View>
      );
    }
    return (
      <View style={{ backgroundColor: c.card }}>
        {section.browse && (
          <>
            <Text style={[styles.h3, styles.allLines, { color: c.muted }]}>All lines</Text>
            <View style={[styles.segment, { backgroundColor: c.raised }]} accessibilityRole="tablist">
              {BROWSE_MODES.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: m === mode }}
                  style={[styles.segmentItem, m === mode && { backgroundColor: c.segmentOn }]}
                >
                  <Text style={[styles.segmentText, { color: c.text }, m === mode && styles.segmentTextOn]}>{MODE_LABELS[m]}</Text>
                </Pressable>
              ))}
            </View>
            {mode === 'bus' && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.boroughs}
                accessibilityRole="tablist"
                accessibilityLabel="Borough"
              >
                {boroughs.map((b) => (
                  <Pressable
                    key={b}
                    onPress={() => pickBorough(b)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: b === borough }}
                    style={[styles.borough, { borderColor: c.border }, b === borough && { backgroundColor: c.text, borderColor: c.text }]}
                  >
                    <Text style={[styles.boroughText, { color: b === borough ? c.card : c.text }]}>{boroughLabel(b)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </>
        )}
        {section.title && <Text style={[q ? styles.h3 : styles.h4, { color: c.muted }]}>{section.title}</Text>}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.card, paddingTop: topInset }]}>
      <Text style={[styles.title, { color: c.text }]}>Lines</Text>
      <TextInput
        style={[styles.search, { color: c.text, backgroundColor: c.raised }]}
        placeholder="Search lines and bus routes"
        placeholderTextColor={c.muted}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={({ section }) =>
          section.mine && section.data.length === 0 ? (
            <Text style={[styles.empty, { color: c.muted }]}>
              {routes.length
                ? 'Tap ☆ on the lines you ride to keep them here. The map then shows only those.'
                : 'The list of lines loads once the server answers.'}
            </Text>
          ) : null
        }
        ListEmptyComponent={q ? <Text style={[styles.empty, { color: c.muted }]}>No line matches.</Text> : undefined}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.list}
        initialNumToRender={20}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 32, fontWeight: '800', marginTop: 8, marginBottom: 10, paddingHorizontal: 16 },
  search: { borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginHorizontal: 16, marginBottom: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h3: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  h4: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 2 },
  allLines: { marginTop: 22 },
  link: { fontSize: 15, marginTop: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, marginTop: 2 },
  star: { fontSize: 24, paddingHorizontal: 4 },
  empty: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  segment: { flexDirection: 'row', borderRadius: 9, padding: 2, marginBottom: 4 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 7 },
  segmentText: { fontSize: 14 },
  segmentTextOn: { fontWeight: '700' },
  boroughs: { gap: 6, paddingVertical: 8 },
  borough: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  boroughText: { fontSize: 14, fontWeight: '600' },
});
