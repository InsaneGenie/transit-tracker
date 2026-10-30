import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from './theme';

/** Back to what the panel showed before the last tap in it. */
export function BackButton({ label, dark, onPress }: { label: string; dark: boolean; onPress: () => void }) {
  const c = palette(dark);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      style={({ pressed }) => [styles.back, { backgroundColor: c.raised, borderColor: c.border }, pressed && styles.pressed]}
    >
      <View style={[styles.icon, { backgroundColor: c.card }]}>
        <Text style={[styles.arrow, { color: c.text }]}>←</Text>
      </View>
      <Text style={[styles.text, { color: c.muted }]} numberOfLines={1}>
        <Text style={[styles.strong, { color: c.text }]}>Back</Text> to {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    height: 36,
    marginBottom: 12,
    paddingLeft: 5,
    paddingRight: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
  },
  pressed: { opacity: 0.6 },
  icon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.15,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
  },
  arrow: { fontSize: 15, fontWeight: '600', marginTop: -1 },
  text: { flexShrink: 1, fontSize: 15 },
  strong: { fontWeight: '600' },
});
