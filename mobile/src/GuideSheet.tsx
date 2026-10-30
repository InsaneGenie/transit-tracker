import { Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FEEDBACK_EMAIL, feedbackMailto } from '../../web/src/feedback';
import { GUIDE } from '../../web/src/guide';
import app from '../app.json';
import { palette } from './theme';

interface Props {
  visible: boolean;
  dark: boolean;
  onClose: () => void;
}

/** Opens Mail with the feedback form filled in, or shows the address when there is no mail app. */
function sendFeedback() {
  const device = `${Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone'}, iOS ${Platform.Version}`;
  const url = feedbackMailto({ from: `iPhone app ${app.expo.version}`, device });
  Linking.openURL(url).catch(() =>
    Alert.alert('No email app', `Write to ${FEEDBACK_EMAIL} with what happened or what you'd like to see.`),
  );
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
          <View>
            <Text style={[styles.h3, { color: c.muted }]}>Feedback</Text>
            <Text style={[styles.pointText, { color: c.text }]}>
              Found a bug, or have an idea? Tell us; it opens an email that's ready to send.
            </Text>
            <Pressable
              onPress={sendFeedback}
              accessibilityRole="button"
              style={[styles.feedback, { borderColor: c.accent }]}
            >
              <Text style={[styles.feedbackText, { color: c.accent }]}>Report a bug or send feedback</Text>
            </Pressable>
          </View>
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
  feedback: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, marginTop: 12 },
  feedbackText: { fontSize: 16, fontWeight: '600' },
  gotIt: { alignItems: 'center', paddingVertical: 13, borderRadius: 12 },
  gotItText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
