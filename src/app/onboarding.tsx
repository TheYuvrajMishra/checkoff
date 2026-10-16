import { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PressableScale } from '../components/PressableScale';
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
      <View style={styles.progressWrap}>
        <ProgressBar theme={theme} step={step} total={STEPS.length} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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

/** Visual step progress: bar + labels. */
function ProgressBar({ theme, step, total }: { theme: ThemePalette; step: number; total: number }) {
  return (
    <View style={styles.progressInner}>
      <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
        <View
          style={[
            styles.progressFill,
            { backgroundColor: theme.accent, width: `${((step + 1) / total) * 100}%` },
          ]}
        />
      </View>
      <Text style={[styles.progressLabel, { color: theme.textFaint }]}>
        {step + 1} of {total}
      </Text>
    </View>
  );
}

function StepHeader({
  theme,
  eyebrow,
  title,
  subtitle,
}: {
  theme: ThemePalette;
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.stepHeader}>
      <Text style={[styles.eyebrow, { color: theme.accent }]}>{eyebrow}</Text>
      <Text style={[styles.h1, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.body, { color: theme.textDim }]}>{subtitle}</Text>
    </View>
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
        <PressableScale onPress={onBack} style={[styles.navBtn, styles.navSecondary, { borderColor: theme.border }]}>
          <Text style={[styles.navSecondaryText, { color: theme.text }]}>Back</Text>
        </PressableScale>
      )}
      <PressableScale
        onPress={onNext}
        disabled={nextDisabled}
        style={[
          styles.navBtn,
          styles.navPrimary,
          { backgroundColor: theme.accent, opacity: nextDisabled ? 0.45 : 1 },
        ]}
      >
        <Text style={[styles.navPrimaryText, { color: theme.onAccent }]}>{nextLabel}</Text>
      </PressableScale>
    </View>
  );
}

