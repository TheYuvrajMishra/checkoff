import { useEffect, useMemo } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { haptics } from '../haptics';
import { HIT_SLOP, radius, space, TAP, type, useTheme } from '../theme/tokens';
import { PressableScale } from './PressableScale';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

const SCREEN_H = Dimensions.get('window').height;
const DISMISS_DRAG_THRESHOLD = 110;
const DISMISS_VELOCITY_THRESHOLD = 0.65;

/**
 * Velocity-aware bottom sheet that dismisses by dragging down.
 * - Drag handle at top
 * - Backdrop fade linked to sheet translation
 * - Zero-bounce Reanimated motion on the UI thread
 * - Keyboard-aware + respects safe-area bottom insets
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  contentStyle,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SCREEN_H);

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/immutability
      translateY.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      // eslint-disable-next-line react-hooks/immutability
      translateY.value = SCREEN_H;
    }
  }, [visible, translateY]);

  const animateClose = () => {
    void haptics.check();
    // eslint-disable-next-line react-hooks/immutability
    translateY.value = withTiming(
      SCREEN_H,
      { duration: 180, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(onClose)();
        }
      }
    );
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => {
          const dy = Math.max(0, g.dy);
          translateY.value = dy;
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > DISMISS_DRAG_THRESHOLD || g.vy > DISMISS_VELOCITY_THRESHOLD) {
            void haptics.check();
            translateY.value = withTiming(
              SCREEN_H,
              { duration: 180, easing: Easing.in(Easing.cubic) },
              (finished) => {
                if (finished) {
                  runOnJS(onClose)();
                }
              }
            );
          } else {
            translateY.value = withSpring(0, {
              damping: 28,
              stiffness: 420,
              overshootClamping: true,
            });
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onClose]
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, SCREEN_H * 0.6], [1, 0], 'clamp'),
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={animateClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.root}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.backdrop },
            backdropStyle,
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={animateClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              borderColor: theme.borderStrong,
              paddingBottom: Math.max(insets.bottom, space(2)),
            },
            sheetStyle,
            contentStyle,
          ]}
        >
          {/* Specular top highlight */}
          <View
            pointerEvents="none"
            style={[styles.topHighlight, { backgroundColor: theme.topHighlight }]}
          />

          {/* Drag handle + header zone */}
          <View {...panResponder.panHandlers} style={styles.dragZone}>
            <View style={[styles.handle, { backgroundColor: theme.textFaint }]} />
            {(title || subtitle) && (
              <View style={styles.headerRow}>
                <View style={styles.headerTitles}>
                  {title ? (
                    <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
                      {title}
                    </Text>
                  ) : null}
                  {subtitle ? (
                    <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textDim }]}>
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
                <PressableScale
                  onPress={animateClose}
                  hitSlop={HIT_SLOP}
                  accessibilityLabel="Close sheet"
                  innerStyle={[
                    styles.closeBtn,
                    { backgroundColor: theme.surface2, borderColor: theme.border },
                  ]}
                >
                  <X size={18} color={theme.textDim} />
                </PressableScale>
              </View>
            )}
          </View>

          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: 'hidden',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: space(2),
    right: space(2),
    height: 1,
  },
  dragZone: {
    paddingTop: space(1.25),
    paddingHorizontal: space(2.5),
    paddingBottom: space(1.5),
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: space(1.5),
    opacity: 0.6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(1.5),
  },
  headerTitles: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.h2,
  },
  subtitle: {
    ...type.small,
  },
  closeBtn: {
    width: TAP,
    height: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
