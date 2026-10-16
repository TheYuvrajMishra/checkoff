import { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { useTasksDb, useTasksStore } from '../state/tasks';
import { useUiStore } from '../state/ui';
import { dark, light, type, space, TAP, radius, type ThemePalette } from '../theme/tokens';
import { listCategories } from '../db/repos/categories';
import { createTemplate } from '../db/repos/templates';
import { createInstance } from '../db/repos/instances';
import { setMeta } from '../db/repos/meta';
import { TaskForm, type TaskFormValues } from '../components/TaskForm';
import type { Category } from '../db/types';
import { MetallicText } from '../components/MetallicText';
import { PressableScale } from '../components/PressableScale';

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

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
      if (v.notes) {
        await setMeta(db, `note:${instance.id}`, v.notes);
      }
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
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <MetallicText style={styles.h1}>New Task</MetallicText>
          <PressableScale
            onPress={() => router.back()}
            style={styles.closeBtn}
            innerStyle={[
              styles.closeInner,
              { borderColor: theme.border, backgroundColor: theme.surface },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <X color={theme.textDim} size={18} strokeWidth={2} />
          </PressableScale>
        </View>

        <TaskForm
          categories={categories}
          showInstanceDate
          submitLabel={busy ? 'Creating…' : 'Create Task'}
          onSubmit={submit}
        />
        {error && <Text style={[styles.small, { color: theme.text }]}>{error}</Text>}
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
    width: TAP,
    height: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeInner: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
