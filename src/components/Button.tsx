import { useId } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { HIT_SLOP, radius, space, TAP, type, useTheme } from '../theme/tokens';
import { PressableScale } from './PressableScale';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Tactile monotone button set:
 * - primary: solid white (or black in light mode) with subtle metallic linear sheen
 * - secondary: layered surface with hairline border & top inner highlight
 * - ghost: transparent with subtle dim text
 * Enforces 48dp minimum touch target, 0.97 press scale (zero bounce), and haptic tick.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconRight,
  fullWidth = false,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}: Props) {
  const theme = useTheme();
  const rawId = useId();
  const gradId = `btn_${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  const minHeight = size === 'lg' ? 54 : size === 'md' ? TAP : 40;
  const padH = size === 'lg' ? space(3) : size === 'md' ? space(2.25) : space(1.75);
  const borderRadius = size === 'lg' ? radius.lg : size === 'md' ? radius.md : radius.sm;

  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';

  const fgColor = isPrimary
    ? theme.onAccent
    : isSecondary
      ? theme.text
      : theme.textDim;

  return (
    <PressableScale
      onPress={disabled || loading ? undefined : onPress}
      disabled={disabled || loading}
      scaleTo={0.97}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading }}
      testID={testID}
      style={[fullWidth && styles.fullWidth, disabled && styles.disabled, style]}
      innerStyle={[
        styles.inner,
        {
          minHeight,
          paddingHorizontal: padH,
          borderRadius,
          backgroundColor: isPrimary
            ? theme.accent
            : isSecondary
              ? theme.surface2
              : 'transparent',
          borderWidth: isSecondary ? 1 : isPrimary ? 1 : 0,
          borderColor: isPrimary
            ? theme.borderStrong
            : isSecondary
              ? theme.borderStrong
              : 'transparent',
        },
      ]}
    >
      {isPrimary && (
        <View style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={theme.buttonSheen[0]} stopOpacity="1" />
                <Stop offset="55%" stopColor={theme.buttonSheen[1]} stopOpacity="1" />
                <Stop offset="100%" stopColor={theme.buttonSheen[2]} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradId})`} />
          </Svg>
        </View>
      )}
      {isSecondary && (
        <View
          pointerEvents="none"
          style={[
            styles.topHighlight,
            { backgroundColor: theme.topHighlight, borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius },
          ]}
        />
      )}
      {loading ? (
        <ActivityIndicator size="small" color={fgColor} />
      ) : (
        <View style={styles.contentRow}>
          {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              size === 'sm' ? styles.labelSm : size === 'lg' ? styles.labelLg : styles.labelMd,
              { color: fgColor },
              textStyle,
            ]}
          >
            {label}
          </Text>
          {iconRight ? <View style={styles.iconWrap}>{iconRight}</View> : null}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.38,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
    flexShrink: 1,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelSm: {
    ...type.small,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelMd: {
    ...type.h3,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelLg: {
    ...type.h2,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
