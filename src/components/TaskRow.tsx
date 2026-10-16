/**
 * CheckOff — swipeable task card (monotone precision design).
 *
 * - Swipe right past threshold: complete (haptic tick at threshold + release).
 * - Swipe left past threshold: reveal Skip / Move actions.
 * - Long-press: open TaskActionSheet (Edit / Duplicate / Delete / Reschedule).
 * - Layered surface with 1px top specular highlight, thin left priority rule,
 *   mono time, category label, priority marker, duration, and timer shortcut.
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
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle as SvgCircle, Path } from 'react-native-svg';
import { CalendarDays, Check, Play, SkipForward } from 'lucide-react-native';
import {
  categoryColor,
  HIT_SLOP,
  MOTION,
  priorityRuleColor,
  radius,
  shadow,
  space,
  TAP,
  type,
  type ThemePalette,
} from '../theme/tokens';
import type { TaskInstance } from '../db/types';
import { haptics } from '../haptics';
import { PressableScale } from './PressableScale';

const SWIPE_COMPLETE_AT = 84;
const SWIPE_OPEN_AT = -96;
const ACTIONS_WIDTH = 152;

const AnimatedPath = createAnimatedComponent(Path);
const AnimatedSvgCircle = createAnimatedComponent(SvgCircle);

const CHECK_LEN = 19;
const CHECK_SIZE = 24;

export function priorityColor(priority: TaskInstance['priority'], theme: ThemePalette): string {
  return priorityRuleColor(priority ?? 'medium', theme);
}

export function formatTimeDisplay(hhmm: string | null, format: '12h' | '24h' = '24h'): string {
  if (!hhmm) return '--:--';
  if (format === '24h') return hhmm;
  const parts = hhmm.split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return hhmm;
  const [h, m] = parts;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

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
    draw.value = withTiming(checked ? 1 : 0, {
      duration: MOTION.normal,
      easing: Easing.out(Easing.cubic),
    });
    fill.value = withTiming(checked ? 1 : 0, {
      duration: MOTION.fast,
      easing: Easing.out(Easing.cubic),
    });
  }, [checked, draw, fill]);

  const pathProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_LEN * (1 - draw.value),
  }));
  const circleProps = useAnimatedProps(() => ({
    opacity: fill.value,
  }));

  return (
    <Svg width={CHECK_SIZE} height={CHECK_SIZE} viewBox="0 0 24 24">
      <SvgCircle
        cx={12}
        cy={12}
        r={10}
        fill="none"
        stroke={checked ? theme.accent : theme.borderStrong}
        strokeWidth={1.75}
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
  categoryName?: string;
  clockFormat?: '12h' | '24h';
  isNext: boolean;
  overdue: boolean;
  onToggle: () => void;
  onSkip: () => void;
  onReschedule: () => void;
  onLongPress: () => void;
  onStartTimer?: () => void;
}

export function TaskRow({
  item,
  theme,
  categoryToken,
  categoryName,
  clockFormat = '24h',
  isNext,
  overdue,
  onToggle,
  onSkip,
  onReschedule,
  onLongPress,
  onStartTimer,
}: Props) {
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const openRef = useRef(false);
  const pressScale = useSharedValue(1);
  const tickedRight = useRef(false);
  const tickedLeft = useRef(false);
  const statusRef = useRef(item.status);

  useEffect(() => {
    statusRef.current = item.status;
  }, [item.status]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  // eslint-disable-next-line react-hooks/immutability
  const checkPressIn = () => {
    pressScale.value = withSpring(0.92, {
      damping: 26,
      stiffness: 420,
      overshootClamping: true,
    });
  };
  // eslint-disable-next-line react-hooks/immutability
  const checkPressOut = () => {
    pressScale.value = withSpring(1, {
      damping: 26,
      stiffness: 420,
      overshootClamping: true,
    });
  };

  const snapBack = () => {
    openRef.current = false;
    tickedRight.current = false;
    tickedLeft.current = false;
    RNAnimated.timing(translateX, {
      toValue: 0,
      duration: MOTION.fast,
      useNativeDriver: true,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (_, g) => {
        const dx = Math.max(-ACTIONS_WIDTH - 16, Math.min(g.dx, 120));
        translateX.setValue(dx);
        if (statusRef.current === 'pending') {
          if (dx >= SWIPE_COMPLETE_AT && !tickedRight.current) {
            tickedRight.current = true;
            void haptics.check();
          } else if (dx <= SWIPE_OPEN_AT && !tickedLeft.current) {
            tickedLeft.current = true;
            void haptics.check();
          }
        }
      },
      onPanResponderRelease: (_, g) => {
        tickedRight.current = false;
        tickedLeft.current = false;
        if (g.dx >= SWIPE_COMPLETE_AT && statusRef.current === 'pending') {
          RNAnimated.timing(translateX, {
            toValue: 120,
            duration: 120,
            useNativeDriver: true,
          }).start(() => {
            onToggle();
            translateX.setValue(0);
          });
        } else if (g.dx <= SWIPE_OPEN_AT && statusRef.current === 'pending') {
          openRef.current = true;
          RNAnimated.timing(translateX, {
            toValue: -ACTIONS_WIDTH,
            duration: MOTION.fast,
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
  const prio = item.priority ?? 'medium';
  const prioLabel = prio === 'high' ? 'HIGH' : prio === 'low' ? 'LOW' : 'MED';

  return (
    <View style={[styles.clip, { borderRadius: radius.lg }]}>
      {/* Underlay: swipe-right complete */}
      <View style={[styles.underlay, styles.underlayLeft, { backgroundColor: theme.accent }]}>
        <Check color={theme.onAccent} size={20} strokeWidth={2.5} />
        <Text style={[styles.underlayText, { color: theme.onAccent }]}>COMPLETE</Text>
      </View>

      {/* Underlay: swipe-left actions */}
      <View style={[styles.underlay, styles.underlayRight, { backgroundColor: theme.surface2 }]}>
        <PressableScale
          onPress={() => {
            snapBack();
            onSkip();
          }}
          style={styles.actionBtn}
          innerStyle={[styles.actionInner, { backgroundColor: theme.surface2 }]}
          accessibilityRole="button"
          accessibilityLabel="Skip task"
        >
          <SkipForward color={theme.textDim} size={16} strokeWidth={2} />
          <Text style={[styles.actionLabel, { color: theme.textDim }]} numberOfLines={1}>
            Skip
          </Text>
        </PressableScale>
        <PressableScale
          onPress={() => {
            snapBack();
            onReschedule();
          }}
          style={styles.actionBtn}
          innerStyle={[styles.actionInner, { backgroundColor: theme.surface3 }]}
          accessibilityRole="button"
          accessibilityLabel="Move task"
        >
          <CalendarDays color={theme.text} size={16} strokeWidth={2} />
          <Text style={[styles.actionLabel, { color: theme.text }]} numberOfLines={1}>
            Move
          </Text>
        </PressableScale>
      </View>

      <RNAnimated.View
        {...panResponder.panHandlers}
        style={[
          styles.row,
          shadow.sm,
          {
            backgroundColor: theme.surface,
            borderColor: overdue ? theme.borderStrong : isNext ? theme.borderStrong : theme.border,
            transform: [{ translateX }],
          },
        ]}
      >
        {/* Top 1px specular highlight */}
        <View
          pointerEvents="none"
          style={[styles.topEdge, { backgroundColor: theme.topHighlight }]}
        />

        {/* Thin left priority rule */}
        <View
          style={[
            styles.priorityBar,
            { backgroundColor: priorityRuleColor(prio, theme) },
          ]}
        />

        {/* Checkbox (48dp touch target) */}
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={400}
          onPressIn={checkPressIn}
          onPressOut={checkPressOut}
          style={styles.checkWrap}
          hitSlop={HIT_SLOP}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={item.title}
        >
          <Animated.View style={pressStyle}>
            <AnimatedCheck checked={done} theme={theme} />
          </Animated.View>
        </Pressable>

        {/* Main task body */}
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={400}
          style={styles.taskMain}
        >
          <View style={styles.titleRow}>
            {isNext && !done && (
              <View style={[styles.nextBadge, { borderColor: theme.borderStrong }]}>
                <Text style={[styles.nextCaption, { color: theme.text }]}>NEXT</Text>
              </View>
            )}
            {overdue && !done && (
              <View style={[styles.overdueBadge, { backgroundColor: theme.accent }]}>
                <Text style={[styles.overdueText, { color: theme.onAccent }]}>LATE</Text>
              </View>
            )}
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
          </View>

          <View style={styles.metaLine}>
            <Text
              style={[
                styles.monoTime,
                { color: overdue && !done ? theme.text : theme.textDim },
              ]}
              numberOfLines={1}
            >
              {formatTimeDisplay(item.alarmTime, clockFormat)}
            </Text>
            <Text style={[styles.sep, { color: theme.textFaint }]}>·</Text>
            <Text style={[styles.monoMeta, { color: theme.textFaint }]} numberOfLines={1}>
              {item.durationMin}m
            </Text>
            <Text style={[styles.sep, { color: theme.textFaint }]}>·</Text>
            <View
              style={[
                styles.dot,
                { backgroundColor: categoryColor(categoryToken ?? 'slate', theme) },
              ]}
            />
            {categoryName ? (
              <Text style={[styles.metaLabel, { color: theme.textDim }]} numberOfLines={1}>
                {categoryName}
              </Text>
            ) : null}
            <View
              style={[
                styles.prioPill,
                {
                  borderColor: prio === 'high' ? theme.borderStrong : theme.border,
                  backgroundColor: prio === 'high' ? theme.surface3 : 'transparent',
                },
              ]}
            >
              <Text
                style={[
                  styles.prioText,
                  { color: prio === 'high' ? theme.text : theme.textFaint },
                ]}
              >
                {prioLabel}
              </Text>
            </View>
            {item.status !== 'pending' && !done && (
              <Text style={[styles.statusTag, { color: theme.textFaint }]}>
                {item.status.toUpperCase()}
              </Text>
            )}
          </View>
        </Pressable>

        {/* Right actions: Timer shortcut */}
        {item.status === 'pending' && onStartTimer && (
          <PressableScale
            onPress={onStartTimer}
            hitSlop={HIT_SLOP}
            style={styles.timerBtn}
            innerStyle={[
              styles.timerBtnInner,
              { backgroundColor: theme.surface2, borderColor: theme.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Start timer for ${item.title}`}
          >
            <Play color={theme.text} size={14} strokeWidth={2.2} />
          </PressableScale>
        )}
      </RNAnimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  underlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
  },
  underlayLeft: {
    justifyContent: 'flex-start',
    paddingLeft: space(2.5),
    gap: space(1),
  },
  underlayText: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  underlayRight: {
    justifyContent: 'flex-end',
  },
  actionBtn: {
    width: ACTIONS_WIDTH / 2,
    height: '100%',
  },
  actionInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionLabel: { ...type.caption, textTransform: 'uppercase' },
  row: {
    borderWidth: 1,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    zIndex: 2,
  },
  priorityBar: {
    width: 3,
    alignSelf: 'stretch',
  },
  checkWrap: {
    width: TAP,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskMain: {
    flex: 1,
    gap: 6,
    minHeight: TAP + 16,
    justifyContent: 'center',
    paddingVertical: space(1.5),
    paddingRight: space(1),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  nextBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  nextCaption: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  overdueBadge: {
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  overdueText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  body: {
    ...type.bodyMedium,
    flexShrink: 1,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  monoTime: {
    ...type.mono,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  monoMeta: {
    ...type.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  sep: {
    fontSize: 12,
    lineHeight: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metaLabel: {
    ...type.small,
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 96,
  },
  prioPill: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  prioText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  statusTag: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  timerBtn: {
    width: TAP,
    height: TAP,
    marginRight: space(1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerBtnInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
