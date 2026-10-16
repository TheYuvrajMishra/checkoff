import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import {
  createAnimatedComponent,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { CalendarPlus, Check, Play } from 'lucide-react-native';
import { useTasksDb, useTasksStore } from '../../state/tasks';
import { useUiStore } from '../../state/ui';
import { dark, light, shadow, type, radius, space, TAP, type ThemePalette } from '../../theme/tokens';
import { AddTaskSheet } from '../../components/AddTaskSheet';
import { EmptyState } from '../../components/EmptyState';
import { Fab } from '../../components/Fab';
import { TaskActionSheet } from '../../components/TaskActionSheet';
import { TaskRow } from '../../components/TaskRow';
import type { TaskInstanceEx } from '../../db/repos/instances';
import {
  addDays,
  localDateString,
  localTimeString,
} from '../../db/time';
import { ensureInstancesForDate, markPastDueMissed } from '../../tasks/recurrence';
import { todaysSkillSlot, overrideSkillSlot, type SkillSlot } from '../../tasks/rotation';
import { getLogEvents } from '../../db/log';
import { lastPracticedAt, listSkills } from '../../db/repos/skills';
import { listCategories } from '../../db/repos/categories';
import { haptics } from '../../haptics';
import type { Skill, TaskInstance } from '../../db/types';

const AnimatedCircle = createAnimatedComponent(Circle);

const DATE_FMT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' });
}

function dayNum(dateStr: string): string {
  return String(Number(dateStr.split('-')[2]));
}

function daysAgoLabel(lastTs: string | null, today: string): string {
  if (!lastTs) return 'Not yet practiced';
  const lastDay = lastTs.slice(0, 10);
  const [ty, tm, td] = today.split('-').map(Number);
  const [ly, lm, ld] = lastDay.split('-').map(Number);
  const diff = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(ly, lm - 1, ld)) / 86400000
  );
  if (diff <= 0) return 'Practiced today';
  if (diff === 1) return 'Practiced yesterday';
  return `Practiced ${diff} days ago`;
}

/** "18:30" -> "6:30 PM". */
function formatAlarm12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Live countdown label from now to an "HH:MM" alarm today. */
function countdownLabel(now: Date, alarmTime: string | null): string {
  if (!alarmTime) return 'Up next';
  const [h, m] = alarmTime.split(':').map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'Due now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `in ${hrs}h` : `in ${hrs}h ${rem}m`;
}

interface OnTimeStats {
  done: number;
  planned: number;
  onTimePct: number | null;
}

