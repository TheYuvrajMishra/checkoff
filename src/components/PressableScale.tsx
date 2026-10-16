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
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { haptics } from '../haptics';
import { HIT_SLOP } from '../theme/tokens';

interface Props {
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  delayLongPress?: number;
  disabled?: boolean;
  /** Fire the light haptic tick on press. Default true. */
  tick?: boolean;
  /** Pressed scale. Default 0.97. */
  scaleTo?: number;
  /** Layout style — applied to the animated wrapper. */
  style?: StyleProp<ViewStyle>;
  /** Visual style — applied to the inner Pressable. */
  innerStyle?: StyleProp<ViewStyle>;
  hitSlop?: number | { top: number; bottom: number; left: number; right: number };
  accessibilityRole?: 'button' | 'checkbox' | 'link' | 'switch' | 'tab' | 'none';
  accessibilityLabel?: string;
  accessibilityState?: { checked?: boolean; disabled?: boolean; selected?: boolean };
  children?: React.ReactNode;
  testID?: string;
  /** Extra press-in hook (e.g. trigger a sheen sweep). Not called when disabled. */
  onPressIn?: () => void;
  /** Layout of the inner Pressable. */
  onLayout?: (e: LayoutChangeEvent) => void;
}

const SPRING_CONFIG = {
  damping: 26,
  stiffness: 520,
  mass: 0.6,
  overshootClamping: true,
} as const;

export function PressableScale({
  onPress,
  onLongPress,
  delayLongPress,
  disabled,
  tick = true,
  scaleTo = 0.97,
  style,
  innerStyle,
  hitSlop = HIT_SLOP,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  children,
  testID,
  onPressIn,
  onLayout,
}: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pressIn = () => {
    if (disabled) return;
    // eslint-disable-next-line react-hooks/immutability
    scale.value = withSpring(scaleTo, SPRING_CONFIG);
    onPressIn?.();
  };
  const pressOut = () => {
    // eslint-disable-next-line react-hooks/immutability
    scale.value = withSpring(1, SPRING_CONFIG);
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
        onLayout={onLayout}
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
