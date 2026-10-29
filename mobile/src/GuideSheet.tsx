import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GUIDE } from '../../web/src/guide';
import { palette } from './theme';

interface Props {
  visible: boolean;
  dark: boolean;
  onClose: () => void;
}

/** How to use the map, opened from the toolbar's "?" and shown once on the first launch. */
export function GuideSheet({ visible, dark, onClose }: Props) {
  const c = palette(dark);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: c.card }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>How to use</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.done, { color: c.accent }]}>Done</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: c.muted }]}>Live trains and buses across New York, wherever you zoom in.</Text>

        <ScrollView contentContainerStyle={styles.body}>
          {GUIDE.map((section) => (
            <View key={section.title}>
              <Text style={[styles.h3, { color: c.muted }]}>{section.title}</Text>
              {section.points.map((point) => (
                <View style={styles.point} key={point}>
                  <Text style={[styles.bullet, { color: c.muted }]}>•</Text>
                  <Text style={[styles.pointText, { color: c.text }]}>{point}</Text>
                </View>
              ))}
            </View>
          ))}
          <Pressable onPress={onClose} accessibilityRole="button" style={[styles.gotIt, { backgroundColor: c.accent }]}>
            <Text style={styles.gotItText}>Got it</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  title: { flex: 1, fontSize: 22, fontWeight: '700' },
  done: { fontSize: 17, fontWeight: '600' },
  hint: { paddingHorizontal: 20, marginTop: 4, fontSize: 14 },
  body: { padding: 20, paddingBottom: 60, gap: 18 },
  h3: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  point: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  bullet: { fontSize: 15, lineHeight: 21 },
  pointText: { flex: 1, fontSize: 15, lineHeight: 21 },
  gotIt: { alignItems: 'center', paddingVertical: 13, borderRadius: 12 },
  gotItText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
