import { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import {
  Check,
  Bell,
  Shield,
  Sliders,
  Plus,
  Layers,
  Sparkles,
  ArrowRight,
  ChevronLeft,
} from 'lucide-react-native';
import { PressableScale } from '../components/PressableScale';
import { MetallicText } from '../components/MetallicText';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Slider } from '../components/Slider';
import { Switch } from '../components/Switch';
import { useTasksDb } from '../state/tasks';
import {
  useUiStore,
  type ThemeMode,
  type HapticIntensity,
  type ClockFormat,
} from '../state/ui';
import {
  dark,
  light,
  type,
  radius,
  space,
  TAP,
  MOTION,
  type ThemePalette,
} from '../theme/tokens';
import { createCategory, listCategories, updateCategory } from '../db/repos/categories';
import { createSkill, listSkills } from '../db/repos/skills';
import { META_KEYS, setMeta } from '../db/repos/meta';
import { setupNotifications } from '../notifications';
import { hapticSelection, hapticSuccess } from '../haptics';
import type { Category, Skill } from '../db/types';

const STEPS = [
  { id: 'welcome', label: '01 · MANIFESTO' },
  { id: 'calibrate', label: '02 · CALIBRATION' },
  { id: 'arenas', label: '03 · ARENAS' },
  { id: 'ready', label: '04 · LAUNCH' },
] as const;

