import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTasksDb, useTasksStore } from '../state/tasks';
import { useUiStore } from '../state/ui';
import { dark, light, type, space, TAP, radius, type ThemePalette } from '../theme/tokens';
import { listCategories } from '../db/repos/categories';
import { createTemplate } from '../db/repos/templates';
import { createInstance } from '../db/repos/instances';
import { TaskForm, type TaskFormValues } from '../components/TaskForm';
import type { Category } from '../db/types';

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * Modal quick-add: one screen that creates both the repeating template
 * and the concrete instance for the chosen day.
 */
export default function AddTask() {
  const db = useTasksDb();
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const refresh = useTasksStore((s) => s.refresh);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cats = await listCategories(db);
        if (!cancelled) setCategories(cats);
      } catch (e) {
        console.error('[add-task] load categories failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

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
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={[styles.h1, { color: theme.text }]}>New task</Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.closeBtn, { borderColor: theme.border }]}
            hitSlop={8}
          >
            <Text style={[styles.small, { color: theme.textDim }]}>Cancel</Text>
          </Pressable>
        </View>

        <TaskForm
          categories={categories}
          showInstanceDate
          submitLabel="Add task"
          onSubmit={submit}
        />
        {error && <Text style={[styles.small, { color: theme.danger }]}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: space(2), gap: space(2), paddingBottom: space(6) },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  h1: { ...type.h1 },
  small: { ...type.small },
  closeBtn: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: TAP,
    justifyContent: 'center',
  },
});
