/**
 * CheckOff — floating action button (bottom-right, above the tab bar).
 * Lucide Plus icon, accent background. No emoji.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useUiStore } from '../state/ui';
import { dark, light, space, type ThemePalette } from '../theme/tokens';

const FAB_SIZE = 56;

export function Fab({ onPress, label = 'Add task' }: { onPress: () => void; label?: string }) {
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: theme.accent,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
      >
        <Plus color={theme.onAccent} size={26} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: space(2),
    // Clears the bottom tab bar.
    bottom: space(11),
    zIndex: 100,
    elevation: 6,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
