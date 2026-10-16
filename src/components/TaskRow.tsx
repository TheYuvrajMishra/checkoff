/**
 * CheckOff — swipeable task row (Phase 2).
 *
 * - Swipe right past the threshold: complete (haptic + toggle), then snap back.
 * - Swipe left past the threshold: reveal Skip / Reschedule actions.
 * - Long-press: open the task action sheet (Edit / Duplicate / Delete / Reschedule).
 * - Left priority bar: high = danger, medium = accent, low = success.
 * - Overdue badge for pending tasks past their alarm time (red tint).
 *
 * PanResponder-based (matches AddTaskSheet's drag pattern); no new deps.
 */
import { useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CalendarDays, Check, SkipForward } from 'lucide-react-native';
import { categoryColor, radius, space, TAP, type, type ThemePalette } from '../theme/tokens';
import type { TaskInstance } from '../db/types';
import { haptics } from '../haptics';

const SWIPE_COMPLETE_AT = 90;
const SWIPE_OPEN_AT = -110;
const ACTIONS_WIDTH = 168;

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
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snapBack = () => {
    openRef.current = false;
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
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
          Animated.timing(translateX, {
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
          Animated.spring(translateX, {
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

  const done = item.status === 'done';

  return (
    <View style={[styles.clip, { borderRadius: radius.md }]}>
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

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.row,
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
        <Pressable
          onPress={() => {
            if (openRef.current) snapBack();
            else onToggle();
          }}
          onLongPress={handleLongPress}
          delayLongPress={450}
          style={styles.taskMain}
          hitSlop={2}
        >
          {isNext && <Text style={[styles.nextCaption, { color: theme.accent }]}>NEXT</Text>}
          <View style={styles.taskLine}>
            <Text style={[styles.mono, { color: overdue ? theme.danger : theme.textDim }]}>
              {item.alarmTime ?? '--:--'}
            </Text>
            <View
              style={[styles.dot, { backgroundColor: categoryColor(categoryToken ?? 'slate') }]}
            />
            <Text
              style={[
                styles.body,
                {
                  flex: 1,
                  color: done ? theme.textFaint : theme.text,
                  textDecorationLine: done ? 'line-through' : 'none',
                },
              ]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text style={[styles.mono, { color: theme.textFaint }]}>{item.durationMin}m</Text>
          </View>
          <View style={styles.metaLine}>
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
        {item.status === 'pending' && (
          <Pressable
            onPress={onSkip}
            style={[styles.skipBtn, { minHeight: TAP }]}
            hitSlop={8}
          >
            <Text style={[styles.small, { color: theme.textFaint }]}>Skip</Text>
          </Pressable>
        )}
      </Animated.View>
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
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  priorityBar: { width: 4 },
  nextBar: { width: 3 },
  taskMain: {
    flex: 1,
    gap: space(0.5),
    minHeight: TAP,
    justifyContent: 'center',
    padding: space(1.5),
  },
  taskLine: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  nextCaption: { ...type.caption },
  body: { ...type.body },
  small: { ...type.small },
  mono: { ...type.mono, fontVariant: ['tabular-nums'] },
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