export default function Onboarding() {
  const db = useTasksDb();
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const themeMode = useUiStore((s) => s.themeMode);
  const setThemeMode = useUiStore((s) => s.setThemeMode);
  const hapticsEnabled = useUiStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useUiStore((s) => s.setHapticsEnabled);
  const hapticIntensity = useUiStore((s) => s.hapticIntensity);
  const setHapticIntensity = useUiStore((s) => s.setHapticIntensity);
  const clockFormat = useUiStore((s) => s.clockFormat);
  const setClockFormat = useUiStore((s) => s.setClockFormat);

  const [step, setStep] = useState(0);
  const [graceMin, setGraceMin] = useState(15);
  const [snoozeMin, setSnoozeMin] = useState(10);
  const [defaultFocusMin, setDefaultFocusMin] = useState(25);

  const [categories, setCategories] = useState<Category[]>([]);
  const [skillsByCat, setSkillsByCat] = useState<Record<string, Skill[]>>({});
  const [finishing, setFinishing] = useState(false);

  const reloadCategories = useCallback(async () => {
    try {
      const cats = await listCategories(db);
      setCategories(cats);
      const map: Record<string, Skill[]> = {};
      for (const c of cats) {
        map[c.id] = await listSkills(db, c.id);
      }
      setSkillsByCat(map);
    } catch {
      // ignore
    }
  }, [db]);

  useEffect(() => {
    void reloadCategories();
  }, [reloadCategories]);

  const goNext = () => {
    void hapticSelection();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    void hapticSelection();
    setStep((s) => Math.max(s - 1, 0));
  };

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await setMeta(db, META_KEYS.graceMin, String(graceMin));
      await setMeta(db, META_KEYS.snoozeMin, String(snoozeMin));
      await setMeta(db, 'default_focus_min', String(defaultFocusMin));
      await setMeta(db, META_KEYS.theme, themeMode);
      await setMeta(db, META_KEYS.hapticsEnabled, hapticsEnabled ? '1' : '0');
      await setMeta(db, META_KEYS.hapticIntensity, hapticIntensity);
      await setMeta(db, 'clock_format', clockFormat);
      await setMeta(db, META_KEYS.onboarded, '1');
      await setupNotifications().catch(() => {});
      void hapticSuccess();
      router.replace('/(tabs)');
    } finally {
      setFinishing(false);
    }
  };

  const progressPct = ((step + 1) / STEPS.length) * 100;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      {/* Top Progress Header */}
      <View style={styles.topHeader}>
        <View style={styles.topMetaRow}>
          <Text style={[styles.stepTag, { color: theme.textDim }]} numberOfLines={1}>
            {STEPS[step].label}
          </Text>
          <Text style={[styles.stepCounter, { color: theme.textFaint }]}>
            {step + 1} / {STEPS.length}
          </Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.surface3 }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: theme.text,
                width: `${progressPct}%`,
              },
            ]}
          />
        </View>
        <View style={styles.stepDotsRow}>
          {STEPS.map((s, idx) => {
            const active = idx === step;
            const passed = idx < step;
            return (
              <PressableScale
                key={s.id}
                onPress={() => setStep(idx)}
                style={styles.stepDotHit}
                innerStyle={[
                  styles.stepDot,
                  {
                    backgroundColor: active
                      ? theme.text
                      : passed
                      ? theme.textDim
                      : theme.surface3,
                    width: active ? 28 : 10,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Go to step ${idx + 1}`}
              />
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
          <Animated.View
            entering={FadeInDown.duration(MOTION.normal)}
            layout={LinearTransition.duration(MOTION.normal)}
            style={styles.stepContainer}
          >
            <View style={styles.heroBlock}>
              <View
                style={[
                  styles.monolithBadge,
                  { backgroundColor: theme.surface2, borderColor: theme.borderStrong },
                ]}
              >
                <Check color={theme.text} size={28} strokeWidth={2.5} />
              </View>
              <Text style={[styles.eyebrow, { color: theme.textFaint }]}>
                PRECISION PERSONAL LEDGER
              </Text>
              <MetallicText
                style={styles.heroTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                CHECKOFF
              </MetallicText>
              <Text style={[styles.subtitle, { color: theme.textDim }]}>
                A high-contrast, tactile instrument for daily rituals, strict alarms, and append-only self-accountability.
              </Text>
            </View>

            <View style={styles.pillarStack}>
              <Card variant="elevated" padding={space(2)} style={styles.pillarCard}>
                <View style={styles.pillarRow}>
                  <View
                    style={[
                      styles.pillarIconBox,
                      { backgroundColor: theme.surface3, borderColor: theme.border },
                    ]}
                  >
                    <Bell color={theme.text} size={18} strokeWidth={2} />
                  </View>
                  <View style={styles.pillarCopy}>
                    <Text style={[styles.pillarTitle, { color: theme.text }]}>
                      Unmissable Full-Screen Alarms
                    </Text>
                    <Text style={[styles.pillarDesc, { color: theme.textDim }]}>
                      High-importance alerts with looping audio, vibration, and instant Done, Snooze, or Skip logging.
                    </Text>
                  </View>
                </View>
              </Card>

              <Card variant="elevated" padding={space(2)} style={styles.pillarCard}>
                <View style={styles.pillarRow}>
                  <View
                    style={[
                      styles.pillarIconBox,
                      { backgroundColor: theme.surface3, borderColor: theme.border },
                    ]}
                  >
                    <Sliders color={theme.text} size={18} strokeWidth={2} />
                  </View>
                  <View style={styles.pillarCopy}>
                    <Text style={[styles.pillarTitle, { color: theme.text }]}>
                      Tactile Detent Controls
                    </Text>
                    <Text style={[styles.pillarDesc, { color: theme.textDim }]}>
                      Zero typing for numbers. Slide across calibrated detents with crisp haptic ticks and swipe actions.
                    </Text>
                  </View>
                </View>
              </Card>

              <Card variant="elevated" padding={space(2)} style={styles.pillarCard}>
                <View style={styles.pillarRow}>
                  <View
                    style={[
                      styles.pillarIconBox,
                      { backgroundColor: theme.surface3, borderColor: theme.border },
                    ]}
                  >
                    <Shield color={theme.text} size={18} strokeWidth={2} />
                  </View>
                  <View style={styles.pillarCopy}>
                    <Text style={[styles.pillarTitle, { color: theme.text }]}>
                      100% Offline & Empty-First
                    </Text>
                    <Text style={[styles.pillarDesc, { color: theme.textDim }]}>
                      Ships with zero bloat or pre-seeded junk. Every event writes to your local SQLite append-only ledger.
                    </Text>
                  </View>
                </View>
              </Card>
            </View>

            <Card padding={space(2)} style={styles.surfaceChoiceCard}>
              <Text style={[styles.fieldLabel, { color: theme.textFaint }]}>
                APPEARANCE & CLOCK
              </Text>
              <View style={styles.pillRow}>
                {(['dark', 'light', 'system'] as ThemeMode[]).map((m) => {
                  const active = themeMode === m;
                  return (
                    <PressableScale
                      key={m}
                      onPress={() => setThemeMode(m)}
                      style={styles.pillFlex}
                      innerStyle={[
                        styles.pillInner,
                        {
                          backgroundColor: active ? theme.accent : theme.surface2,
                          borderColor: active ? theme.accent : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillLabel,
                          { color: active ? theme.onAccent : theme.textDim },
                        ]}
                        numberOfLines={1}
                      >
                        {m.toUpperCase()}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
              <View style={styles.pillRow}>
                {(['12h', '24h'] as ClockFormat[]).map((cf) => {
                  const active = clockFormat === cf;
                  return (
                    <PressableScale
                      key={cf}
                      onPress={() => setClockFormat(cf)}
                      style={styles.pillFlex}
                      innerStyle={[
                        styles.pillInner,
                        {
                          backgroundColor: active ? theme.accent : theme.surface2,
                          borderColor: active ? theme.accent : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillLabel,
                          { color: active ? theme.onAccent : theme.textDim },
                        ]}
                        numberOfLines={1}
                      >
                        {cf === '12h' ? '12-HOUR CLOCK' : '24-HOUR MILITARY'}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </Card>
          </Animated.View>
        )}

        {step === 1 && (
          <Animated.View
            entering={FadeInDown.duration(MOTION.normal)}
            layout={LinearTransition.duration(MOTION.normal)}
            style={styles.stepContainer}
          >
            <View style={styles.stepHeaderBlock}>
              <Text style={[styles.eyebrow, { color: theme.textFaint }]}>
                SLIDER CALIBRATION
              </Text>
              <MetallicText
                style={styles.stepTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                TIMING & TACTICS
              </MetallicText>
              <Text style={[styles.subtitle, { color: theme.textDim }]}>
                Drag each horizontal counter to set your discipline tolerances and haptic feedback.
              </Text>
            </View>

            <Card variant="elevated" padding={space(2.25)} style={styles.sliderSection}>
              <Slider
                label="On-Time Grace Window"
                value={graceMin}
                min={5}
                max={60}
                step={5}
                presets={[5, 10, 15, 30, 45, 60]}
                formatValue={(v) => `${v}m`}
                onChange={setGraceMin}
              />
              <Text style={[styles.helperCaption, { color: theme.textFaint }]}>
                Completing a task within {graceMin} minutes of its scheduled alarm preserves your On-Time streak.
              </Text>
            </Card>

            <Card variant="elevated" padding={space(2.25)} style={styles.sliderSection}>
              <Slider
                label="Alarm Snooze Step"
                value={snoozeMin}
                min={5}
                max={30}
                step={5}
                presets={[5, 10, 15, 20, 30]}
                formatValue={(v) => `${v}m`}
                onChange={setSnoozeMin}
              />
              <Text style={[styles.helperCaption, { color: theme.textFaint }]}>
                Default delay when tapping Snooze on the full-screen alarm screen.
              </Text>
            </Card>

            <Card variant="elevated" padding={space(2.25)} style={styles.sliderSection}>
              <Slider
                label="Baseline Focus Block"
                value={defaultFocusMin}
                min={10}
                max={90}
                step={5}
                presets={[15, 25, 45, 60, 90]}
                formatValue={(v) => `${v}m`}
                onChange={setDefaultFocusMin}
              />
              <Text style={[styles.helperCaption, { color: theme.textFaint }]}>
                Recommended session length for deep-work countdown blocks.
              </Text>
            </Card>

            <Card padding={space(2)} style={styles.sliderSection}>
              <Switch
                value={hapticsEnabled}
                onValueChange={setHapticsEnabled}
                label="Tactile Haptic Engine"
                description="Crisp mechanical feedback on detents, swipes, and completions"
              />
              {hapticsEnabled && (
                <View style={styles.pillRow}>
                  {(['light', 'medium', 'heavy'] as HapticIntensity[]).map((lvl) => {
                    const active = hapticIntensity === lvl;
                    return (
                      <PressableScale
                        key={lvl}
                        onPress={() => setHapticIntensity(lvl)}
                        style={styles.pillFlex}
                        innerStyle={[
                          styles.pillInner,
                          {
                            backgroundColor: active ? theme.accent : theme.surface2,
                            borderColor: active ? theme.accent : theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.pillLabel,
                            { color: active ? theme.onAccent : theme.textDim },
                          ]}
                        >
                          {lvl.toUpperCase()}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
              )}
            </Card>
          </Animated.View>
        )}

        {step === 2 && (
          <ArenasStep
            theme={theme}
            db={db}
            categories={categories}
            skillsByCat={skillsByCat}
            onReload={reloadCategories}
          />
        )}

        {step === 3 && (
          <Animated.View
            entering={FadeInDown.duration(MOTION.normal)}
            layout={LinearTransition.duration(MOTION.normal)}
            style={styles.stepContainer}
          >
            <View style={styles.heroBlock}>
              <View
                style={[
                  styles.monolithBadge,
                  { backgroundColor: theme.accent, borderColor: theme.accent },
                ]}
              >
                <Sparkles color={theme.onAccent} size={28} strokeWidth={2.2} />
              </View>
              <Text style={[styles.eyebrow, { color: theme.textFaint }]}>
                CALIBRATION COMPLETE
              </Text>
              <MetallicText
                style={styles.heroTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                SYSTEM ARMED
              </MetallicText>
              <Text style={[styles.subtitle, { color: theme.textDim }]}>
                Your workspace is clean and unseeded. Drop into Today and tap the floating + button to log your first commitment.
              </Text>
            </View>

            <Card variant="elevated" padding={space(2.25)} style={styles.summaryGridCard}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryCell}>
                  <MetallicText style={styles.summaryBigValue}>{graceMin}m</MetallicText>
                  <Text style={[styles.summaryCellLabel, { color: theme.textFaint }]}>
                    GRACE WINDOW
                  </Text>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
                <View style={styles.summaryCell}>
                  <MetallicText style={styles.summaryBigValue}>{snoozeMin}m</MetallicText>
                  <Text style={[styles.summaryCellLabel, { color: theme.textFaint }]}>
                    SNOOZE STEP
                  </Text>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
                <View style={styles.summaryCell}>
                  <MetallicText style={styles.summaryBigValue}>{categories.length}</MetallicText>
                  <Text style={[styles.summaryCellLabel, { color: theme.textFaint }]}>
                    ARENAS
                  </Text>
                </View>
              </View>
            </Card>

            <Card padding={space(2.25)} style={styles.fabPreviewCard}>
              <View style={styles.fabPreviewRow}>
                <View
                  style={[
                    styles.fabMock,
                    { backgroundColor: theme.accent, borderColor: theme.borderStrong },
                  ]}
                >
                  <Plus color={theme.onAccent} size={22} strokeWidth={2.6} />
                </View>
                <View style={styles.pillarCopy}>
                  <Text style={[styles.pillarTitle, { color: theme.text }]}>
                    Docked Above Navigation
                  </Text>
                  <Text style={[styles.pillarDesc, { color: theme.textDim }]}>
                    Use the + trigger on Today or Calendar at any time to open the velocity-aware New Task sheet.
                  </Text>
                </View>
              </View>
            </Card>
          </Animated.View>
        )}
      </ScrollView>

      {/* Bottom Sticky Action Bar */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: theme.bg, borderTopColor: theme.border },
        ]}
      >
        {step > 0 ? (
          <Button
            label="Back"
            variant="secondary"
            onPress={goBack}
            icon={<ChevronLeft color={theme.text} size={18} strokeWidth={2.2} />}
            style={styles.backBtn}
          />
        ) : (
          <Button
            label="Skip"
            variant="ghost"
            onPress={finish}
            loading={finishing}
            style={styles.backBtn}
          />
        )}

        {step < STEPS.length - 1 ? (
          <Button
            label={step === 2 && categories.length === 0 ? 'Skip for Now' : 'Continue'}
            variant="primary"
            onPress={goNext}
            icon={<ArrowRight color={theme.onAccent} size={18} strokeWidth={2.4} />}
            style={styles.nextBtn}
          />
        ) : (
          <Button
            label="Enter Today"
            variant="primary"
            onPress={finish}
            loading={finishing}
            icon={<Check color={theme.onAccent} size={18} strokeWidth={2.6} />}
            style={styles.nextBtn}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function ArenasStep({
  theme,
  db,
  categories,
  skillsByCat,
  onReload,
}: {
  theme: ThemePalette;
  db: Parameters<typeof createCategory>[0];
  categories: Category[];
  skillsByCat: Record<string, Skill[]>;
  onReload: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [rotation, setRotation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [skillName, setSkillName] = useState('');

  const addCategory = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter an arena name first.');
      return;
    }
    try {
      await createCategory(db, {
        name: trimmed,
        colorToken: 'slate',
        rotationEnabled: rotation,
      });
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
    const trimmed = skillName.trim();
    if (!trimmed) return;
    try {
      await createSkill(db, { categoryId, name: trimmed });
      setSkillName('');
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add skill.');
    }
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(MOTION.normal)}
      layout={LinearTransition.duration(MOTION.normal)}
      style={styles.stepContainer}
    >
      <View style={styles.stepHeaderBlock}>
        <Text style={[styles.eyebrow, { color: theme.textFaint }]}>
          OPTIONAL ARENAS
        </Text>
        <MetallicText
          style={styles.stepTitle}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          YOUR DOMAINS
        </MetallicText>
        <Text style={[styles.subtitle, { color: theme.textDim }]}>
          Create categories now or leave empty and add them as you go. Enable skill rotation to surface your least-practiced craft each day.
        </Text>
      </View>

      <Card variant="elevated" padding={space(2)} style={styles.sliderSection}>
        <Text style={[styles.fieldLabel, { color: theme.textFaint }]}>
          CREATE ARENA
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Deep Work, Conditioning, Acoustics"
          placeholderTextColor={theme.textFaint}
          style={[
            styles.input,
            {
              color: theme.text,
              borderColor: theme.border,
              backgroundColor: theme.surface2,
            },
          ]}
        />
        <Switch
          value={rotation}
          onValueChange={setRotation}
          label="Daily Skill Rotation Pool"
          description="Surface the least-practiced skill in this category on Today"
        />
        <Button
          label="Add Arena"
          variant="secondary"
          onPress={addCategory}
          fullWidth
          icon={<Plus color={theme.text} size={16} strokeWidth={2.4} />}
        />
        {error && <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>}
      </Card>

      {categories.length === 0 ? (
        <Card variant="outlined" padding={space(2.5)}>
          <View style={styles.emptyArenaBox}>
            <Layers color={theme.textFaint} size={22} strokeWidth={1.8} />
            <Text style={[styles.emptyArenaTitle, { color: theme.textDim }]}>
              Zero Seeded Arenas
            </Text>
            <Text style={[styles.emptyArenaSub, { color: theme.textFaint }]}>
              CheckOff starts completely blank. Add an arena above or continue straight to Today.
            </Text>
          </View>
        </Card>
      ) : (
        <View style={styles.pillarStack}>
          {categories.map((c) => {
            const skills = skillsByCat[c.id] ?? [];
            const isOpen = expanded === c.id;
            return (
              <Card key={c.id} variant="default" padding={space(2)} style={styles.sliderSection}>
                <View style={styles.catHeader}>
                  <View style={[styles.catRule, { backgroundColor: theme.text }]} />
                  <Text style={[styles.pillarTitle, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Button
                    label={isOpen ? 'Hide Skills' : `Skills (${skills.length})`}
                    variant="ghost"
                    size="sm"
                    onPress={() => setExpanded(isOpen ? null : c.id)}
                  />
                </View>
                <Switch
                  value={c.rotationEnabled}
                  onValueChange={() => toggleRotation(c)}
                  label="Skill Rotation Pool"
                />
                {isOpen && (
                  <View style={styles.skillsWrap}>
                    {skills.length > 0 && (
                      <View style={styles.skillChipsRow}>
                        {skills.map((s) => (
                          <View
                            key={s.id}
                            style={[
                              styles.skillChip,
                              { backgroundColor: theme.surface2, borderColor: theme.border },
                            ]}
                          >
                            <Text style={[styles.skillChipText, { color: theme.text }]}>
                              {s.name}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                    <View style={styles.skillInputRow}>
                      <TextInput
                        value={skillName}
                        onChangeText={setSkillName}
                        placeholder="Add rotation skill…"
                        placeholderTextColor={theme.textFaint}
                        style={[
                          styles.input,
                          styles.skillInputFlex,
                          {
                            color: theme.text,
                            borderColor: theme.border,
                            backgroundColor: theme.surface2,
                          },
                        ]}
                      />
                      <Button
                        label="Add"
                        variant="secondary"
                        size="sm"
                        onPress={() => addSkill(c.id)}
                      />
                    </View>
                  </View>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topHeader: {
    paddingHorizontal: space(3),
    paddingTop: space(1.5),
    paddingBottom: space(1.5),
    gap: space(1),
  },
  topMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepTag: {
    ...type.label,
    letterSpacing: 1.6,
  },
  stepCounter: {
    ...type.monoSmall,
  },
  progressTrack: {
    height: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  stepDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    marginTop: 2,
  },
  stepDotHit: {
    minHeight: 28,
    justifyContent: 'center',
  },
  stepDot: {
    height: 4,
    borderRadius: radius.pill,
  },
  scroll: {
    paddingHorizontal: space(3),
    paddingTop: space(1),
    paddingBottom: space(6),
  },
  stepContainer: {
    gap: space(2.5),
  },
  heroBlock: {
    alignItems: 'center',
    paddingVertical: space(1.5),
    gap: space(1),
  },
  monolithBadge: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(0.5),
  },
  eyebrow: {
    ...type.label,
    letterSpacing: 1.8,
  },
  heroTitle: {
    ...type.hero,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1.2,
    textAlign: 'center',
  },
  stepHeaderBlock: {
    gap: space(0.75),
  },
  stepTitle: {
    ...type.display,
    letterSpacing: -1,
  },
  subtitle: {
    ...type.body,
    lineHeight: 22,
  },
  pillarStack: {
    gap: space(1.5),
  },
  pillarCard: {
    gap: space(1),
  },
  pillarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(1.75),
  },
  pillarIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  pillarCopy: {
    flex: 1,
    gap: 4,
  },
  pillarTitle: {
    ...type.h3,
  },
  pillarDesc: {
    ...type.small,
    lineHeight: 19,
  },
  surfaceChoiceCard: {
    gap: space(1.25),
  },
  fieldLabel: {
    ...type.label,
    letterSpacing: 1.4,
  },
  pillRow: {
    flexDirection: 'row',
    gap: space(1),
  },
  pillFlex: {
    flex: 1,
    minHeight: TAP,
  },
  pillInner: {
    flex: 1,
    minHeight: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(1),
  },
  pillLabel: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  sliderSection: {
    gap: space(1.5),
  },
  helperCaption: {
    ...type.caption,
    lineHeight: 17,
  },
  input: {
    ...type.body,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: TAP,
  },
  errorText: {
    ...type.small,
  },
  emptyArenaBox: {
    alignItems: 'center',
    gap: space(1),
    paddingVertical: space(1),
  },
  emptyArenaTitle: {
    ...type.bodyStrong,
  },
  emptyArenaSub: {
    ...type.small,
    textAlign: 'center',
    lineHeight: 19,
  },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.25),
  },
  catRule: {
    width: 3,
    height: 18,
    borderRadius: 2,
  },
  skillsWrap: {
    gap: space(1.25),
    paddingTop: space(0.5),
  },
  skillChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(1),
  },
  skillChip: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space(1.25),
    paddingVertical: space(0.75),
  },
  skillChipText: {
    ...type.small,
  },
  skillInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
  },
  skillInputFlex: {
    flex: 1,
  },
  summaryGridCard: {
    marginTop: space(0.5),
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryCell: {
    flex: 1,
    alignItems: 'center',
    gap: space(0.5),
  },
  summaryBigValue: {
    ...type.monoLg,
    fontSize: 26,
    lineHeight: 32,
  },
  summaryCellLabel: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 1,
  },
  summaryDivider: {
    width: 1,
    height: 44,
  },
  fabPreviewCard: {
    marginTop: space(0.5),
  },
  fabPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
  fabMock: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    paddingHorizontal: space(3),
    paddingVertical: space(1.75),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    minWidth: 104,
  },
  nextBtn: {
    flex: 1,
  },
});
