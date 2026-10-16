/**
 * CheckOff — press-feedback wrapper (Phase 4).
 *
 * Every press in the app should feel the same: scale to 0.96 with a spring
 * on press-in, spring back on release, and a light haptic tick on press.
 * All animation runs on the UI thread via Reanimated (60–120fps).
 *
 * `style` lands on the animated wrapper (layout), `innerStyle` on the
 * Pressable itself (backgrounds/borders). The tick respects the user's
 * haptic settings via the shared haptics module.
 */
import { useCallback } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { haptics } from '../haptics';

interface Props {
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  delayLongPress?: number;
  disabled?: boolean;
  /** Fire the light haptic tick on press. Default true. */
  tick?: boolean;
  /** Pressed scale. Default 0.96. */
  scaleTo?: number;
  /** Layout style — applied to the animated wrapper. */
  style?: StyleProp<ViewStyle>;
  /** Visual style — applied to the inner Pressable. */
  innerStyle?: StyleProp<ViewStyle>;
  hitSlop?: number | { top: number; bottom: number; left: number; right: number };
  accessibilityRole?: 'button' | 'checkbox' | 'link' | 'none';
  accessibilityLabel?: string;
  accessibilityState?: { checked?: boolean; disabled?: boolean; selected?: boolean };
  children?: React.ReactNode;
  testID?: string;
}

export function PressableScale({
  onPress,
  onLongPress,
  delayLongPress,
  disabled,
  tick = true,
  scaleTo = 0.96,
  style,
  innerStyle,
  hitSlop,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  children,
  testID,
}: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pressIn = () => {
    // Reanimated shared values are mutated by design; the React Compiler
    // lint rule does not model them.
    // eslint-disable-next-line react-hooks/immutability
    scale.value = withSpring(scaleTo, { damping: 15, stiffness: 400 });
  };
  const pressOut = () => {
    // eslint-disable-next-line react-hooks/immutability
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (tick) void haptics.check();
      onPress?.(e);
    },
    [onPress, tick]
  );

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        onPress={handlePress}
        onLongPress={onLongPress}
        delayLongPress={delayLongPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        style={innerStyle}
        hitSlop={hitSlop}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        testID={testID}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