export default function TodayScreen() {
  const db = useTasksDb();
  const theme = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const graceMin = useUiStore((s) => s.graceMin);
  const date = useTasksStore((s) => s.date);
  const instances = useTasksStore((s) => s.instances);
  const refresh = useTasksStore((s) => s.refresh);
  const setDate = useTasksStore((s) => s.setDate);
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const skipTask = useTasksStore((s) => s.skipTask);

  const [now, setNow] = useState(() => new Date());
  const [slot, setSlot] = useState<SkillSlot | null>(null);
  const [slotLastTs, setSlotLastTs] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideSkills, setOverrideSkills] = useState<Skill[]>([]);
  const [catTokens, setCatTokens] = useState<Map<string, string>>(new Map());
  const [onTime, setOnTime] = useState<OnTimeStats>({ done: 0, planned: 0, onTimePct: null });
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [menuInstance, setMenuInstance] = useState<TaskInstance | null>(null);
  const [menuInitialView, setMenuInitialView] = useState<'menu' | 'reschedule'>('menu');
  const [editingInstance, setEditingInstance] = useState<TaskInstanceEx | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);

  // Live clock.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const syncDay = useCallback(
    async (target?: string) => {
      const d = target ?? date;
      const today = localDateString();
      try {
        await markPastDueMissed(db, today);
        await ensureInstancesForDate(db, d);
        await refresh(d);
        const s = await todaysSkillSlot(db, d);
        setSlot(s);
        setSlotLastTs(s.skill ? await lastPracticedAt(db, s.skill.id) : null);
        const cats = await listCategories(db);
        setCatTokens(new Map(cats.map((c) => [c.id, c.colorToken])));
      } catch (e) {
        console.error('[today] sync failed', e);
      }
    },
    [db, date, refresh]
  );

  const handleTaskAdded = useCallback(
    (d: string) => {
      void syncDay(d);
    },
    [syncDay]
  );

  // Recompute on-time stats from the store's instances.
  useFocusEffect(
    useCallback(() => {
      void syncDay();
    }, [syncDay])
  );

  // Recompute stats when instances change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const events = await getLogEvents(db, { day: date, eventTypes: ['completed'] });
        const completedAt = new Map<string, string>();
        for (const e of events) {
          if (e.taskInstanceId && !completedAt.has(e.taskInstanceId)) {
            completedAt.set(e.taskInstanceId, e.tsUtc);
          }
        }
        let done = 0;
        let onTimeCount = 0;
        let onTimeDenom = 0;
        for (const i of instances) {
          if (i.status !== 'done') continue;
          done += 1;
          const ts = completedAt.get(i.id);
          if (!ts) continue;
          onTimeDenom += 1;
          if (!i.alarmTime) {
            onTimeCount += 1;
          } else {
            const alarmLocal = new Date(`${date}T${i.alarmTime}:00`);
            if (new Date(ts).getTime() <= alarmLocal.getTime() + graceMin * 60000) {
              onTimeCount += 1;
            }
          }
        }
        if (!cancelled) {
          setOnTime({
            done,
            planned: instances.length,
            onTimePct: onTimeDenom > 0 ? Math.round((onTimeCount / onTimeDenom) * 100) : null,
          });
        }
      } catch (e) {
        console.error('[today] stats failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, date, instances, graceMin]);

  const openOverridePicker = useCallback(async () => {    if (!slot?.category) return;
    try {
      const all = await listSkills(db, slot.category.id);
      setOverrideSkills(all);
      setOverrideOpen(true);
    } catch (e) {
      console.error('[today] override picker failed', e);
    }
  }, [db, slot]);

  const applyOverride = useCallback(
    async (skillId: string) => {
      try {
        await overrideSkillSlot(db, date, skillId);
        const s = await todaysSkillSlot(db, date);
        setSlot(s);
        setSlotLastTs(s.skill ? await lastPracticedAt(db, s.skill.id) : null);
        setOverrideOpen(false);
      } catch (e) {
        console.error('[today] override failed', e);
      }
    },
    [db, date]
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, k) => addDays(date, k - 3)),
    [date]
  );

  const rituals = instances.filter((i) => i.isRitual);

  /** Haptic vocabulary, applied at the interaction site (never inside the store). */
  const handleToggle = useCallback(
    async (item: TaskInstance) => {
      const willComplete = item.status !== 'done';
      try {
        if (!willComplete) {
          await haptics.uncheck();
        } else if (item.isRitual) {
          const remaining = rituals.filter(
            (r) => r.id !== item.id && r.status !== 'done'
          ).length;
          if (remaining === 0) await haptics.finalRitual();
          else await haptics.check();
        } else {
          await haptics.check();
        }
      } catch {
        /* haptics never throws by contract */
      }
      await toggleDone(item.id);
    },
    [rituals, toggleDone]
  );

  const handleSkip = useCallback(
    async (id: string) => {
      try {
        await haptics.skip();
      } catch {
        /* haptics never throws by contract */
      }
      await skipTask(id);
    },
    [skipTask]
  );
  const tasks = instances.filter((i) => !i.isRitual);

  const nowHHMM = localTimeString(now);
  const todayStr = localDateString();
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const nextUp =
    pendingTasks.find((t) => t.alarmTime && t.alarmTime >= nowHHMM) ?? pendingTasks[0] ?? null;

  /** Overdue: pending, scheduled for today, alarm time already passed. */
  const isOverdue = useCallback(
    (t: TaskInstance) =>
      t.status === 'pending' &&
      t.alarmTime != null &&
      date === todayStr &&
      t.alarmTime < nowHHMM,
    [date, todayStr, nowHHMM]
  );

  const openMenu = useCallback((item: TaskInstance) => {
    setMenuInitialView('menu');
    setMenuInstance(item);
  }, []);

  const openReschedule = useCallback((item: TaskInstance) => {
    setMenuInitialView('reschedule');
    setMenuInstance(item);
  }, []);

  const handleEdit = useCallback((item: TaskInstance) => {
    setMenuInstance(null);
    // The store holds plain TaskInstance rows; AddTaskSheet needs the Ex
    // subtype for prefill. The extra fields are absent here, so build it.
    setEditingInstance({ ...item, skillId: null } as TaskInstanceEx);
    setEditSheetOpen(true);
  }, []);

  const showNextCard = date === todayStr && nextUp !== null;
  const statusLine =
    onTime.planned === 0
      ? 'Nothing scheduled today'
      : `${onTime.done} of ${onTime.planned} done${
          nextUp?.alarmTime ? `, next at ${formatAlarm12h(nextUp.alarmTime)}` : ''
        }`;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero: live clock + day-progress arc + status */}
        <DayHero theme={theme} now={now} statusLine={statusLine} />

        {/* Week strip */}
        <View style={styles.weekRow}>
          {weekDays.map((d) => {
            const selected = d === date;
            return (
              <Pressable
                key={d}
                onPress={() => setDate(d)}
                hitSlop={4}
                style={[
                  styles.dayCell,
                  selected && { backgroundColor: theme.accent },
                ]}
              >
                <Text
                  style={[
                    styles.dayDow,
                    { color: selected ? theme.onAccent : theme.textFaint },
                  ]}
                >
                  {weekdayShort(d)}
                </Text>
                <Text
                  style={[
                    styles.dayNum,
                    { color: selected ? theme.onAccent : theme.text },
                  ]}
                >
                  {dayNum(d)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Progress ring */}
        <View style={[styles.card, shadow.sm, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ProgressRing theme={theme} done={onTime.done} planned={onTime.planned} />
          <View style={styles.progressText}>
            <Text style={[styles.caption, { color: theme.textFaint }]}>TODAY&apos;S PROGRESS</Text>
            <Text style={[styles.h3, { color: theme.text }]}>
              {onTime.done} of {onTime.planned} done
            </Text>
            <Text style={[styles.small, { color: theme.textDim }]}>
              {onTime.onTimePct === null
                ? 'No timed completions yet'
                : `${onTime.onTimePct}% on-time`}
            </Text>
          </View>
        </View>

        {/* Next-up card */}
        {showNextCard && (
          <NextUpCard
            theme={theme}
            item={nextUp}
            countdown={countdownLabel(now, nextUp.alarmTime)}
            onStart={() =>
              router.push({ pathname: '/timer', params: { instanceId: nextUp.id } })
            }
            onDone={() => handleToggle(nextUp)}
          />
        )}

        {/* Rituals */}
        {rituals.length > 0 && (
          <View>
            <Text style={[styles.caption, { color: theme.textFaint }]}>RITUALS</Text>
            {rituals.map((r) => (
              <RitualRow key={r.id} item={r} theme={theme} onToggle={() => handleToggle(r)} />
            ))}
          </View>
        )}

        {/* Tasks */}
        <Text style={[styles.caption, { color: theme.textFaint }]}>TASKS</Text>
        {tasks.length === 0 && rituals.length === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title="No tasks yet"
            subtitle="Nothing scheduled for this day. Add your first task to get started."
            actionLabel="Add your first task"
            onAction={() => setAddSheetOpen(true)}
          />
        ) : (
          tasks.map((t) => (
            <TaskRow
              key={t.id}
              item={t}
              theme={theme}
              categoryToken={t.categoryId ? catTokens.get(t.categoryId) : undefined}
              isNext={nextUp?.id === t.id}
              overdue={isOverdue(t)}
              onToggle={() => handleToggle(t)}
              onSkip={() => handleSkip(t.id)}
              onReschedule={() => openReschedule(t)}
              onLongPress={() => openMenu(t)}
            />
          ))
        )}

        {/* Skill slot */}
        {slot && (slot.skill || slot.category) && (
          <View>
            <Text style={[styles.caption, { color: theme.textFaint }]}>TODAY&apos;S SKILL</Text>
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.slotHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.h3, { color: theme.text }]}>
                    {slot.skill ? slot.skill.name : 'No skills yet'}
                  </Text>
                  <Text style={[styles.small, { color: theme.textDim }]}>
                    {slot.category ? slot.category.name : ''}
                    {slot.skill ? ` · ${daysAgoLabel(slotLastTs, date)}` : ''}
                    {slot.overridden ? ' · overridden' : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={openOverridePicker}
                  style={[styles.slotBtn, { borderColor: theme.border }]}
                >
                  <Text style={[styles.small, { color: theme.text }]}>Change</Text>
                </Pressable>
              </View>
              {slot.skill && (
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/timer',
                      params: { instanceId: '', skillId: slot.skill!.id },
                    })
                  }
                  style={[styles.startBtn, { backgroundColor: theme.accent }]}
                >
                  <Text style={[styles.startBtnText, { color: theme.onAccent }]}>
                    Start timer
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {overrideOpen && (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.caption, { color: theme.textFaint }]}>PICK A SKILL</Text>
            {overrideSkills.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => applyOverride(s.id)}
                style={styles.overrideRow}
              >
                <Text style={[styles.body, { color: theme.text }]}>{s.name}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setOverrideOpen(false)} style={styles.overrideRow}>
              <Text style={[styles.body, { color: theme.textFaint }]}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      <Fab onPress={() => setAddSheetOpen(true)} />
      <AddTaskSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        initialDate={date}
        onAdded={handleTaskAdded}
      />
      <AddTaskSheet
        visible={editSheetOpen}
        onClose={() => {
          setEditSheetOpen(false);
          setEditingInstance(null);
        }}
        editing={editingInstance}
        onEdited={() => {
          setEditSheetOpen(false);
          setEditingInstance(null);
        }}
      />
      <TaskActionSheet
        instance={menuInstance}
        initialView={menuInitialView}
        onClose={() => setMenuInstance(null)}
        onEdit={handleEdit}
      />
    </SafeAreaView>
  );
}

/**
 * Hero: large live clock wrapped in a thin day-progress arc (SVG),
 * date beneath, and a one-line status.
 */
function DayHero({
  theme,
  now,
  statusLine,
}: {
  theme: ThemePalette;
  now: Date;
  statusLine: string;
}) {
  const size = 260;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayFrac = Math.min(1, Math.max(0, (now.getTime() - startOfDay.getTime()) / 86400000));

  return (
    <View style={styles.hero}>
      <View style={[styles.heroRing, { width: size, height: size }]}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={theme.border}
            strokeWidth={stroke}
            fill="none"
            opacity={0.7}
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={theme.accent}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${c}`}
            strokeDashoffset={c * (1 - dayFrac)}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={styles.heroCenter}>
          <Text style={[styles.heroClock, { color: theme.text }]}>
            {now.toLocaleTimeString('en-GB', { hour12: false })}
          </Text>
          <Text style={[styles.small, { color: theme.textDim, textAlign: 'center' }]}>
            {now.toLocaleDateString('en-GB', DATE_FMT)}
          </Text>
        </View>
      </View>
      <Text style={[styles.body, { color: theme.textDim, textAlign: 'center' }]} numberOfLines={1}>
        {statusLine}
      </Text>
    </View>
  );
}

/**
 * Big progress ring: animated fill on the UI thread, center number counts
 * up, subtle glow disc on 100% completion.
 */
function ProgressRing({
  theme,
  done,
  planned,
}: {
  theme: ThemePalette;
  done: number;
  planned: number;
}) {
  const size = 120;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = planned > 0 ? done / planned : 0;
  const complete = planned > 0 && frac >= 1;

  const progress = useSharedValue(0);
  const [displayDone, setDisplayDone] = useState(0);

  useEffect(() => {
    progress.value = withTiming(frac, { duration: 700 });
  }, [frac, progress]);

  useAnimatedReaction(
    () => Math.round(progress.value * planned),
    (v, prev) => {
      if (v !== prev) runOnJS(setDisplayDone)(v);
    },
    [planned]
  );

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - progress.value),
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={theme.border}
          strokeWidth={stroke}
          fill="none"
        />
        {complete && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={theme.accent}
            strokeWidth={stroke + 10}
            fill="none"
            opacity={0.18}
          />
        )}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={theme.accent}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          animatedProps={animatedProps}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={[styles.ringNumber, { color: theme.text }]}>{displayDone}</Text>
        <Text style={[styles.caption, { color: theme.textFaint }]}>OF {planned}</Text>
      </View>
    </View>
  );
}

/**
 * Next-up card: elevated above the list, live countdown, Start / Done.
 */
function NextUpCard({
  theme,
  item,
  countdown,
  onStart,
  onDone,
}: {
  theme: ThemePalette;
  item: TaskInstance;
  countdown: string;
  onStart: () => void;
  onDone: () => void;
}) {
  return (
    <View
      style={[
        styles.nextCard,
        shadow.md,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={[styles.nextCardBar, { backgroundColor: theme.accent }]} />
      <View style={styles.nextCardBody}>
        <View style={styles.nextCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.caption, { color: theme.accent }]}>NEXT UP</Text>
            <Text style={[styles.h2, { color: theme.text }]} numberOfLines={2}>
              {item.title}
            </Text>
          </View>
          <View style={[styles.countdownPill, { backgroundColor: theme.accentDim }]}>
            <Text style={[styles.mono, { color: theme.accent }]}>{countdown}</Text>
          </View>
        </View>
        <View style={styles.nextCardActions}>
          <Pressable
            onPress={onStart}
            style={[styles.nextAction, { backgroundColor: theme.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Start timer"
          >
            <Play color={theme.onAccent} size={16} strokeWidth={2.5} />
            <Text style={[styles.nextActionText, { color: theme.onAccent }]}>Start</Text>
          </Pressable>
          <Pressable
            onPress={onDone}
            style={[styles.nextAction, styles.nextActionOutline, { borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Mark done"
          >
            <Check color={theme.text} size={16} strokeWidth={2.5} />
            <Text style={[styles.nextActionText, { color: theme.text }]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function CheckCircle({
  checked,
  theme,
}: {
  checked: boolean;
  theme: ThemePalette;
}) {
  return (
    <View
      style={[
        styles.check,
        {
          borderColor: checked ? theme.accent : theme.textFaint,
          backgroundColor: checked ? theme.accent : 'transparent',
        },
      ]}
    >
      {checked && <Check color={theme.onAccent} size={20} strokeWidth={3} />}
    </View>
  );
}

function RitualRow({
  item,
  theme,
  onToggle,
}: {
  item: TaskInstance;
  theme: ThemePalette;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.ritualRow, { borderColor: theme.border }]}
    >
      <CheckCircle checked={item.status === 'done'} theme={theme} />
      <Text
        style={[
          styles.body,
          {
            color: item.status === 'done' ? theme.textFaint : theme.text,
            textDecorationLine: item.status === 'done' ? 'line-through' : 'none',
          },
        ]}
      >
        {item.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Clears the floating glass tab bar + FAB.
  scroll: { padding: space(2), gap: space(2), paddingBottom: 128 },
  hero: { alignItems: 'center', gap: space(1.5), paddingTop: space(1) },
  heroRing: { alignItems: 'center', justifyContent: 'center' },
  heroCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(0.5),
    paddingHorizontal: space(4),
  },
  heroClock: {
    ...type.clock,
    fontSize: 46,
    lineHeight: 54,
    fontVariant: ['tabular-nums'],
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space(1),
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space(1),
    borderRadius: radius.md,
    marginHorizontal: 2,
  },
  dayDow: { ...type.caption, textTransform: 'uppercase' },
  dayNum: { ...type.h3 },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
  progressText: { gap: space(0.5), flex: 1 },
  ringCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringNumber: { fontSize: 30, lineHeight: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nextCard: {
    borderWidth: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  nextCardBar: { height: 3 },
  nextCardBody: { padding: space(2), gap: space(2) },
  nextCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2) },
  countdownPill: {
    borderRadius: radius.md,
    paddingHorizontal: space(1.5),
    paddingVertical: space(1),
  },
  nextCardActions: { flexDirection: 'row', gap: space(1.5) },
  nextAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
    borderRadius: radius.md,
    minHeight: TAP,
  },
  nextActionOutline: { borderWidth: 1 },
  nextActionText: { fontSize: 15, fontWeight: '600' },
  caption: {
    ...type.caption,
    textTransform: 'uppercase',
    marginTop: space(1),
    marginBottom: space(1),
  },
  h2: { ...type.h2 },
  h3: { ...type.h3 },
  body: { ...type.body },
  small: { ...type.small },
  mono: { ...type.mono, fontVariant: ['tabular-nums'] },
  ritualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingVertical: space(1.5),
    borderBottomWidth: 1,
  },
  check: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotHeader: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  slotBtn: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space(2),
    minHeight: TAP,
    justifyContent: 'center',
  },
  startBtn: {
    marginTop: space(1.5),
    borderRadius: radius.md,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: { fontSize: 15, fontWeight: '600' },
  overrideRow: { paddingVertical: space(1.5), minHeight: TAP, justifyContent: 'center' },
});
