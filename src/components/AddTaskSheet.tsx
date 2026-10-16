/**
 * CheckOff — reusable add-task bottom sheet.
 *
 * Wraps the existing TaskForm in a bottom sheet (transparent Modal, slide-up).
 * On submit it creates both the repeating template and the concrete instance
 * for the chosen day (same logic as the add-task screen), then refreshes the
 * tasks store and notifies the parent via onAdded.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useTasksDb, useTasksStore } from '../state/tasks';
import { useUiStore } from '../state/ui';
import { dark, light, radius, space, TAP, type, type ThemePalette } from '../theme/tokens';
import { listCategories } from '../db/repos/categories';
import { createTemplate } from '../db/repos/templates';
import { createInstance } from '../db/repos/instances';
import { localDateString } from '../db/time';
import { TaskForm, type TaskFormValues } from './TaskForm';
import type { Category } from '../db/types';

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Prefill the form's date. Defaults to today. */
  initialDate?: string;
  /** Called with the chosen date after a task was added. */
  onAdded?: (date: string) => void;
}

export function AddTaskSheet({ visible, onClose, initialDate, onAdded }: Props) {
  const db = useTasksDb();
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const refresh = useTasksStore((s) => s.refresh);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  // Entrance slide + drag-down-to-dismiss offset (native driver).
  const enterY = useRef(new Animated.Value(560)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setBusy(false);
    setFormKey((k) => k + 1);
    enterY.setValue(560);
    dragY.setValue(0);
    Animated.timing(enterY, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
    let cancelled = false;
    (async () => {
      try {
        const cats = await listCategories(db);
        if (!cancelled) setCategories(cats);
      } catch (e) {
        console.error('[add-task-sheet] load categories failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, db, enterY, dragY]);

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
            toValue: 560,
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

  const submit = async (v: TaskFormValues) => {
    if (busy) return;
    setBusy(true);
    try {
      const template = await createTemplate(db, {
        title: v.title,
        categoryId: v.categoryId,
        durationMin: v.durationMin,
        recurrence: v.recurrence,
        customDays: v.customDays,
        // A one-off fires on the day the user picked.
        targetDate: v.recurrence === 'once' ? v.date : null,
        alarmTime: v.alarmEnabled ? `${pad2(v.hour)}:${pad2(v.minute)}` : null,
        isRitual: v.isRitual,
      });
      await createInstance(db, {
        templateId: template.id,
        date: v.date,
        title: v.title,
        categoryId: v.categoryId,
        durationMin: v.durationMin,
        alarmTime: v.alarmEnabled ? `${pad2(v.hour)}:${pad2(v.minute)}` : null,
        isRitual: v.isRitual,
      });
      setError(null);
      await refresh(v.date);
      onAdded?.(v.date);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
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
          accessibilityLabel="Close add task sheet"
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
              <Text style={[styles.h2, { color: theme.text }]}>New task</Text>
              <Pressable
                onPress={onClose}
                style={[styles.closeBtn, { borderColor: theme.border }]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X color={theme.textDim} size={20} strokeWidth={2} />
              </Pressable>
            </View>
          </View>
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <TaskForm
              key={formKey}
              categories={categories}
              showInstanceDate
              initialDate={initialDate ?? localDateString()}
              submitLabel={busy ? 'Adding…' : 'Add task'}
              onSubmit={submit}
            />
            {error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    borderTopWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  handleZone: {
    paddingTop: space(1.5),
  },
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
    justifyContent: 'space-between',
    paddingHorizontal: space(2),
    paddingBottom: space(1),
  },
  h2: { ...type.h2 },
  closeBtn: {
    width: TAP,
    height: TAP,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: space(2),
    paddingBottom: space(4),
  },
  error: { ...type.small, marginTop: space(1) },
});
