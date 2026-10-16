/**
 * CheckOff — reusable add/edit-task bottom sheet.
 *
 * Uses the velocity-aware Sheet component (drag-to-dismiss, backdrop fade,
 * keyboard-aware). Persists optional notes in the meta table so the DB
 * schema stays untouched.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTasksDb, useTasksStore } from '../state/tasks';
import { useUiStore } from '../state/ui';
import { dark, light, space, type, type ThemePalette } from '../theme/tokens';
import { listCategories } from '../db/repos/categories';
import { createTemplate } from '../db/repos/templates';
import { createInstance, type InstancePatch, type TaskInstanceEx } from '../db/repos/instances';
import { getMeta, setMeta } from '../db/repos/meta';
import { localDateString } from '../db/time';
import { TaskForm, type TaskFormValues } from './TaskForm';
import type { Category } from '../db/types';
import { Sheet } from './Sheet';
import { scheduleTaskAlarm } from '../notifications';

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Prefill the form's date. Defaults to today. */
  initialDate?: string;
  /** Alias for initialDate used by Calendar / Day detail views. */
  defaultDate?: string;
  /** Edit mode: prefill the form from this instance and update it on submit. */
  editing?: TaskInstanceEx | null;
  /** Called with the chosen date after a task was added. */
  onAdded?: (date: string) => void;
  /** Called after an edit was saved. */
  onEdited?: () => void;
}

function alarmToHourMin(alarmTime: string | null): { hour: number; minute: number } {
  if (!alarmTime) return { hour: 9, minute: 0 };
  const m = /^(\d{2}):(\d{2})$/.exec(alarmTime);
  if (!m) return { hour: 9, minute: 0 };
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function AddTaskSheet({
  visible,
  onClose,
  initialDate,
  defaultDate,
  editing,
  onAdded,
  onEdited,
}: Props) {
  const db = useTasksDb();
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const refresh = useTasksStore((s) => s.refresh);
  const updateTask = useTasksStore((s) => s.updateTask);
  const [categories, setCategories] = useState<Category[]>([]);
  const [existingNotes, setExistingNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const isEditing = !!editing;
  const resolvedInitialDate = initialDate ?? defaultDate ?? localDateString();

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setBusy(false);
    let cancelled = false;
    (async () => {
      try {
        const cats = await listCategories(db);
        const noteVal = editing ? await getMeta(db, `note:${editing.id}`) : null;
        if (!cancelled) {
          setCategories(cats);
          setExistingNotes(noteVal ?? '');
          setFormKey((k) => k + 1);
        }
      } catch (e) {
        console.error('[add-task-sheet] load failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, db, editing]);

  const initialValues: Partial<TaskFormValues> | undefined = editing
    ? (() => {
        const { hour, minute } = alarmToHourMin(editing.alarmTime);
        return {
          title: editing.title,
          categoryId: editing.categoryId,
          recurrence: 'once' as const,
          customDays: [],
          date: editing.date,
          alarmEnabled: editing.alarmTime !== null,
          hour,
          minute,
          durationMin: editing.durationMin,
          isRitual: editing.isRitual,
          priority: editing.priority ?? 'medium',
          notes: existingNotes,
        };
      })()
    : undefined;

  const submit = async (v: TaskFormValues) => {
    if (busy) return;
    setBusy(true);
    try {
      if (editing) {
        const patch: InstancePatch = {
          title: v.title,
          categoryId: v.categoryId,
          durationMin: v.durationMin,
          alarmTime: v.alarmEnabled ? `${pad2(v.hour)}:${pad2(v.minute)}` : null,
          priority: v.priority,
        };
        await updateTask(editing.id, patch);
        if (v.notes !== undefined) {
          await setMeta(db, `note:${editing.id}`, v.notes);
        }
        setError(null);
        onEdited?.();
        onClose();
        return;
      }

      const template = await createTemplate(db, {
        title: v.title,
        categoryId: v.categoryId,
        durationMin: v.durationMin,
        recurrence: v.recurrence,
        customDays: v.customDays,
        targetDate: v.recurrence === 'once' ? v.date : null,
        alarmTime: v.alarmEnabled ? `${pad2(v.hour)}:${pad2(v.minute)}` : null,
        isRitual: v.isRitual,
        priority: v.priority,
      });
      const instance = await createInstance(db, {
        templateId: template.id,
        date: v.date,
        title: v.title,
        categoryId: v.categoryId,
        durationMin: v.durationMin,
        alarmTime: v.alarmEnabled ? `${pad2(v.hour)}:${pad2(v.minute)}` : null,
        isRitual: v.isRitual,
        priority: v.priority,
      });
      if (instance.alarmTime) {
        await scheduleTaskAlarm(db, instance).catch(() => {});
      }
      if (v.notes) {
        await setMeta(db, `note:${instance.id}`, v.notes);
      }
      setError(null);
      await refresh(v.date);
      onAdded?.(v.date);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={isEditing ? 'Edit Task' : 'New Task'}
      maxHeightPct={0.9}
    >
      <View style={styles.body}>
        <TaskForm
          key={formKey}
          categories={categories}
          showInstanceDate={!isEditing}
          initialDate={resolvedInitialDate}
          initialValues={initialValues}
          submitLabel={
            isEditing
              ? busy
                ? 'Saving…'
                : 'Save Changes'
              : busy
              ? 'Creating…'
              : 'Create Task'
          }
          onSubmit={submit}
        />
        {error && <Text style={[styles.error, { color: theme.text }]}>{error}</Text>}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingTop: space(1),
  },
  error: {
    ...type.small,
    marginTop: space(1),
  },
});
