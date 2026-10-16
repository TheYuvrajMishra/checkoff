import { StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, useTheme } from '../theme/tokens';
import { PressableScale } from './PressableScale';

interface Props {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'recessed';
  /** Monotone priority/category left rule color */
  leftRuleColor?: string;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * Layered monotone surface card:
 * - Hairline border (8-12% opacity)
 * - Soft 1px inner specular highlight along top edge
 * - Optional monotone left rule for priority/category hierarchy
 */
export function Card({
  children,
  variant = 'default',
  leftRuleColor,
  onPress,
  onLongPress,
  padding = space(2),
  style,
  innerStyle,
  accessibilityLabel,
}: Props) {
  const theme = useTheme();

  const bg =
    variant === 'elevated'
      ? theme.surface2
      : variant === 'recessed'
        ? theme.bg
        : theme.surface;

  const borderColor = variant === 'elevated' ? theme.borderStrong : theme.border;

  const content = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: bg,
          borderColor,
          padding,
        },
        innerStyle,
      ]}
    >
      {/* Soft inner specular highlight on top edge */}
      <View
        pointerEvents="none"
        style={[styles.topHighlight, { backgroundColor: theme.topHighlight }]}
      />
      {leftRuleColor ? (
        <View
          pointerEvents="none"
          style={[styles.leftRule, { backgroundColor: leftRuleColor }]}
        />
      ) : null}
      {children}
    </View>
  );

  if (onPress || onLongPress) {
    return (
      <PressableScale
        onPress={onPress}
        onLongPress={onLongPress}
        scaleTo={0.98}
        accessibilityLabel={accessibilityLabel}
        style={style}
      >
        {content}
      </PressableScale>
    );
  }

  return <View style={style}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 1,
    right: 1,
    height: 1,
  },
  leftRule: {
    position: 'absolute',
    left: 0,
    top: space(1.5),
    bottom: space(1.5),
    width: 3,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
});
