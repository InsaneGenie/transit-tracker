import { Pressable, Share, StyleSheet, View } from 'react-native';
import { shareText } from '../../web/src/share';

/** Opens the share sheet with a link to the site showing this train, bus, line or station. */
export function ShareButton({ url, title, color }: { url: string; title: string; color: string }) {
  // iOS puts the link beside the words and previews it; elsewhere it goes at the end of them.
  const share = () => Share.share({ title, message: shareText(title), url }).catch(() => {});
  return (
    <Pressable onPress={share} hitSlop={12} accessibilityRole="button" accessibilityLabel="Share" style={styles.button}>
      {/* The usual share picture: an arrow up out of an open box. */}
      <View style={styles.icon}>
        <View style={[styles.box, { borderColor: color }]} />
        <View style={[styles.stem, { backgroundColor: color }]} />
        <View style={[styles.head, { borderColor: color }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: 4 },
  icon: { width: 18, height: 20 },
  box: {
    position: 'absolute',
    left: 1,
    right: 1,
    bottom: 0,
    height: 11,
    borderWidth: 1.8,
    borderTopWidth: 0,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  stem: { position: 'absolute', left: 8.1, top: 1, width: 1.8, height: 12, borderRadius: 1 },
  head: {
    position: 'absolute',
    left: 5,
    top: 1.5,
    width: 8,
    height: 8,
    borderLeftWidth: 1.8,
    borderTopWidth: 1.8,
    transform: [{ rotate: '45deg' }],
  },
});
