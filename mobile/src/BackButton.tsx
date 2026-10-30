import { Pressable, StyleSheet, Text } from 'react-native';
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
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Text style={[styles.text, { color: c.accent }]} numberOfLines={1}>
        ‹ Back to {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', maxWidth: '100%', paddingTop: 2, paddingBottom: 8 },
  pressed: { opacity: 0.5 },
  text: { fontSize: 16, fontWeight: '500' },
});
