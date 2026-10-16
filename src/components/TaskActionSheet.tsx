/**
 * CheckOff — long-press task action sheet (Phase 2).
 *
 * Bottom sheet with: Edit, Duplicate, Delete (two-tap confirm, soft),
 * Reschedule (native date picker). All mutations go through the tasks
 * store so the append-only log stays complete.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CalendarDays, Copy, Pencil, Trash2, X } from 'lucide-react-native';
import { useTasksStore } from '../state/tasks';
import { useUiStore } from '../state/ui';
import { dark, light, radius, space, TAP, type, type ThemePalette } from '../theme/tokens';
import type { TaskInstance } from '../db/types';
import { localDateString } from '../db/time';
import { PressableScale } from './PressableScale';

interface Props {
  /** Null = hidden. */
  instance: TaskInstance | null;
  /** Open directly on the reschedule step (used by swipe-left "Move"). */
  initialView?: 'menu' | 'reschedule';
  onClose: () => void;
  onEdit: (instance: TaskInstance) => void;
}

type SheetView = 'menu' | 'reschedule';

export function TaskActionSheet({ instance, initialView = 'menu', onClose, onEdit }: Props) {
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const duplicateTask = useTasksStore((s) => s.duplicateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const rescheduleTask = useTasksStore((s) => s.rescheduleTask);

  const [view, setView] = useState<SheetView>(initialView);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickDate, setPickDate] = useState(false);

  const enterY = useRef(new Animated.Value(420)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!instance) return;
    setView(initialView);
    setConfirmDelete(false);
    setPickDate(false);
    enterY.setValue(420);
    dragY.setValue(0);
    Animated.timing(enterY, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [instance, initialView, enterY, dragY]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.9) {
          Animated.timing(dragY, {
            toValue: 420,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            dragY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  if (!instance) return null;

  const handleDuplicate = async () => {
    await duplicateTask(instance.id);
    onClose();
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteTask(instance.id);
    onClose();
  };

  const handleDatePicked = async (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickDate(false);
    if (event.type === 'set' && selected) {
      const y = selected.getFullYear();
      const m = String(selected.getMonth() + 1).padStart(2, '0');
      const d = String(selected.getDate()).padStart(2, '0');
      const target = `${y}-${m}-${d}`;
      if (target >= localDateString()) {
        await rescheduleTask(instance.id, target);
        onClose();
      }
    }
  };

  const dateValue = (() => {
    const [y, m, d] = instance.date.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  })();

  return (
    <Modal
      visible={!!instance}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close task menu"
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.bg,
              borderColor: theme.border,
              transform: [{ translateY: Animated.add(enterY, dragY) }],
            },
          ]}
        >
          <View style={styles.handleZone} {...panResponder.panHandlers}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={[styles.h3, { color: theme.text }]} numberOfLines={1}>
                  {instance.title}
                </Text>
                <Text style={[styles.small, { color: theme.textFaint }]}>
                  {instance.date}
                  {instance.alarmTime ? ` · ${instance.alarmTime}` : ''}
                </Text>
              </View>
              <PressableScale
                onPress={onClose}
                style={[styles.closeBtn, { borderColor: theme.border }]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X color={theme.textDim} size={20} strokeWidth={2} />
              </PressableScale>
            </View>
          </View>

          {view === 'menu' ? (
            <View style={styles.actions}>
              <MenuRow
                theme={theme}
                icon={<Pencil color={theme.text} size={20} strokeWidth={2} />}
                label="Edit"
                hint="Change title, time, priority"
                onPress={() => onEdit(instance)}
              />
              <MenuRow
                theme={theme}
                icon={<Copy color={theme.text} size={20} strokeWidth={2} />}
                label="Duplicate"
                hint="Copy as a new task"
                onPress={() => void handleDuplicate()}
              />
              <MenuRow
                theme={theme}
                icon={<CalendarDays color={theme.text} size={20} strokeWidth={2} />}
                label="Reschedule"
                hint="Move to another day"
                onPress={() => setView('reschedule')}
              />
              <MenuRow
                theme={theme}
                icon={<Trash2 color={confirmDelete ? '#fff' : theme.danger} size={20} strokeWidth={2} />}
                label={confirmDelete ? 'Tap again to confirm' : 'Delete'}
                hint={confirmDelete ? 'This cannot be undone' : 'Soft delete — stays in history'}
                danger
                active={confirmDelete}
                onPress={() => void handleDelete()}
              />
            </View>
          ) : (
            <View style={styles.actions}>
              <Text style={[styles.small, { color: theme.textDim, paddingHorizontal: space(2) }]}>
                Move “{instance.title}” to:
              </Text>
              <PressableScale
                onPress={() => setPickDate(true)}
                style={[styles.dateBtn, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
              >
                <CalendarDays color={theme.accent} size={20} strokeWidth={2} />
                <Text style={[styles.body, { color: theme.text }]}>Pick a date</Text>
              </PressableScale>
              {pickDate && (
                <DateTimePicker
                  value={dateValue}
                  mode="date"
                  minimumDate={new Date()}
                  display={Platform.OS === 'android' ? 'default' : 'spinner'}
                  onChange={(e, d) => void handleDatePicked(e, d)}
                />
              )}
              <PressableScale
                onPress={() => setView('menu')}
                style={styles.backRow}
                hitSlop={8}
              >
                <Text style={[styles.small, { color: theme.textFaint }]}>Back to menu</Text>
              </PressableScale>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function MenuRow({
  theme,
  icon,
  label,
  hint,
  onPress,
  danger = false,
  active = false,
}: {
  theme: ThemePalette;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onPress: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.menuRow,
        {
          borderColor: theme.border,
        },
      ]}
      innerStyle={{
        backgroundColor: active ? theme.danger : 'transparent',
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(2),
        borderRadius: radius.md,
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.iconBox,
          { backgroundColor: active ? 'rgba(255,255,255,0.15)' : theme.surface2 },
        ]}
      >
        {icon}
      </View>
      <View style={styles.menuText}>
        <Text
          style={[
            styles.body,
            { color: active ? '#fff' : danger ? theme.danger : theme.text },
          ]}
        >
          {label}
        </Text>
        <Text style={[styles.small, { color: active ? 'rgba(255,255,255,0.8)' : theme.textFaint }]}>
          {hint}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
    paddingBottom: space(4),
  },
  handleZone: { paddingTop: space(1.5) },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space(1),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    paddingHorizontal: space(2),
    paddingBottom: space(1),
  },
  headerText: { flex: 1, gap: space(0.25) },
  h3: { ...type.h3 },
  body: { ...type.body },
  small: { ...type.small },
  closeBtn: {
    width: TAP,
    height: TAP,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { gap: space(0.5), paddingBottom: space(1) },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
    minHeight: TAP + 8,
  },
  iconBox: {
    width: TAP,
    height: TAP,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: { flex: 1, gap: space(0.25) },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    marginHorizontal: space(2),
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: TAP + 8,
  },
  backRow: {
    alignSelf: 'center',
    paddingVertical: space(1.5),
    paddingHorizontal: space(2),
  },
});
