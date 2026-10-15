import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTasksDb } from '../state/tasks';
import { useUiStore } from '../state/ui';
import { dark, light, categoryColor, type, radius, space, TAP, type ThemePalette } from '../theme/tokens';
import { createCategory, listCategories, updateCategory } from '../db/repos/categories';
import { createSkill, listSkills } from '../db/repos/skills';
import { createTemplate, listTemplates } from '../db/repos/templates';
import { META_KEYS, setMeta } from '../db/repos/meta';
import { TaskForm, ColorTokenPicker, type TaskFormValues } from '../components/TaskForm';
import type { Category, Skill, TaskTemplate } from '../db/types';

const STEPS = ['Welcome', 'Categories', 'Tasks', 'Done'] as const;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export default function Onboarding() {
  const db = useTasksDb();
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const [step, setStep] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [skillsByCat, setSkillsByCat] = useState<Record<string, Skill[]>>({});
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);

  const reload = useCallback(async () => {
    const cats = await listCategories(db);
    setCategories(cats);
    const map: Record<string, Skill[]> = {};
    for (const c of cats) {
      map[c.id] = await listSkills(db, c.id);
    }
    setSkillsByCat(map);
    setTemplates(await listTemplates(db));
  }, [db]);

  const next = async () => {
    await reload();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const finish = async () => {
    await setMeta(db, META_KEYS.onboarded, '1');
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.stepLabel, { color: theme.textFaint }]}>
          STEP {step + 1} OF {STEPS.length} · {STEPS[step].toUpperCase()}
        </Text>

        {step === 0 && <WelcomeStep theme={theme} onNext={next} />}
        {step === 1 && (
          <CategoriesStep
            theme={theme}
            db={db}
            categories={categories}
            skillsByCat={skillsByCat}
            onReload={reload}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 2 && (
          <TasksStep
            theme={theme}
            db={db}
            categories={categories}
            templates={templates}
            onReload={reload}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 3 && (
          <DoneStep
            theme={theme}
            categories={categories}
            templates={templates}
            onReload={reload}
            onBack={back}
            onFinish={finish}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function NavButtons({
  theme,
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
}: {
  theme: ThemePalette;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <View style={styles.navRow}>
      {onBack && (
        <Pressable onPress={onBack} style={[styles.navBtn, { borderColor: theme.border }]}>
          <Text style={[styles.body, { color: theme.text }]}>Back</Text>
        </Pressable>
      )}
      <Pressable
        onPress={onNext}
        disabled={nextDisabled}
        style={[
          styles.navBtn,
          styles.navPrimary,
          { backgroundColor: theme.accent, opacity: nextDisabled ? 0.4 : 1 },
        ]}
      >
        <Text style={[styles.navPrimaryText, { color: theme.onAccent }]}>{nextLabel}</Text>
      </Pressable>
    </View>
  );
}

function WelcomeStep({ theme, onNext }: { theme: ThemePalette; onNext: () => void }) {
  return (
    <View style={styles.stepBody}>
      <Text style={[styles.display, { color: theme.text }]}>CheckOff</Text>
      <Text style={[styles.body, { color: theme.textDim }]}>
        A discipline instrument. You define your rituals, tasks, and the skills
        you are building. CheckOff keeps the score, tracks your streaks, and
        rotates what you practice — no accounts, no cloud, everything stays on
        this device.
      </Text>
      <Text style={[styles.body, { color: theme.textDim }]}>
        Three minutes of setup: your categories, your tasks, and you are
        running. Nothing here is shared or uploaded.
      </Text>
      <NavButtons theme={theme} onNext={onNext} nextLabel="Begin setup" />
    </View>
  );
}

function CategoriesStep({
  theme,
  db,
  categories,
  skillsByCat,
  onReload,
  onNext,
  onBack,
}: {
  theme: ThemePalette;
  db: Parameters<typeof createCategory>[0];
  categories: Category[];
  skillsByCat: Record<string, Skill[]>;
  onReload: () => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('slate');
  const [rotation, setRotation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [skillName, setSkillName] = useState('');

  const add = async () => {
    try {
      await createCategory(db, { name, colorToken: token, rotationEnabled: rotation });
      setName('');
      setRotation(false);
      setError(null);
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add category.');
    }
  };

  const toggleRotation = async (c: Category) => {
    await updateCategory(db, c.id, { rotationEnabled: !c.rotationEnabled });
    await onReload();
  };

  const addSkill = async (categoryId: string) => {
    try {
      await createSkill(db, { categoryId, name: skillName });
      setSkillName('');
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add skill.');
    }
  };

  return (
    <View style={styles.stepBody}>
      <Text style={[styles.h1, { color: theme.text }]}>Your arenas</Text>
      <Text style={[styles.body, { color: theme.textDim }]}>
        Categories group your work. Mark a category as a rotation pool and
        CheckOff will surface its least-practiced skill every day.
      </Text>

      {categories.map((c) => {
        const skills = skillsByCat[c.id] ?? [];
        const isOpen = expanded === c.id;
        return (
          <View key={c.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.catHeader}>
              <View style={[styles.dot, { backgroundColor: categoryColor(c.colorToken) }]} />
              <Text style={[styles.h3, { color: theme.text, flex: 1 }]}>{c.name}</Text>
              <Pressable
                onPress={() => setExpanded(isOpen ? null : c.id)}
                style={[styles.miniBtn, { borderColor: theme.border }]}
              >
                <Text style={[styles.small, { color: theme.textDim }]}>
                  {isOpen ? 'Hide' : `Skills (${skills.length})`}
                </Text>
              </Pressable>
            </View>
            <View style={styles.toggleRow}>
              <Text style={[styles.small, { color: theme.textDim }]}>Skill rotation pool</Text>
              <Switch
                value={c.rotationEnabled}
                onValueChange={() => toggleRotation(c)}
                trackColor={{ true: theme.accent, false: theme.border }}
                thumbColor={theme.onAccent}
              />
            </View>
            {isOpen && (
              <View style={styles.skillsBox}>
                {skills.map((s) => (
                  <Text key={s.id} style={[styles.small, { color: theme.text }]}>
                    · {s.name}
                  </Text>
                ))}
                <View style={styles.skillAddRow}>
                  <TextInput
                    value={skillName}
                    onChangeText={setSkillName}
                    placeholder="New skill"
                    placeholderTextColor={theme.textFaint}
                    style={[styles.input, styles.skillInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface2 }]}
                  />
                  <Pressable
                    onPress={() => addSkill(c.id)}
                    style={[styles.miniBtn, { borderColor: theme.border }]}
                  >
                    <Text style={[styles.small, { color: theme.text }]}>Add</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        );
      })}

      <Text style={[styles.caption, { color: theme.textFaint }]}>ADD CATEGORY</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Fitness, Deep work, Languages"
        placeholderTextColor={theme.textFaint}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface2 }]}
      />
      <ColorTokenPicker theme={theme} selected={token} onSelect={setToken} />
      <View style={styles.toggleRow}>
        <Text style={[styles.small, { color: theme.textDim }]}>Include in skill rotation</Text>
        <Switch
          value={rotation}
          onValueChange={setRotation}
          trackColor={{ true: theme.accent, false: theme.border }}
          thumbColor={theme.onAccent}
        />
      </View>
      <Pressable onPress={add} style={[styles.addBtn, { borderColor: theme.border }]}>
        <Text style={[styles.body, { color: theme.text }]}>Add category</Text>
      </Pressable>
      {error && <Text style={[styles.small, { color: theme.danger }]}>{error}</Text>}

      <NavButtons
        theme={theme}
        onBack={onBack}
        onNext={onNext}
        nextDisabled={categories.length === 0}
        nextLabel={categories.length === 0 ? 'Add a category to continue' : 'Continue'}
      />
    </View>
  );
}

function TasksStep({
  theme,
  db,
  categories,
  templates,
  onReload,
  onNext,
  onBack,
}: {
  theme: ThemePalette;
  db: Parameters<typeof createTemplate>[0];
  categories: Category[];
  templates: TaskTemplate[];
  onReload: () => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const submit = async (v: TaskFormValues) => {
    try {
      await createTemplate(db, {
        title: v.title,
        categoryId: v.categoryId,
        durationMin: v.durationMin,
        recurrence: v.recurrence,
        customDays: v.customDays,
        targetDate: v.recurrence === 'once' ? v.date : null,
        alarmTime: v.alarmEnabled ? `${pad2(v.hour)}:${pad2(v.minute)}` : null,
        isRitual: v.isRitual,
      });
      setError(null);
      setFormKey((k) => k + 1);
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add task.');
    }
  };

  return (
    <View style={styles.stepBody}>
      <Text style={[styles.h1, { color: theme.text }]}>Your commitments</Text>
      <Text style={[styles.body, { color: theme.textDim }]}>
        Add at least one recurring task or one-off. Rituals are your
        non-negotiable daily anchors.
      </Text>

      {templates.map((t) => (
        <View key={t.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.body, { color: theme.text }]}>{t.title}</Text>
          <Text style={[styles.small, { color: theme.textDim }]}>
            {t.recurrence}
            {t.alarmTime ? ` · ${t.alarmTime}` : ''}
            {t.isRitual ? ' · ritual' : ''} · {t.durationMin} min
          </Text>
        </View>
      ))}

      <Text style={[styles.caption, { color: theme.textFaint }]}>ADD TASK</Text>
      <TaskForm
        key={formKey}
        categories={categories}
        showInstanceDate={false}
        submitLabel="Add task"
        onSubmit={submit}
      />
      {error && <Text style={[styles.small, { color: theme.danger }]}>{error}</Text>}

      <NavButtons
        theme={theme}
        onBack={onBack}
        onNext={onNext}
        nextDisabled={templates.length === 0}
        nextLabel={templates.length === 0 ? 'Add a task to continue' : 'Continue'}
      />
    </View>
  );
}

function DoneStep({
  theme,
  categories,
  templates,
  onReload,
  onBack,
  onFinish,
}: {
  theme: ThemePalette;
  categories: Category[];
  templates: TaskTemplate[];
  onReload: () => Promise<void>;
  onBack: () => void;
  onFinish: () => void;
}) {
  useEffect(() => {
    void onReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rituals = templates.filter((t) => t.isRitual).length;
  return (
    <View style={styles.stepBody}>
      <Text style={[styles.h1, { color: theme.text }]}>Ready</Text>
      <Text style={[styles.body, { color: theme.textDim }]}>
        {categories.length} {categories.length === 1 ? 'category' : 'categories'} ·{' '}
        {templates.length} {templates.length === 1 ? 'task' : 'tasks'}
        {rituals > 0 ? ` (${rituals} ${rituals === 1 ? 'ritual' : 'rituals'})` : ''}.
        Your day starts tomorrow at your first alarm — or right now, if you
        add something for today.
      </Text>
      <NavButtons theme={theme} onBack={onBack} onNext={onFinish} nextLabel="Start" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: space(2), gap: space(2), paddingBottom: space(6) },
  stepLabel: { ...type.caption, textTransform: 'uppercase' },
  stepBody: { gap: space(2) },
  display: { ...type.display },
  h1: { ...type.h1 },
  h3: { ...type.h3 },
  body: { ...type.body },
  small: { ...type.small },
  caption: { ...type.caption, textTransform: 'uppercase' },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
    gap: space(1.5),
  },
  catHeader: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 10, height: 10, borderRadius: 5 },
  miniBtn: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space(1.5),
    minHeight: TAP,
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TAP,
    gap: space(2),
  },
  skillsBox: { gap: space(1), paddingTop: space(1) },
  skillAddRow: { flexDirection: 'row', gap: space(1), alignItems: 'center' },
  skillInput: { flex: 1 },
  input: {
    ...type.body,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: TAP,
  },
  addBtn: {
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRow: { flexDirection: 'row', gap: space(1.5), marginTop: space(1) },
  navBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.md,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navPrimary: { borderWidth: 0 },
  navPrimaryText: { fontSize: 16, fontWeight: '600' },
});
