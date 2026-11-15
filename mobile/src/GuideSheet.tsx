import { useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { FEEDBACK_EMAIL, feedbackMailto } from '../../web/src/feedback';
import { GUIDE, GUIDE_NOTE } from '../../web/src/guide';
import { ART_H, ART_W } from '../../web/src/guideArt';
import app from '../app.json';
import { palette } from './theme';
import { resetTips } from './Tip';

interface Props {
  visible: boolean;
  dark: boolean;
  onClose: () => void;
}

// Pictures rendered from web/src/guideArt.ts by mobile/scripts/guide-art.mjs, one per page.
const ART = [
  { light: require('../assets/guide/1-light.png'), dark: require('../assets/guide/1-dark.png') },
  { light: require('../assets/guide/2-light.png'), dark: require('../assets/guide/2-dark.png') },
  { light: require('../assets/guide/3-light.png'), dark: require('../assets/guide/3-dark.png') },
  { light: require('../assets/guide/4-light.png'), dark: require('../assets/guide/4-dark.png') },
  { light: require('../assets/guide/5-light.png'), dark: require('../assets/guide/5-dark.png') },
];

/** Opens Mail with the feedback form filled in, or shows the address when there is no mail app. */
function sendFeedback() {
  const device = `${Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone'}, iOS ${Platform.Version}`;
  const url = feedbackMailto({ from: `iPhone app ${app.expo.version}`, device });
  Linking.openURL(url).catch(() =>
    Alert.alert('No email app', `Write to ${FEEDBACK_EMAIL} with what happened or what you'd like to see.`),
  );
}

/** A few pages, each a picture and one line, opened from the toolbar's "?" and shown once on the first launch. */
export function GuideSheet({ visible, dark, onClose }: Props) {
  const c = palette(dark);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const pager = useRef<ScrollViewInstance>(null);
  const last = page === GUIDE.length - 1;
  const go = (i: number) => {
    setPage(i);
    pager.current?.scrollTo({ x: i * width, animated: true });
  };
  const close = () => {
    onClose();
    setPage(0);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[styles.sheet, { backgroundColor: c.card }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>How to use</Text>
          <Pressable onPress={close} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.done, { color: c.accent }]}>{last ? 'Done' : 'Skip'}</Text>
          </Pressable>
        </View>

        {width > 0 && (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
            style={styles.pager}
          >
            {GUIDE.map((step, i) => (
              <ScrollView key={step.title} style={{ width }} contentContainerStyle={styles.page}>
                <Image
                  source={ART[i][dark ? 'dark' : 'light']}
                  style={{ width: width - 40, height: ((width - 40) * ART_H) / ART_W, maxWidth: 480, maxHeight: 256, alignSelf: 'center' }}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
                <Text style={[styles.stepTitle, { color: c.text }]}>{step.title}</Text>
                <Text style={[styles.stepText, { color: c.muted }]}>{step.text}</Text>
                {i === GUIDE.length - 1 && (
                  <View style={styles.more}>
                    <Text style={[styles.note, { color: c.muted }]}>{GUIDE_NOTE}</Text>
                    <Pressable onPress={resetTips} hitSlop={8} accessibilityRole="button">
                      <Text style={[styles.link, { color: c.accent }]}>Show them again</Text>
                    </Pressable>
                    <Pressable onPress={sendFeedback} accessibilityRole="button" style={[styles.feedback, { borderColor: c.accent }]}>
                      <Text style={[styles.feedbackText, { color: c.accent }]}>Report a bug or send feedback</Text>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            ))}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <View style={styles.dots} accessibilityRole="tablist">
            {GUIDE.map((s, i) => (
              <Pressable
                key={s.title}
                onPress={() => go(i)}
                hitSlop={6}
                accessibilityRole="tab"
                accessibilityLabel={`${i + 1}. ${s.title}`}
                accessibilityState={{ selected: i === page }}
                style={[styles.dot, { backgroundColor: i === page ? c.accent : c.border }, i === page && styles.dotOn]}
              />
            ))}
          </View>
          <Pressable
            onPress={last ? close : () => go(page + 1)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.next, { backgroundColor: c.accent }, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.nextText}>{last ? 'Start' : 'Next'}</Text>
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
  done: { fontSize: 17, fontWeight: '600' },
  pager: { flex: 1, marginTop: 16 },
  page: { paddingHorizontal: 20, paddingBottom: 20 },
  stepTitle: { fontSize: 22, fontWeight: '700', marginTop: 24 },
  stepText: { fontSize: 17, lineHeight: 24, marginTop: 8 },
  more: { marginTop: 28, gap: 10 },
  note: { fontSize: 15, lineHeight: 21 },
  link: { fontSize: 15, fontWeight: '600' },
  feedback: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, marginTop: 8 },
  feedbackText: { fontSize: 16, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, gap: 16 },
  dots: { flex: 1, flexDirection: 'row', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { width: 22 },
  next: { paddingVertical: 13, paddingHorizontal: 34, borderRadius: 12 },
  nextText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
