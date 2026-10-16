/**
 * CheckOff — floating action button (bottom-right, above the tab bar).
 * Lucide Plus icon, accent background. Press scales to 0.96 with a spring
 * on the UI thread (Reanimated). No emoji.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Plus } from 'lucide-react-native';
import { useUiStore } from '../state/ui';
import { dark, light, shadow, space, type ThemePalette } from '../theme/tokens';

const FAB_SIZE = 56;

export function Fab({ onPress, label = 'Add task' }: { onPress: () => void; label?: string }) {
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Reanimated shared values are mutated by design; the React Compiler
  // lint rule does not model them.
  // eslint-disable-next-line react-hooks/immutability
  const pressIn = () => { scale.value = withSpring(0.96, { damping: 15, stiffness: 400 }); };
  // eslint-disable-next-line react-hooks/immutability
  const pressOut = () => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View style={animatedStyle}>
        <Pressable
          onPress={onPress}
          onPressIn={pressIn}
          onPressOut={pressOut}
          style={[styles.fab, shadow.md, { backgroundColor: theme.accent }]}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={8}
        >
          <Plus color={theme.onAccent} size={26} strokeWidth={2.5} />
        </Pressable>
      </Animated.View>
    </View>
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
