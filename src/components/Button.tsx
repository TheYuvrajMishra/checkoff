import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { HIT_SLOP, radius, space, TAP, type, useTheme } from '../theme/tokens';
import { PressableScale } from './PressableScale';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Brushed-titanium face kinds. `light` = machined silver, `dark` = dark brushed metal, `satin` = light aluminum. */
export type MetalKind = 'light' | 'dark' | 'satin';

interface MetalSpec {
  colors: readonly [string, string, ...string[]];
  locations: readonly [number, number, ...number[]];
  /** Polished chrome top edge. */
  topLine: string;
  /** Darker bottom bevel. */
  bottomLine: string;
}

/**
 * Brushed titanium stops — fine machined tones, matte-ish and restrained.
 * No plastic gloss, no rainbow: subtle vertical banding + a faint diagonal
 * anisotropic sheen, a near-white polished line at the top edge and a
 * slightly darker bevel at the bottom.
 */
const METAL: Record<MetalKind, MetalSpec> = {
  light: {
    colors: ['#EDEDEF', '#D3D3D9', '#C4C4CB', '#F0F0F3', '#B2B2BA'],
    locations: [0, 0.3, 0.5, 0.66, 1],
    topLine: 'rgba(255,255,255,0.65)',
    bottomLine: 'rgba(0,0,0,0.22)',
  },
  dark: {
    colors: ['#4B4B52', '#343439', '#2B2B30', '#44444A', '#1E1E23'],
    locations: [0, 0.3, 0.5, 0.68, 1],
    topLine: 'rgba(255,255,255,0.28)',
    bottomLine: 'rgba(0,0,0,0.5)',
  },
  satin: {
    colors: ['#FBFBFC', '#E9E9ED', '#DBDBDF', '#F3F3F5', '#C7C7CC'],
    locations: [0, 0.3, 0.5, 0.66, 1],
    topLine: 'rgba(255,255,255,0.8)',
    bottomLine: 'rgba(0,0,0,0.14)',
  },
};

/**
 * Photorealistic brushed-metal face for buttons and button-like pressables.
 * Renders the titanium gradient + diagonal sheen + chrome top edge + bottom
 * bevel as an absolute fill; place as the first child inside an
 * overflow-hidden, rounded container.
 */
export function MetalFill({
  kind,
  borderRadius,
}: {
  kind: MetalKind;
  borderRadius: number;
}) {
  const m = METAL[kind];
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}
    >
      <LinearGradient
        colors={m.colors}
        locations={m.locations}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* faint diagonal anisotropic sheen */}
      <LinearGradient
        colors={[
          'rgba(255,255,255,0.10)',
          'rgba(255,255,255,0)',
          'rgba(255,255,255,0.07)',
        ]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* polished chrome top edge */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: m.topLine,
        }}
      />
      {/* darker bottom bevel */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: m.bottomLine,
        }}
      />
    </View>
  );
}

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

const SHEEN_W = 72;
const SWEEP_MS = 320;

/**
 * Tactile monotone button set, brushed-titanium edition:
 * - primary: machined silver (dark theme) / dark brushed metal (light theme)
 * - secondary: dark brushed metal (dark theme) / satin aluminum (light theme)
 * - ghost: transparent with subtle dim text (unchanged)
 * Press-in fires a quick (~320ms), low-opacity light sweep across the face.
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
  const isDark = theme.name === 'dark';

  const minHeight = size === 'lg' ? 54 : size === 'md' ? TAP : 40;
  const padH = size === 'lg' ? space(3) : size === 'md' ? space(2.25) : space(1.75);
  const borderRadius = size === 'lg' ? radius.lg : size === 'md' ? radius.md : radius.sm;

  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';

  const metalKind: MetalKind | null = isPrimary
    ? isDark
      ? 'light'
      : 'dark'
    : isSecondary
      ? isDark
        ? 'dark'
        : 'satin'
      : null;

  const fgColor = isPrimary
    ? theme.onAccent
    : isSecondary
      ? theme.text
      : theme.textDim;

  // Light sweep on press-in: a narrow soft-white band translating across.
  const [btnWidth, setBtnWidth] = useState(0);
  const sweepX = useSharedValue(0);
  const sweepOpacity = useSharedValue(0);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setBtnWidth(e.nativeEvent.layout.width);
  }, []);

  const handlePressIn = useCallback(() => {
    'worklet';
    if (btnWidth <= 0) return;
    // eslint-disable-next-line react-hooks/immutability
    sweepOpacity.value = 1;
    // eslint-disable-next-line react-hooks/immutability
    sweepX.value = -SHEEN_W;
    // eslint-disable-next-line react-hooks/immutability
    sweepX.value = withTiming(
      btnWidth + SHEEN_W,
      { duration: SWEEP_MS, easing: Easing.out(Easing.cubic) },
      (finished) => {
        // eslint-disable-next-line react-hooks/immutability
        if (finished) sweepOpacity.value = withTiming(0, { duration: 200 });
      }
    );
  }, [btnWidth, sweepOpacity, sweepX]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweepX.value }],
    opacity: sweepOpacity.value * 0.5,
  }));

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
      onPressIn={metalKind != null ? handlePressIn : undefined}
      onLayout={metalKind != null ? handleLayout : undefined}
      style={[fullWidth && styles.fullWidth, disabled && styles.disabled, style]}
      innerStyle={[
        styles.inner,
        {
          minHeight,
          paddingHorizontal: padH,
          borderRadius,
          // Solid fallback under the gradient (invisible when MetalFill renders).
          backgroundColor: isPrimary
            ? theme.accent
            : isSecondary
              ? theme.surface2
              : 'transparent',
          borderWidth: isSecondary || isPrimary ? 1 : 0,
          borderColor:
            isPrimary || isSecondary ? theme.borderStrong : 'transparent',
        },
      ]}
    >
      {metalKind != null && (
        <MetalFill kind={metalKind} borderRadius={borderRadius} />
      )}
      {metalKind != null && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, overflow: 'hidden' },
          ]}
        >
          <Animated.View
            style={[
              { position: 'absolute', top: -6, bottom: -6, width: SHEEN_W },
              sweepStyle,
            ]}
          >
            <LinearGradient
              colors={[
                'rgba(255,255,255,0)',
                'rgba(255,255,255,0.55)',
                'rgba(255,255,255,0)',
              ]}
              locations={[0, 0.5, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </Animated.View>
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
