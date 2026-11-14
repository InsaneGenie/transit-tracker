import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  dayLabel,
  dayTitle,
  directionLines,
  explainer,
  GRADE_COLORS,
  headline,
  trainLines,
  watchedText,
  type LineReport,
} from '../../web/src/report';
import { fetchReport, type Mode } from './api';
import { palette } from './theme';

/** Today's card fills in through the day; once every few minutes is plenty. */
const REFRESH_MS = 3 * 60 * 1000;

/** A line's report cards, while its page is showing. Null until they load, or when they can't be. */
function useReport(key: string, active: boolean): LineReport | null {
  const [report, setReport] = useState<LineReport | null>(null);
  useEffect(() => {
    setReport(null);
    if (!active) return;
    const controller = new AbortController();
    const load = () =>
      fetchReport(key, controller.signal)
        .then(setReport)
        .catch(() => {});
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [key, active]);
  return report;
}

/** How a line has run today and on the days before: a grade, and the numbers behind it when opened. */
export function ReportCard({
  lineKey,
  mode,
  active,
  dark,
  style,
}: {
  lineKey: string;
  mode: Mode;
  active: boolean;
  dark: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = palette(dark);
  const report = useReport(lineKey, active);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
    setPicked(null);
  }, [lineKey]);
  if (!report?.days.length || report.key !== lineKey) return null;
  const day = report.days.find((d) => d.date === picked) ?? report.days[0];
  const directions = (day.directions ?? []).map((d) => directionLines(d, mode));
  const trains = report.kind === 'ontime' ? trainLines(day) : [];
  const title = headline(report.kind, day, mode);

  return (
    <View style={[styles.card, { backgroundColor: c.raised }, style]}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Report card, ${dayTitle(day)}. ${day.grade ? `Grade ${day.grade}. ` : ''}${title}. ${watchedText(day)}`}
        style={({ pressed }) => [styles.summary, pressed && styles.pressed]}
      >
        <View style={[styles.grade, { backgroundColor: day.grade ? GRADE_COLORS[day.grade] : c.muted }]}>
          <Text style={styles.gradeText}>{day.grade ?? '–'}</Text>
        </View>
        <View style={styles.summaryText}>
          <Text style={[styles.eyebrow, { color: c.muted }]} numberOfLines={1}>
            REPORT CARD · {dayTitle(day).toUpperCase()}
          </Text>
          <Text style={[styles.headline, { color: c.text }]}>{title}</Text>
          <Text style={[styles.small, { color: c.muted }]}>{watchedText(day)}</Text>
        </View>
        <Text style={[styles.chevron, { color: c.muted }]}>{open ? '▴' : '▾'}</Text>
      </Pressable>

      {report.days.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days} accessibilityRole="tablist">
          {report.days.map((d) => {
            const on = d === day;
            return (
              <Pressable
                key={d.date}
                onPress={() => setPicked(d.date)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${dayLabel(d)}${d.grade ? `, grade ${d.grade}` : ''}`}
                style={[styles.dayChip, { backgroundColor: c.card, borderColor: on ? c.text : 'transparent' }]}
              >
                <Text style={[styles.dayLabel, { color: c.text }]}>{dayLabel(d)}</Text>
                <Text style={[styles.dayGrade, { color: d.grade ? GRADE_COLORS[d.grade] : c.muted }]}>{d.grade ?? '–'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {open && (
        <View style={styles.details}>
          {directions.map((d, i) => (
            <View key={i} style={styles.block}>
              <Text style={[styles.blockTitle, { color: c.text }]}>{d.title}</Text>
              {d.lines.map((line) => (
                <Text key={line} style={[styles.line, { color: c.text }]}>
                  • {line}
                </Text>
              ))}
            </View>
          ))}
          {trains.length > 0 && (
            <View style={styles.block}>
              {trains.map((line) => (
                <Text key={line} style={[styles.line, { color: c.text }]}>
                  • {line}
                </Text>
              ))}
            </View>
          )}
          <Text style={[styles.small, { color: c.muted }]}>{explainer(report.kind, mode)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  pressed: { opacity: 0.6 },
  grade: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  gradeText: { color: '#ffffff', fontSize: 24, fontWeight: '800' },
  summaryText: { flex: 1, minWidth: 0, gap: 1 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  headline: { fontSize: 15, fontWeight: '700' },
  small: { fontSize: 12 },
  chevron: { fontSize: 18, fontWeight: '700' },
  days: { gap: 4, paddingHorizontal: 12, paddingBottom: 10 },
  dayChip: { minWidth: 44, alignItems: 'center', paddingVertical: 4, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1 },
  dayLabel: { fontSize: 12 },
  dayGrade: { fontSize: 15, fontWeight: '700' },
  details: { gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
  block: { gap: 2 },
  blockTitle: { fontSize: 14, fontWeight: '700' },
  line: { fontSize: 14, lineHeight: 20 },
});