function WelcomeStep({ theme, onNext }: { theme: ThemePalette; onNext: () => void }) {
  const features = [
    { title: 'Rituals & tasks', desc: 'Define daily anchors and one-off work. Alarms keep you honest.' },
    { title: 'Streaks & analytics', desc: 'Completion rates, heatmaps, and weekly reviews show the trend.' },
    { title: 'Skill rotation', desc: 'Mark categories as rotation pools — CheckOff surfaces what needs practice.' },
    { title: 'Private by design', desc: 'No account, no cloud. Everything stays on this device.' },
  ];
  return (
    <View style={styles.stepBody}>
      <View style={styles.hero}>
        <View style={[styles.logoMark, { backgroundColor: theme.accent }]}>
          <Text style={[styles.logoCheck, { color: theme.onAccent }]}>✓</Text>
        </View>
        <Text style={[styles.display, { color: theme.text }]}>CheckOff</Text>
        <Text style={[styles.tagline, { color: theme.textDim }]}>
          The discipline instrument for people who keep their own score.
        </Text>
      </View>

      <View style={styles.featureList}>
        {features.map((f) => (
          <View key={f.title} style={styles.featureRow}>
            <View style={[styles.featureDot, { backgroundColor: theme.accent }]} />
            <View style={styles.featureText}>
              <Text style={[styles.h3, { color: theme.text }]}>{f.title}</Text>
              <Text style={[styles.small, { color: theme.textDim }]}>{f.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.noteCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.small, { color: theme.textDim }]}>
          Setup takes about three minutes: your categories, your tasks, then
          you are running. Nothing is uploaded or shared.
        </Text>
      </View>

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
      <StepHeader
        theme={theme}
        eyebrow="Step 2 · Categories"
        title="Your arenas"
        subtitle="Categories group your work. Mark one as a rotation pool and CheckOff will surface its least-practiced skill each day."
      />

      {categories.length === 0 && (
        <View style={[styles.emptyCard, { borderColor: theme.border }]}>
          <Text style={[styles.body, { color: theme.textDim, textAlign: 'center' }]}>
            No categories yet. Add your first one below — e.g. Fitness, Deep work, Languages.
          </Text>
        </View>
      )}

      {categories.map((c) => {
        const skills = skillsByCat[c.id] ?? [];
        const isOpen = expanded === c.id;
        return (
          <View key={c.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.catHeader}>
              <View style={[styles.dot, { backgroundColor: categoryColor(c.colorToken) }]} />
              <Text style={[styles.h3, { color: theme.text, flex: 1 }]}>{c.name}</Text>
              <PressableScale
                onPress={() => setExpanded(isOpen ? null : c.id)}
                style={[styles.miniBtn, { borderColor: theme.border }]}
              >
                <Text style={[styles.small, { color: theme.textDim }]}>
                  {isOpen ? 'Hide' : `Skills (${skills.length})`}
                </Text>
              </PressableScale>
            </View>
            <View style={styles.toggleRow}>
              <View>
                <Text style={[styles.small, { color: theme.text }]}>Skill rotation pool</Text>
                <Text style={[styles.caption, { color: theme.textFaint }]}>Surface least-practiced daily</Text>
              </View>
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
                  <View key={s.id} style={[styles.skillChip, { backgroundColor: theme.surface2 }]}>
                    <Text style={[styles.small, { color: theme.text }]}>{s.name}</Text>
                  </View>
                ))}
                <View style={styles.skillAddRow}>
                  <TextInput
                    value={skillName}
                    onChangeText={setSkillName}
                    placeholder="New skill"
                    placeholderTextColor={theme.textFaint}
                    style={[styles.input, styles.skillInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface2 }]}
                  />
                  <PressableScale
                    onPress={() => addSkill(c.id)}
                    style={[styles.miniBtn, { borderColor: theme.border }]}
                  >
                    <Text style={[styles.small, { color: theme.text }]}>Add</Text>
                  </PressableScale>
                </View>
              </View>
            )}
          </View>
        );
      })}

      <View style={[styles.formCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.eyebrow, { color: theme.textFaint }]}>New category</Text>
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
        <PressableScale onPress={add} style={[styles.addBtn, { backgroundColor: theme.accent }]}>
          <Text style={[styles.body, { color: theme.onAccent, fontWeight: '600' }]}>Add category</Text>
        </PressableScale>
        {error && <Text style={[styles.small, { color: theme.danger }]}>{error}</Text>}
      </View>

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
      <StepHeader
        theme={theme}
        eyebrow="Step 3 · Tasks"
        title="Your commitments"
        subtitle="Add at least one recurring task or one-off. Rituals are your non-negotiable daily anchors."
      />

      {templates.length === 0 && (
        <View style={[styles.emptyCard, { borderColor: theme.border }]}>
          <Text style={[styles.body, { color: theme.textDim, textAlign: 'center' }]}>
            No tasks yet. Add your first commitment below.
          </Text>
        </View>
      )}

      {templates.map((t) => (
        <View key={t.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.taskHeader}>
            <Text style={[styles.body, { color: theme.text, fontWeight: '600', flex: 1 }]}>{t.title}</Text>
            {t.isRitual && (
              <View style={[styles.ritualBadge, { backgroundColor: theme.accentDim }]}>
                <Text style={[styles.caption, { color: theme.accent }]}>Ritual</Text>
              </View>
            )}
          </View>
          <Text style={[styles.small, { color: theme.textDim }]}>
            {t.recurrence}
            {t.alarmTime ? ` · ${t.alarmTime}` : ''}
            {` · ${t.durationMin} min`}
          </Text>
        </View>
      ))}

      <View style={[styles.formCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.eyebrow, { color: theme.textFaint }]}>New task</Text>
        <TaskForm
          key={formKey}
          categories={categories}
          showInstanceDate={false}
          submitLabel="Add task"
          onSubmit={submit}
        />
        {error && <Text style={[styles.small, { color: theme.danger }]}>{error}</Text>}
      </View>

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
      <View style={styles.hero}>
        <View style={[styles.logoMark, { backgroundColor: theme.accent }]}>
          <Text style={[styles.logoCheck, { color: theme.onAccent }]}>✓</Text>
        </View>
        <Text style={[styles.h1, { color: theme.text, textAlign: 'center' }]}>You are set up</Text>
        <Text style={[styles.body, { color: theme.textDim, textAlign: 'center' }]}>
          Your system is live. Show up, check off, repeat.
        </Text>
      </View>

      <View style={[styles.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={[styles.h1, { color: theme.text }]}>{categories.length}</Text>
            <Text style={[styles.caption, { color: theme.textFaint }]}>CATEGORIES</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
          <View style={styles.summaryCell}>
            <Text style={[styles.h1, { color: theme.text }]}>{templates.length}</Text>
            <Text style={[styles.caption, { color: theme.textFaint }]}>TASKS</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
          <View style={styles.summaryCell}>
            <Text style={[styles.h1, { color: theme.text }]}>{rituals}</Text>
            <Text style={[styles.caption, { color: theme.textFaint }]}>RITUALS</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.small, { color: theme.textDim, textAlign: 'center' }]}>
        Your day starts at your first alarm — or right now, from the Today tab.
      </Text>

      <NavButtons theme={theme} onBack={onBack} onNext={onFinish} nextLabel="Start" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  progressWrap: { paddingHorizontal: space(3), paddingTop: space(2), paddingBottom: space(1) },
  progressInner: { gap: space(1) },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  progressLabel: { ...type.caption, textAlign: 'right' },
  scroll: { padding: space(3), gap: space(3), paddingBottom: space(8) },
  stepBody: { gap: space(3) },
  stepHeader: { gap: space(1) },
  eyebrow: { ...type.caption, textTransform: 'uppercase', letterSpacing: 1.2 },
  display: { ...type.display },
  h1: { ...type.h1 },
  h3: { ...type.h3 },
  body: { ...type.body },
  small: { ...type.small },
  caption: { ...type.caption },
  tagline: { ...type.body, marginTop: space(1) },

  hero: { alignItems: 'center', gap: space(1.5), paddingVertical: space(2) },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(1),
  },
  logoCheck: { fontSize: 36, fontWeight: '700' },

  featureList: { gap: space(2.5) },
  featureRow: { flexDirection: 'row', gap: space(2), alignItems: 'flex-start' },
  featureDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  featureText: { flex: 1, gap: space(0.5) },

  noteCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
  },
  emptyCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: space(3),
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
    gap: space(1.5),
  },
  formCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
    gap: space(2),
  },
  catHeader: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 12, height: 12, borderRadius: 6 },
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
  skillChip: {
    borderRadius: radius.sm,
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.75),
    alignSelf: 'flex-start',
  },
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
    borderRadius: radius.md,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  ritualBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: space(1),
    paddingVertical: space(0.5),
  },

  summaryCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryCell: { flex: 1, alignItems: 'center', gap: space(0.5) },
  summaryDivider: { width: 1, height: 40 },

  navRow: { flexDirection: 'row', gap: space(1.5), marginTop: space(1) },
  navBtn: {
    flex: 1,
    borderRadius: radius.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navSecondary: { borderWidth: 1 },
  navSecondaryText: { fontSize: 16, fontWeight: '600' },
  navPrimary: { borderWidth: 0 },
  navPrimaryText: { fontSize: 16, fontWeight: '700' },
});
