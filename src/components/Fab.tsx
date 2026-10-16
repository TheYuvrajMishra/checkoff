/**
 * CheckOff — floating action button (bottom-right, above the tab bar).
 * Lucide Plus icon, accent background. PressableScale gives the 0.96 spring
 * press + light haptic tick (Reanimated, UI thread). No emoji.
 */
import { StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useUiStore } from '../state/ui';
import { dark, light, shadow, space, type ThemePalette } from '../theme/tokens';
import { PressableScale } from './PressableScale';

const FAB_SIZE = 56;

export function Fab({ onPress, label = 'Add task' }: { onPress: () => void; label?: string }) {
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));

  return (
    <PressableScale
      onPress={onPress}
      style={styles.wrap}
      innerStyle={[styles.fab, shadow.md, { backgroundColor: theme.accent }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
    >
      <Plus color={theme.onAccent} size={26} strokeWidth={2.5} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: space(2),
    // Clears the floating glass tab bar.
    bottom: space(15),
    zIndex: 100,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
