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
import Svg, { Circle } from 'react-native-svg';
import { useTasksDb, useTasksStore } from '../../state/tasks';
import { useUiStore } from '../../state/ui';
import { dark, light, categoryColor, type, radius, space, TAP, type ThemePalette } from '../../theme/tokens';
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

  // Live clock.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const syncDay = useCallback(async () => {
    const today = localDateString();
    try {
      await markPastDueMissed(db, today);
      await ensureInstancesForDate(db, date);
      await refresh(date);
      const s = await todaysSkillSlot(db, date);
      setSlot(s);
      setSlotLastTs(s.skill ? await lastPracticedAt(db, s.skill.id) : null);
      const cats = await listCategories(db);
      setCatTokens(new Map(cats.map((c) => [c.id, c.colorToken])));
    } catch (e) {
      console.error('[today] sync failed', e);
    }
  }, [db, date, refresh]);

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
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const nextUp =
    pendingTasks.find((t) => t.alarmTime && t.alarmTime >= nowHHMM) ?? pendingTasks[0] ?? null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Clock */}
        <Text style={[styles.clock, { color: theme.text }]}>
          {now.toLocaleTimeString('en-GB', { hour12: false })}
        </Text>
        <Text style={[styles.dateLine, { color: theme.textDim }]}>
          {now.toLocaleDateString('en-GB', DATE_FMT)}
        </Text>

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
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ProgressRing theme={theme} done={onTime.done} planned={onTime.planned} />
          <View style={styles.progressText}>
            <Text style={[styles.h3, { color: theme.text }]}>
              {onTime.done}/{onTime.planned} done
            </Text>
            <Text style={[styles.small, { color: theme.textDim }]}>
              {onTime.onTimePct === null
                ? 'No timed completions yet'
                : `${onTime.onTimePct}% on-time`}
            </Text>
          </View>
        </View>

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
        {tasks.length === 0 && (
          <Text style={[styles.small, { color: theme.textFaint }]}>
            Nothing scheduled for this day.
          </Text>
        )}
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            item={t}
            theme={theme}
            categoryToken={t.categoryId ? catTokens.get(t.categoryId) : undefined}
            isNext={nextUp?.id === t.id}
            onToggle={() => handleToggle(t)}
            onSkip={() => handleSkip(t.id)}
          />
        ))}

        {/* Skill slot */}
        {slot && (slot.skill || slot.category) && (
          <View>
            <Text style={[styles.caption, { color: theme.textFaint }]}>TODAY'S SKILL</Text>
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
    </SafeAreaView>
  );
}

function ProgressRing({
  theme,
  done,
  planned,
}: {
  theme: ThemePalette;
  done: number;
  planned: number;
}) {
  const size = 64;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = planned > 0 ? done / planned : 0;
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={theme.border}
        strokeWidth={stroke}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={theme.accent}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={`${c}`}
        strokeDashoffset={c * (1 - frac)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
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
          borderColor: checked ? theme.accent : theme.border,
          backgroundColor: checked ? theme.accent : 'transparent',
        },
      ]}
    >
      {checked && <Text style={[styles.checkMark, { color: theme.onAccent }]}>✓</Text>}
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

function TaskRow({
  item,
  theme,
  categoryToken,
  isNext,
  onToggle,
  onSkip,
}: {
  item: TaskInstance;
  theme: ThemePalette;
  categoryToken?: string;
  isNext: boolean;
  onToggle: () => void;
  onSkip: () => void;
}) {
  return (
    <View
      style={[
        styles.taskRow,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderLeftWidth: isNext ? 3 : 0,
          borderLeftColor: theme.accent,
        },
      ]}
    >
      <Pressable onPress={onToggle} style={styles.taskMain} hitSlop={4}>
        {isNext && (
          <Text style={[styles.nextCaption, { color: theme.accent }]}>NEXT</Text>
        )}
        <View style={styles.taskLine}>
          <Text style={[styles.mono, { color: theme.textDim }]}>
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
                color: item.status === 'done' ? theme.textFaint : theme.text,
                textDecorationLine: item.status === 'done' ? 'line-through' : 'none',
              },
            ]}
          >
            {item.title}
          </Text>
          <Text style={[styles.mono, { color: theme.textFaint }]}>
            {item.durationMin}m
          </Text>
        </View>
        {item.status !== 'pending' && (
          <Text style={[styles.small, { color: theme.textFaint }]}>
            {item.status}
          </Text>
        )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: space(2), gap: space(2), paddingBottom: space(6) },
  clock: {
    ...type.clock,
    fontVariant: ['tabular-nums'],
  },
  dateLine: { ...type.body, marginTop: space(0.5) },
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
  progressText: { gap: space(0.5) },
  caption: {
    ...type.caption,
    textTransform: 'uppercase',
    marginTop: space(1),
    marginBottom: space(1),
  },
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
    width: TAP,
    height: TAP,
    borderRadius: TAP / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 20, fontWeight: '700' },
  taskRow: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space(1.5),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
  },
  taskMain: { flex: 1, gap: space(0.5), minHeight: TAP, justifyContent: 'center' },
  taskLine: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  nextCaption: { ...type.caption },
  skipBtn: {
    justifyContent: 'center',
    paddingHorizontal: space(1.5),
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
