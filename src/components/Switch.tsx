import { Text, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { haptics } from '../haptics';
import { HIT_SLOP, space, type, useTheme, type ThemePalette } from '../theme/tokens';

interface Props {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  palette?: ThemePalette;
  accessibilityLabel?: string;
}

const TRACK_W = 56;
const TRACK_H = 32;
const THUMB_SIZE = 24;
const PAD = 4;
const TRAVEL = TRACK_W - THUMB_SIZE - PAD * 2; // 24dp

/**
 * Large custom monotone switch (56x32dp visual, >=48dp touch area via hitSlop + wrapper).
 * Zero-bounce 180ms eased thumb transition with clear visual ON (solid foreground + line marker)
 * and OFF (recessed surface + hollow circle marker) states.
 */
export function Switch({
  value,
  onValueChange,
  disabled = false,
  label,
  description,
  palette: propPalette,
  accessibilityLabel,
}: Props) {
  const currentTheme = useTheme();
  const theme = propPalette ?? currentTheme;
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    progress.value = withTiming(value ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [value, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [theme.surface2, theme.text]
    ),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [theme.textDim, theme.bg]
    ),
  }));

  const toggle = () => {
    if (disabled) return;
    void haptics.check();
    onValueChange(!value);
  };

  const switchControl = (
    <Pressable
      onPress={toggle}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: value, disabled }}
      style={[styles.touchTarget, disabled && styles.disabled]}
    >
      <Animated.View
        style={[
          styles.track,
          { borderColor: value ? theme.text : theme.borderStrong },
          trackStyle,
        ]}
      >
        {/* Subtle internal state glyphs for unambiguous monochrome readability */}
        <View style={[styles.onGlyph, { backgroundColor: theme.bg, opacity: value ? 0.55 : 0 }]} />
        <View
          style={[
            styles.offGlyph,
            { borderColor: theme.textFaint, opacity: value ? 0 : 0.7 },
          ]}
        />
        <Animated.View style={[styles.thumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );

  if (label) {
    return (
      <View style={styles.row}>
        <View style={styles.textCol}>
          <Text style={[styles.labelText, { color: theme.text }]} numberOfLines={1}>
            {label}
          </Text>
          {description ? (
            <Text style={[styles.descText, { color: theme.textDim }]} numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        {switchControl}
      </View>
    );
  }

  return switchControl;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 48,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  labelText: {
    ...type.bodyMedium,
    fontSize: 15,
  },
  descText: {
    ...type.caption,
    fontSize: 12,
  },
  touchTarget: {
    minWidth: 56,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: 1,
    padding: PAD - 1,
    justifyContent: 'center',
    position: 'relative',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
  },
  onGlyph: {
    position: 'absolute',
    left: 12,
    width: 2,
    height: 10,
    borderRadius: 1,
  },
  offGlyph: {
    position: 'absolute',
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
});
