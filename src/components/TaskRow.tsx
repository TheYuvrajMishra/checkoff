/**
 * CheckOff — swipeable task row (Phase 2 + Phase 3 reskin).
 *
 * - Swipe right past the threshold: complete (haptic + toggle), then snap back.
 * - Swipe left past the threshold: reveal Skip / Reschedule actions.
 * - Long-press: open the task action sheet (Edit / Duplicate / Delete / Reschedule).
 * - Left priority bar: high = danger, medium = accent, low = success.
 * - Overdue badge for pending tasks past their alarm time (red tint).
 * - Phase 3: checkbox with drawn checkmark animation (Reanimated + SVG,
 *   runs on the UI thread), time in mono on the right, 16pt radii.
 *
 * PanResponder-based (matches AddTaskSheet's drag pattern); no new deps.
 */
import { useEffect, useRef } from 'react';
import {
  Animated as RNAnimated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  createAnimatedComponent,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle as SvgCircle, Path } from 'react-native-svg';
import { CalendarDays, Check, SkipForward } from 'lucide-react-native';
import { categoryColor, radius, shadow, space, TAP, type, type ThemePalette } from '../theme/tokens';
import type { TaskInstance } from '../db/types';
import { haptics } from '../haptics';

const SWIPE_COMPLETE_AT = 90;
const SWIPE_OPEN_AT = -110;
const ACTIONS_WIDTH = 168;

const AnimatedPath = createAnimatedComponent(Path);
const AnimatedSvgCircle = createAnimatedComponent(SvgCircle);

/** Approx. length of the check path below (M6 12.5 L10.5 17 L18 7.5). */
const CHECK_LEN = 19;
const CHECK_SIZE = 26;

export function priorityColor(priority: TaskInstance['priority'], theme: ThemePalette): string {
  switch (priority) {
    case 'high':
      return theme.danger;
    case 'low':
      return theme.success;
    default:
      return theme.accent;
  }
}

/**
 * Checkbox with a drawn checkmark. The stroke draws in on check and
 * retracts on uncheck, all on the UI thread via Reanimated animatedProps.
 */
export function AnimatedCheck({
  checked,
  theme,
}: {
  checked: boolean;
  theme: ThemePalette;
}) {
  const draw = useSharedValue(checked ? 1 : 0);
  const fill = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    draw.value = withTiming(checked ? 1 : 0, { duration: 220 });
    fill.value = withTiming(checked ? 1 : 0, { duration: 180 });
  }, [checked, draw, fill]);

  const pathProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_LEN * (1 - draw.value),
  }));
  const circleProps = useAnimatedProps(() => ({
    // Crossfade the fill by animating opacity of an accent disc.
    opacity: fill.value,
  }));

  return (
    <Svg width={CHECK_SIZE} height={CHECK_SIZE} viewBox="0 0 24 24">
      <SvgCircle
        cx={12}
        cy={12}
        r={10}
        fill="none"
        stroke={checked ? theme.accent : theme.textFaint}
        strokeWidth={2}
      />
      <AnimatedSvgCircle
        cx={12}
        cy={12}
        r={10}
        fill={theme.accent}
        animatedProps={circleProps}
      />
      <AnimatedPath
        d="M6 12.5 L10.5 17 L18 7.5"
        fill="none"
        stroke={theme.onAccent}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={CHECK_LEN}
        animatedProps={pathProps}
      />
    </Svg>
  );
}

interface Props {
  item: TaskInstance;
  theme: ThemePalette;
  categoryToken?: string;
  isNext: boolean;
  overdue: boolean;
  onToggle: () => void;
  onSkip: () => void;
  onReschedule: () => void;
  onLongPress: () => void;
}

