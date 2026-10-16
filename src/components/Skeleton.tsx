/**
 * CheckOff — shimmer skeleton placeholder (Phase 4).
 *
 * Replaces static grey boxes / spinners while data loads. A soft highlight
 * sweeps across on the UI thread via Reanimated (no JS-frame work).
 */
import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useUiStore } from '../state/ui';
import { dark, light, radius, type ThemePalette } from '../theme/tokens';

export function Skeleton({
  height = 96,
  borderRadius = radius.lg,
  style,
}: {
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 1500 }), -1, false);
  }, [t]);

  const highlight = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-120, 420]) }],
  }));

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          height,
          borderRadius,
        },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <Animated.View
        style={[
          styles.sweep,
          { backgroundColor: theme.text },
          highlight,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 120,
    opacity: 0.05,
  },
});