export function TaskRow({
  item,
  theme,
  categoryToken,
  isNext,
  overdue,
  onToggle,
  onSkip,
  onReschedule,
  onLongPress,
}: Props) {
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const openRef = useRef(false);
  const pressScale = useSharedValue(1);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  // Reanimated shared values are mutated by design; the React Compiler
  // lint rule does not model them.
  // eslint-disable-next-line react-hooks/immutability
  const checkPressIn = () => { pressScale.value = withSpring(0.88, { damping: 14, stiffness: 450 }); };
  // eslint-disable-next-line react-hooks/immutability
  const checkPressOut = () => { pressScale.value = withSpring(1, { damping: 14, stiffness: 450 }); };

  const snapBack = () => {
    openRef.current = false;
    RNAnimated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (_, g) => {
        // Clamp: allow a full right-swipe pull, limited left reveal.
        const dx = Math.max(-ACTIONS_WIDTH - 24, Math.min(g.dx, 130));
        translateX.setValue(dx);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx >= SWIPE_COMPLETE_AT && item.status === 'pending') {
          // Swipe right → complete with haptic, then reset.
          RNAnimated.timing(translateX, {
            toValue: 130,
            duration: 120,
            useNativeDriver: true,
          }).start(() => {
            onToggle();
            translateX.setValue(0);
          });
        } else if (g.dx <= SWIPE_OPEN_AT && item.status === 'pending') {
          // Swipe left → reveal actions (pending tasks only).
          void haptics.check();
          openRef.current = true;
          RNAnimated.spring(translateX, {
            toValue: -ACTIONS_WIDTH,
            useNativeDriver: true,
          }).start();
        } else {
          snapBack();
        }
      },
      onPanResponderTerminate: () => snapBack(),
    })
  ).current;

  const handleLongPress = () => {
    void haptics.check();
    onLongPress();
  };

  const handlePress = () => {
    if (openRef.current) snapBack();
    else onToggle();
  };

  const done = item.status === 'done';

  return (
    <View style={[styles.clip, { borderRadius: radius.lg }]}>
      {/* Underlay: swipe-right complete */}
      <View style={[styles.underlay, styles.underlayLeft, { backgroundColor: theme.success }]}>
        <Check color="#fff" size={22} strokeWidth={2.5} />
      </View>
      {/* Underlay: swipe-left actions */}
      <View style={[styles.underlay, styles.underlayRight]}>
        <Pressable
          onPress={() => {
            snapBack();
            onSkip();
          }}
          style={[styles.actionBtn, { backgroundColor: theme.surface2 }]}
          accessibilityRole="button"
          accessibilityLabel="Skip task"
        >
          <SkipForward color={theme.textDim} size={18} strokeWidth={2} />
          <Text style={[styles.actionLabel, { color: theme.textDim }]}>Skip</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            snapBack();
            onReschedule();
          }}
          style={[styles.actionBtn, { backgroundColor: theme.accentDim }]}
          accessibilityRole="button"
          accessibilityLabel="Reschedule task"
        >
          <CalendarDays color={theme.accent} size={18} strokeWidth={2} />
          <Text style={[styles.actionLabel, { color: theme.accent }]}>Move</Text>
        </Pressable>
      </View>

      <RNAnimated.View
        {...panResponder.panHandlers}
        style={[
          styles.row,
          shadow.sm,
          {
            backgroundColor: theme.surface,
            borderColor: overdue ? theme.danger : theme.border,
            transform: [{ translateX }],
          },
        ]}
      >
        {/* Priority bar */}
        <View
          style={[
            styles.priorityBar,
            { backgroundColor: priorityColor(item.priority ?? 'medium', theme) },
          ]}
        />
        {isNext && <View style={[styles.nextBar, { backgroundColor: theme.accent }]} />}

        {/* Checkbox */}
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={450}
          onPressIn={checkPressIn}
          onPressOut={checkPressOut}
          style={styles.checkWrap}
          hitSlop={6}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={item.title}
        >
          <Animated.View style={pressStyle}>
            <AnimatedCheck checked={done} theme={theme} />
          </Animated.View>
        </Pressable>

        {/* Main content */}
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={450}
          style={styles.taskMain}
          hitSlop={2}
        >
          {isNext && <Text style={[styles.nextCaption, { color: theme.accent }]}>NEXT</Text>}
          <Text
            style={[
              styles.body,
              {
                color: done ? theme.textFaint : theme.text,
                textDecorationLine: done ? 'line-through' : 'none',
              },
            ]}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          <View style={styles.metaLine}>
            <View
              style={[styles.dot, { backgroundColor: categoryColor(categoryToken ?? 'slate') }]}
            />
            <Text style={[styles.mono, { color: theme.textFaint }]}>{item.durationMin}m</Text>
            {overdue && (
              <View style={[styles.overdueBadge, { backgroundColor: theme.danger }]}>
                <Text style={[styles.overdueText, { color: '#fff' }]}>Overdue</Text>
              </View>
            )}
            {item.status !== 'pending' && !done && (
              <Text style={[styles.small, { color: theme.textFaint }]}>{item.status}</Text>
            )}
          </View>
        </Pressable>

        {/* Time, mono, right-aligned */}
        <View style={styles.timeWrap}>
          <Text
            style={[
              styles.mono,
              styles.timeText,
              { color: overdue ? theme.danger : theme.textDim },
            ]}
          >
            {item.alarmTime ?? '--:--'}
          </Text>
        </View>

        {item.status === 'pending' && (
          <Pressable
            onPress={onSkip}
            style={[styles.skipBtn, { minHeight: TAP }]}
            hitSlop={8}
          >
            <Text style={[styles.small, { color: theme.textFaint }]}>Skip</Text>
          </Pressable>
        )}
      </RNAnimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  underlay: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
  },
  underlayLeft: {
    justifyContent: 'flex-start',
    paddingLeft: space(2.5),
  },
  underlayRight: {
    justifyContent: 'flex-end',
  },
  actionBtn: {
    width: ACTIONS_WIDTH / 2,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(0.5),
  },
  actionLabel: { ...type.caption, textTransform: 'uppercase' },
  row: {
    borderWidth: 1,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  priorityBar: { width: 4 },
  nextBar: { width: 3 },
  checkWrap: {
    justifyContent: 'center',
    paddingLeft: space(1.5),
    paddingRight: space(1),
    minHeight: TAP,
  },
  taskMain: {
    flex: 1,
    gap: space(0.5),
    minHeight: TAP,
    justifyContent: 'center',
    paddingVertical: space(1.5),
  },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  nextCaption: { ...type.caption },
  body: { ...type.body },
  small: { ...type.small },
  mono: { ...type.mono, fontVariant: ['tabular-nums'] },
  timeWrap: {
    justifyContent: 'center',
    paddingRight: space(1.5),
    paddingLeft: space(1),
  },
  timeText: { fontSize: 14 },
  overdueBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: space(1),
    paddingVertical: space(0.25),
  },
  overdueText: { ...type.caption, fontWeight: '700', textTransform: 'uppercase' },
  skipBtn: {
    justifyContent: 'center',
    paddingHorizontal: space(1.5),
  },
});
