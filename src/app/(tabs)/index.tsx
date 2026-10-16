import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import Animated, {
  createAnimatedComponent,
  Easing,
  FadeInDown,
  LinearTransition,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import {
  AlignLeft,
  CalendarDays,
  CalendarPlus,
  Check,
  Clock,
  Play,
  Plus,
  SkipForward,
  Sparkles,
} from 'lucide-react-native';
import { useTasksDb, useTasksStore } from '../../state/tasks';
import { useUiStore } from '../../state/ui';
import {
  dark,
  HIT_SLOP,
  light,
  radius,
  space,
  TAP,
  type,
  type ThemePalette,
} from '../../theme/tokens';
import { AddTaskSheet } from '../../components/AddTaskSheet';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Fab, FAB_CLEARANCE } from '../../components/Fab';
import { PressableScale } from '../../components/PressableScale';
import { Sheet } from '../../components/Sheet';
import { Skeleton } from '../../components/Skeleton';
import { TaskActionSheet } from '../../components/TaskActionSheet';
import { AnimatedCheck, formatTimeDisplay } from '../../components/TaskRow';
import { createInstance, type TaskInstanceEx } from '../../db/repos/instances';
import { createTemplate } from '../../db/repos/templates';
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
import type { Category, Priority, Skill, TaskInstance } from '../../db/types';

const AnimatedCircle = createAnimatedComponent(Circle);

const DATE_FMT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
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
  return `Practiced ${diff}d ago`;
}

function countdownLabel(now: Date, alarmTime: string | null): string {
  if (!alarmTime) return 'UP NEXT';
  const [h, m] = alarmTime.split(':').map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'DUE NOW';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `IN ${mins}M`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `IN ${hrs}H` : `IN ${hrs}H ${rem}M`;
}

function statusLabel(status: TaskInstance['status']): string {
  switch (status) {
    case 'done':
      return 'COMPLETE';
    case 'skipped':
      return 'SKIPPED';
    case 'missed':
      return 'MISSED';
    default:
      return 'PENDING';
  }
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
  const clockFormat = useUiStore((s) => s.clockFormat);
  const date = useTasksStore((s) => s.date);
  const instances = useTasksStore((s) => s.instances);
  const loading = useTasksStore((s) => s.loading);
  const refresh = useTasksStore((s) => s.refresh);
  const setDate = useTasksStore((s) => s.setDate);
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const skipTask = useTasksStore((s) => s.skipTask);

  const [now, setNow] = useState(() => new Date());
  const [slot, setSlot] = useState<SkillSlot | null>(null);
  const [slotLastTs, setSlotLastTs] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideSkills, setOverrideSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [onTime, setOnTime] = useState<OnTimeStats>({ done: 0, planned: 0, onTimePct: null });
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [menuInstance, setMenuInstance] = useState<TaskInstance | null>(null);
  const [menuInitialView, setMenuInitialView] = useState<'menu' | 'reschedule'>('menu');
  const [editingInstance, setEditingInstance] = useState<TaskInstanceEx | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);

  // View mode & priority filter
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [filterPriority, setFilterPriority] = useState<Priority | null>(null);
  // Next-up card tab: 'up' = soonest, 'next' = the one after
  const [nextTab, setNextTab] = useState<'up' | 'next'>('up');

  // Quick add
  const [quickTitle, setQuickTitle] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

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
        setCategories(cats);
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

  useFocusEffect(
    useCallback(() => {
      void syncDay();
    }, [syncDay])
  );

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

  const openOverridePicker = useCallback(async () => {
    if (!slot?.category) return;
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

  const handleQuickAdd = useCallback(async () => {
    const clean = quickTitle.trim();
    if (!clean || quickBusy) return;
    setQuickBusy(true);
    try {
      void haptics.check();
      const catId = categories[0]?.id ?? null;
      const prio: Priority = filterPriority ?? 'medium';
      const tpl = await createTemplate(db, {
        title: clean,
        categoryId: catId,
        durationMin: 30,
        recurrence: 'once',
        customDays: [],
        targetDate: date,
        alarmTime: null,
        isRitual: false,
        priority: prio,
      });
      await createInstance(db, {
        templateId: tpl.id,
        date,
        title: clean,
        categoryId: catId,
        durationMin: 30,
        alarmTime: null,
        isRitual: false,
        priority: prio,
      });
      setQuickTitle('');
      await refresh(date);
    } catch (e) {
      console.error('[today] quick add failed', e);
    } finally {
      setQuickBusy(false);
    }
  }, [quickTitle, quickBusy, filterPriority, categories, db, date, refresh]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, k) => addDays(date, k - 3)),
    [date]
  );

  const rituals = useMemo(() => instances.filter((i) => i.isRitual), [instances]);
  const allTasks = useMemo(() => instances.filter((i) => !i.isRitual), [instances]);

  const filteredTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (filterPriority && (t.priority ?? 'medium') !== filterPriority) return false;
      return true;
    });
  }, [allTasks, filterPriority]);

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
          await haptics.complete();
        }
      } catch {
        /* ignore */
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
        /* ignore */
      }
      await skipTask(id);
    },
    [skipTask]
  );

  const nowHHMM = localTimeString(now);
  const todayStr = localDateString();

  // Upcoming queue: pending tasks, those with alarm times first (sorted), then the rest
  const upcoming = useMemo(() => {
    const pending = allTasks.filter((t) => t.status === 'pending');
    const timed = pending
      .filter((t) => t.alarmTime)
      .sort((a, b) => (a.alarmTime! >= nowHHMM ? 0 : 1) - (b.alarmTime! >= nowHHMM ? 0 : 1) || a.alarmTime!.localeCompare(b.alarmTime!));
    const untimed = pending.filter((t) => !t.alarmTime);
    return [...timed, ...untimed];
  }, [allTasks, nowHHMM]);

  const nextUp = upcoming[0] ?? null;
  const nextAfter = upcoming[1] ?? null;
  const displayedNext = nextTab === 'next' ? nextAfter ?? nextUp : nextUp;

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
    setEditingInstance({ ...item, skillId: null } as TaskInstanceEx);
    setEditSheetOpen(true);
  }, []);

  const showNextCard = date === todayStr && displayedNext !== null;

  // Day progress
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayFrac = Math.min(1, Math.max(0, (now.getTime() - startOfDay.getTime()) / 86400000));
  const dayPct = Math.round(dayFrac * 100);
  const timeStr = now.toLocaleTimeString('en-GB', {
    hour12: clockFormat === '12h',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateLabel = now.toLocaleDateString('en-GB', DATE_FMT).toUpperCase();
  const doneLine = `${onTime.done} of ${onTime.planned} done`;

  // Group tasks for timeline view
  const timelineGroups = useMemo(() => {
    const morning: TaskInstance[] = [];
    const afternoon: TaskInstance[] = [];
    const evening: TaskInstance[] = [];
    const anytime: TaskInstance[] = [];
    for (const t of filteredTasks) {
      if (!t.alarmTime) {
        anytime.push(t);
        continue;
      }
      const hr = Number(t.alarmTime.split(':')[0]);
      if (hr < 12) morning.push(t);
      else if (hr < 17) afternoon.push(t);
      else evening.push(t);
    }
    return [
      { label: 'MORNING · 00:00–11:59', items: morning },
      { label: 'AFTERNOON · 12:00–16:59', items: afternoon },
      { label: 'EVENING · 17:00–23:59', items: evening },
      { label: 'UNSCHEDULED', items: anytime },
    ].filter((g) => g.items.length > 0);
  }, [filteredTasks]);

  const ritualsDone = rituals.filter((r) => r.status === 'done').length;

  const renderTaskCard = (t: TaskInstance, index: number) => (
    <Animated.View
      key={t.id}
      entering={FadeInDown.duration(180).delay(Math.min(index * 30, 180))}
      layout={LinearTransition.duration(180)}
    >
      <TodayTaskCard
        item={t}
        theme={theme}
        clockFormat={clockFormat}
        overdue={isOverdue(t)}
        onToggle={() => handleToggle(t)}
        onSkip={() => handleSkip(t.id)}
        onReschedule={() => openReschedule(t)}
        onLongPress={() => openMenu(t)}
      />
    </Animated.View>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1 — Header row */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerCaption, { color: theme.textFaint }]}>{dateLabel}</Text>
          <Text style={[styles.headerCaption, { color: theme.textFaint }]}>DAY {dayPct}%</Text>
        </View>

        {/* 2 — Big live clock + thin day-progress bar + done line */}
        <Text
          style={[styles.bigClock, { color: theme.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {timeStr}
        </Text>
        <View style={[styles.dayBarTrack, { backgroundColor: theme.surface3 }]}>
          <View
            style={[
              styles.dayBarFill,
              { width: `${Math.max(2, dayPct)}%`, backgroundColor: theme.text },
            ]}
          />
        </View>
        <Text style={[styles.doneLine, { color: theme.textDim }]}>{doneLine}</Text>

        {/* 3 — Week strip */}
        <View style={styles.weekRow}>
          {weekDays.map((d) => {
            const selected = d === date;
            const isToday = d === todayStr;
            return (
              <PressableScale
                key={d}
                onPress={() => setDate(d)}
                hitSlop={4}
                style={styles.dayCellWrap}
                innerStyle={[
                  styles.dayCell,
                  {
                    backgroundColor: selected ? theme.accent : 'transparent',
                    borderLeftColor: theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dayDow,
                    { color: selected ? theme.onAccent : theme.textFaint },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {weekdayShort(d)}
                </Text>
                <Text
                  style={[
                    styles.dayNum,
                    {
                      color: selected
                        ? theme.onAccent
                        : isToday
                        ? theme.text
                        : theme.textDim,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {dayNum(d)}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        {/* 4 — Today's Progress card */}
        <View
          style={[
            styles.progressCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={styles.progressRow}>
            <View style={styles.ringWrap}>
              <ProgressRing theme={theme} done={onTime.done} planned={onTime.planned} />
              <Text style={[styles.ringPct, { color: theme.textFaint }]}>
                {onTime.planned > 0 ? Math.round((onTime.done / onTime.planned) * 100) : 0}%
              </Text>
            </View>
            <View style={styles.progressText}>
              <Text style={[styles.sectionCaption, { color: theme.textFaint }]}>
                TODAY&apos;S PROGRESS
              </Text>
              <Text style={[styles.progressHeading, { color: theme.text }]} numberOfLines={1}>
                {doneLine}
              </Text>
              <Text style={[styles.small, { color: theme.textDim }]} numberOfLines={2}>
                {onTime.onTimePct === null
                  ? 'Complete scheduled tasks to track on time rate'
                  : `${onTime.onTimePct}% completed within ${graceMin}m grace`}
              </Text>
            </View>
          </View>
        </View>

        {/* 5 — Next Up card */}
        {showNextCard && displayedNext && (
          <View
            style={[
              styles.nextCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <View style={styles.nextTopRow}>
              <Text style={[styles.sectionCaption, { color: theme.textFaint }]}>NEXT UP</Text>
              <View
                style={[
                  styles.upNextToggle,
                  { backgroundColor: theme.surface2, borderColor: theme.border },
                ]}
              >
                {(['up', 'next'] as const).map((tab) => {
                  const active = nextTab === tab;
                  return (
                    <PressableScale
                      key={tab}
                      onPress={() => setNextTab(tab)}
                      hitSlop={HIT_SLOP}
                      innerStyle={[
                        styles.upNextTab,
                        active && { backgroundColor: theme.accent },
                      ]}
                    >
                      <Text
                        style={[
                          styles.upNextTabText,
                          { color: active ? theme.onAccent : theme.textDim },
                        ]}
                      >
                        {tab.toUpperCase()}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
            <Text style={[styles.nextTitle, { color: theme.text }]} numberOfLines={2}>
              {displayedNext.title}
            </Text>
            <View style={styles.nextActions}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Start Timer"
                  variant="primary"
                  fullWidth
                  icon={<Play color={theme.onAccent} size={15} strokeWidth={2.4} />}
                  onPress={() =>
                    router.push({
                      pathname: '/timer',
                      params: { instanceId: displayedNext.id },
                    })
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Mark Done"
                  variant="secondary"
                  fullWidth
                  icon={<Check color={theme.text} size={15} strokeWidth={2.5} />}
                  onPress={() => handleToggle(displayedNext)}
                />
              </View>
            </View>
          </View>
        )}

        {/* Rituals block */}
        {rituals.length > 0 && (
          <Card padding={2} elevated>
            <View style={styles.blockHeader}>
              <Text style={[styles.sectionCaption, { color: theme.textFaint }]}>
                MORNING RITUALS
              </Text>
              <Text style={[styles.monoBadge, { color: theme.textDim }]}>
                {ritualsDone}/{rituals.length}
              </Text>
            </View>
            <View style={styles.ritualList}>
              {rituals.map((r, idx) => (
                <RitualRow
                  key={r.id}
                  item={r}
                  theme={theme}
                  isLast={idx === rituals.length - 1}
                  onToggle={() => handleToggle(r)}
                />
              ))}
            </View>
          </Card>
        )}

        {/* Skill slot */}
        {slot && (slot.skill || slot.category) && (
          <Card padding={2} leftRuleColor={theme.accent}>
            <View style={styles.slotHeader}>
              <View style={styles.slotInfo}>
                <View style={styles.slotTitleRow}>
                  <Sparkles color={theme.textDim} size={13} strokeWidth={2} />
                  <Text style={[styles.sectionCaption, { color: theme.textFaint }]}>
                    CREATIVE SKILL SLOT
                  </Text>
                </View>
                <Text style={[styles.h3, { color: theme.text }]} numberOfLines={1}>
                  {slot.skill ? slot.skill.name : 'No skill configured'}
                </Text>
                <Text style={[styles.small, { color: theme.textDim }]} numberOfLines={1}>
                  {slot.category ? slot.category.name : 'General'}
                  {slot.skill ? ` · ${daysAgoLabel(slotLastTs, date)}` : ''}
                  {slot.overridden ? ' · Overridden' : ''}
                </Text>
              </View>
              <Button
                label="Change"
                variant="secondary"
                size="sm"
                onPress={openOverridePicker}
              />
            </View>
            {slot.skill && (
              <View style={{ marginTop: space(1.5) }}>
                <Button
                  label="Start Focus Session"
                  variant="primary"
                  fullWidth
                  icon={<Play color={theme.onAccent} size={15} strokeWidth={2.4} />}
                  onPress={() =>
                    router.push({
                      pathname: '/timer',
                      params: { instanceId: '', skillId: slot.skill!.id },
                    })
                  }
                />
              </View>
            )}
          </Card>
        )}

        {/* 6 — Quick-add */}
        <View
          style={[
            styles.quickAddWrap,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <TextInput
            value={quickTitle}
            onChangeText={setQuickTitle}
            placeholder="Quick-add task for this day..."
            placeholderTextColor={theme.textFaint}
            returnKeyType="done"
            onSubmitEditing={handleQuickAdd}
            style={[styles.quickInput, { color: theme.text }]}
          />
          <PressableScale
            onPress={handleQuickAdd}
            disabled={!quickTitle.trim() || quickBusy}
            style={styles.quickBtn}
            innerStyle={[
              styles.quickBtnInner,
              {
                backgroundColor: quickTitle.trim() ? theme.accent : theme.surface2,
                borderColor: theme.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Quick add task"
          >
            <Plus
              color={quickTitle.trim() ? theme.onAccent : theme.textFaint}
              size={18}
              strokeWidth={2.5}
            />
          </PressableScale>
        </View>

        {/* 7 — Schedule header + List/Timeline toggle */}
        <View style={styles.tasksHeader}>
          <Text style={[styles.sectionTitle, { color: theme.textDim }]}>SCHEDULE</Text>
          <View
            style={[
              styles.viewToggle,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <PressableScale
              onPress={() => setViewMode('list')}
              hitSlop={HIT_SLOP}
              style={styles.toggleItem}
              innerStyle={[
                styles.toggleInner,
                viewMode === 'list' && { backgroundColor: theme.accent },
              ]}
              accessibilityRole="button"
              accessibilityLabel="List view"
            >
              <AlignLeft
                color={viewMode === 'list' ? theme.onAccent : theme.textDim}
                size={14}
                strokeWidth={2}
              />
              <Text
                style={[
                  styles.toggleText,
                  { color: viewMode === 'list' ? theme.onAccent : theme.textDim },
                ]}
              >
                List
              </Text>
            </PressableScale>
            <PressableScale
              onPress={() => setViewMode('timeline')}
              hitSlop={HIT_SLOP}
              style={styles.toggleItem}
              innerStyle={[
                styles.toggleInner,
                viewMode === 'timeline' && { backgroundColor: theme.accent },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Timeline view"
            >
              <Clock
                color={viewMode === 'timeline' ? theme.onAccent : theme.textDim}
                size={14}
                strokeWidth={2}
              />
              <Text
                style={[
                  styles.toggleText,
                  { color: viewMode === 'timeline' ? theme.onAccent : theme.textDim },
                ]}
              >
                Timeline
              </Text>
            </PressableScale>
          </View>
        </View>

        {/* 8 — Priority filter chips */}
        {allTasks.length > 0 && (
          <View style={styles.filterRow}>
            <FilterChip
              label="All"
              active={filterPriority === null}
              theme={theme}
              onPress={() => setFilterPriority(null)}
            />
            {(['high', 'medium', 'low'] as Priority[]).map((p) => (
              <FilterChip
                key={p}
                label={p === 'high' ? 'High Prio' : p === 'medium' ? 'Med Prio' : 'Low Prio'}
                active={filterPriority === p}
                theme={theme}
                onPress={() => setFilterPriority(filterPriority === p ? null : p)}
              />
            ))}
          </View>
        )}

        {/* 9 — Task list / timeline */}
        {loading ? (
          <View style={{ gap: space(1.25) }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={96} />
            ))}
          </View>
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title={allTasks.length === 0 ? 'No tasks scheduled' : 'No matching tasks'}
            subtitle={
              allTasks.length === 0
                ? 'Start building your day with a timed task or morning ritual.'
                : 'Clear your active priority filter to see all tasks.'
            }
            actionLabel={allTasks.length === 0 ? 'New Task' : 'Reset Filters'}
            onAction={() => {
              if (allTasks.length === 0) setAddSheetOpen(true);
              else setFilterPriority(null);
            }}
          />
        ) : viewMode === 'list' ? (
          <View style={styles.taskList}>
            {filteredTasks.map((t, index) => renderTaskCard(t, index))}
          </View>
        ) : (
          <View style={styles.timelineWrap}>
            {timelineGroups.map((group) => (
              <View key={group.label} style={styles.timelineBlock}>
                <View style={styles.timelineHeader}>
                  <View style={[styles.timelineDot, { backgroundColor: theme.accent }]} />
                  <Text style={[styles.sectionCaption, { color: theme.textDim }]}>
                    {group.label}
                  </Text>
                </View>
                <View style={[styles.timelineRail, { borderLeftColor: theme.borderStrong }]}>
                  {group.items.map((t, index) => renderTaskCard(t, index))}
                </View>
              </View>
            ))}
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

      <Sheet
        visible={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Select Today's Skill"
      >
        <View style={{ gap: space(1), paddingTop: space(1) }}>
          {overrideSkills.map((s) => (
            <PressableScale
              key={s.id}
              onPress={() => applyOverride(s.id)}
              style={styles.overrideRow}
              innerStyle={[
                styles.overrideRowInner,
                {
                  backgroundColor:
                    slot?.skill?.id === s.id ? theme.surface3 : theme.surface2,
                  borderColor:
                    slot?.skill?.id === s.id ? theme.borderStrong : theme.border,
                },
              ]}
            >
              <Text style={[styles.body, { color: theme.text }]}>{s.name}</Text>
              {slot?.skill?.id === s.id && (
                <Check color={theme.text} size={18} strokeWidth={2.5} />
              )}
            </PressableScale>
          ))}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  theme,
  onPress,
}: {
  label: string;
  active: boolean;
  theme: ThemePalette;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={HIT_SLOP}
      innerStyle={[
        styles.filterChip,
        {
          backgroundColor: active ? theme.accent : 'transparent',
          borderColor: active ? theme.accent : theme.border,
        },
      ]}
    >
      <Text
        style={[
          styles.filterChipText,
          { color: active ? theme.onAccent : theme.textDim },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/** Screenshot-style task card: status bar on top, checkbox row, SKIP/MOVE actions. */
function TodayTaskCard({
  item,
  theme,
  clockFormat,
  overdue,
  onToggle,
  onSkip,
  onReschedule,
  onLongPress,
}: {
  item: TaskInstance;
  theme: ThemePalette;
  clockFormat: '12h' | '24h';
  overdue: boolean;
  onToggle: () => void;
  onSkip: () => void;
  onReschedule: () => void;
  onLongPress: () => void;
}) {
  const done = item.status === 'done';
  const prio = item.priority ?? 'medium';
  const prioLabel = prio === 'high' ? 'HIGH' : prio === 'low' ? 'LOW' : 'MED';

  return (
    <View
      style={[
        styles.taskCard,
        {
          backgroundColor: theme.surface,
          borderColor: overdue && !done ? theme.borderStrong : theme.border,
        },
      ]}
    >
      {/* Status bar */}
      <View
        style={[
          styles.statusBar,
          {
            backgroundColor: done ? theme.accent : theme.surface2,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <Check
          color={done ? theme.onAccent : theme.textDim}
          size={13}
          strokeWidth={2.5}
        />
        <Text
          style={[
            styles.statusBarText,
            { color: done ? theme.onAccent : theme.textDim },
          ]}
        >
          {statusLabel(item.status)}
        </Text>
      </View>

      <View style={styles.taskBody}>
        {/* Checkbox */}
        <Pressable
          onPress={onToggle}
          onLongPress={onLongPress}
          delayLongPress={400}
          style={styles.taskCheck}
          hitSlop={HIT_SLOP}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={item.title}
        >
          <AnimatedCheck checked={done} theme={theme} />
        </Pressable>

        {/* Title + meta */}
        <Pressable
          onPress={onToggle}
          onLongPress={onLongPress}
          delayLongPress={400}
          style={styles.taskMain}
        >
          <Text
            style={[
              styles.taskTitle,
              {
                color: done ? theme.textFaint : theme.text,
                textDecorationLine: done ? 'line-through' : 'none',
              },
            ]}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          <View style={styles.taskMeta}>
            <Clock color={theme.textFaint} size={12} strokeWidth={2} />
            <Text style={[styles.taskMetaText, { color: theme.textFaint }]}>
              {item.alarmTime ? formatTimeDisplay(item.alarmTime, clockFormat) : '--:--'}
            </Text>
            <Text style={[styles.taskMetaText, { color: theme.textFaint }]}>·</Text>
            <Text style={[styles.taskMetaText, { color: theme.textFaint }]}>
              {item.durationMin}m
            </Text>
            <Text style={[styles.taskMetaText, { color: theme.textFaint }]}>·</Text>
            <View style={[styles.prioBadge, { borderColor: theme.border }]}>
              <Text style={[styles.prioBadgeText, { color: theme.textDim }]}>
                {prioLabel}
              </Text>
            </View>
            {overdue && !done && (
              <View style={[styles.lateBadge, { backgroundColor: theme.accent }]}>
                <Text style={[styles.lateBadgeText, { color: theme.onAccent }]}>LATE</Text>
              </View>
            )}
          </View>
        </Pressable>

        {/* SKIP / MOVE actions */}
        <View style={styles.taskActions}>
          <PressableScale
            onPress={onSkip}
            hitSlop={HIT_SLOP}
            innerStyle={styles.taskActionBtn}
            accessibilityRole="button"
            accessibilityLabel="Skip task"
          >
            <SkipForward color={theme.textDim} size={16} strokeWidth={2} />
            <Text style={[styles.taskActionLabel, { color: theme.textDim }]}>SKIP</Text>
          </PressableScale>
          <PressableScale
            onPress={onReschedule}
            hitSlop={HIT_SLOP}
            innerStyle={styles.taskActionBtn}
            accessibilityRole="button"
            accessibilityLabel="Move task"
          >
            <CalendarDays color={theme.textDim} size={16} strokeWidth={2} />
            <Text style={[styles.taskActionLabel, { color: theme.textDim }]}>MOVE</Text>
          </PressableScale>
        </View>
      </View>
    </View>
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
  const size = 84;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = planned > 0 ? done / planned : 0;

  const progress = useSharedValue(0);
  const [displayDone, setDisplayDone] = useState(0);

  useEffect(() => {
    progress.value = withTiming(frac, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
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
          stroke={theme.surface3}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={theme.text}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          animatedProps={animatedProps}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={[styles.ringNumber, { color: theme.text }]}>{`${displayDone}`}</Text>
        <Text style={[styles.ringSub, { color: theme.textFaint }]}>/{planned}</Text>
      </View>
    </View>
  );
}

function RitualRow({
  item,
  theme,
  isLast,
  onToggle,
}: {
  item: TaskInstance;
  theme: ThemePalette;
  isLast: boolean;
  onToggle: () => void;
}) {
  const done = item.status === 'done';
  return (
    <PressableScale
      onPress={onToggle}
      hitSlop={HIT_SLOP}
      innerStyle={[
        styles.ritualRow,
        !isLast && { borderBottomWidth: 1, borderBottomColor: theme.border },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
    >
      <AnimatedCheck checked={done} theme={theme} />
      <Text
        style={[
          styles.body,
          {
            flex: 1,
            color: done ? theme.textFaint : theme.text,
            textDecorationLine: done ? 'line-through' : 'none',
          },
        ]}
        numberOfLines={1}
      >
        {item.title}
      </Text>
      <Text style={[styles.monoSmall, { color: theme.textFaint }]}>
        {item.durationMin}m
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: space(2),
    paddingTop: space(1),
    gap: space(2),
  },
  // 1 — Header row
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space(0.5),
  },
  headerCaption: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  // 2 — Big clock
  bigClock: {
    ...type.clock,
    fontSize: 64,
    lineHeight: 72,
    fontWeight: '700',
    marginTop: space(1),
    fontVariant: ['tabular-nums'],
  },
  dayBarTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: space(1.5),
  },
  dayBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  doneLine: {
    ...type.small,
    marginTop: space(1),
  },
  // 3 — Week strip
  weekRow: {
    flexDirection: 'row',
    marginTop: space(0.5),
  },
  dayCellWrap: {
    flex: 1,
  },
  dayCell: {
    minHeight: TAP + 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space(1),
    borderRadius: radius.md,
    borderLeftWidth: 1,
    gap: 2,
  },
  dayDow: {
    ...type.caption,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  dayNum: {
    ...type.mono,
    fontSize: 16,
    fontWeight: '700',
  },
  // 4 — Progress card
  progressCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2.5),
  },
  ringWrap: {
    alignItems: 'center',
    gap: 4,
  },
  ringPct: {
    ...type.mono,
    fontSize: 12,
    fontWeight: '600',
  },
  progressText: {
    flex: 1,
    gap: 4,
  },
  progressHeading: {
    ...type.h2,
    fontSize: 20,
    lineHeight: 26,
  },
  ringCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  ringNumber: {
    ...type.mono,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
  },
  ringSub: {
    ...type.mono,
    fontSize: 10,
    lineHeight: 12,
  },
  // 5 — Next Up card
  nextCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
    gap: space(1.5),
  },
  nextTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  upNextToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 2,
    gap: 2,
  },
  upNextTab: {
    paddingHorizontal: space(1.5),
    minHeight: 30,
    borderRadius: radius.sm - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upNextTabText: {
    ...type.caption,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  nextTitle: {
    ...type.h2,
    fontSize: 20,
    lineHeight: 26,
  },
  nextActions: {
    flexDirection: 'row',
    gap: space(1.25),
    marginTop: space(0.5),
  },
  // Rituals + skill slot
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space(1),
  },
  ritualList: {
    gap: 2,
  },
  ritualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    minHeight: TAP,
    paddingVertical: space(1),
  },
  slotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(1.5),
  },
  slotInfo: {
    flex: 1,
    gap: 4,
  },
  slotTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // 6 — Quick-add
  quickAddWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingLeft: space(2),
    paddingRight: space(0.75),
    minHeight: TAP + 4,
    gap: space(1),
  },
  quickInput: {
    flex: 1,
    ...type.body,
    paddingVertical: space(1),
  },
  quickBtn: {
    width: TAP,
    height: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBtnInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 7 — Schedule header
  tasksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space(0.5),
  },
  sectionTitle: {
    ...type.caption,
    fontSize: 12,
    letterSpacing: 1.4,
  },
  sectionCaption: {
    ...type.caption,
  },
  viewToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 2,
    gap: 2,
  },
  toggleItem: {},
  toggleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space(1.25),
    minHeight: 34,
    borderRadius: radius.sm - 2,
  },
  toggleText: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  // 8 — Filter chips
  filterRow: {
    flexDirection: 'row',
    gap: space(1),
    paddingVertical: 2,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space(2),
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipText: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  // 9 — Task cards
  taskList: {
    gap: space(1.5),
  },
  taskCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space(2),
    paddingVertical: space(1),
    borderBottomWidth: 1,
  },
  statusBarText: {
    ...type.caption,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  taskBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space(1.5),
    paddingLeft: space(1),
    paddingRight: space(1.5),
    gap: space(0.5),
  },
  taskCheck: {
    width: TAP,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskMain: {
    flex: 1,
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  taskTitle: {
    ...type.body,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskMetaText: {
    ...type.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  prioBadge: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  prioBadgeText: {
    ...type.mono,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  lateBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lateBadgeText: {
    ...type.caption,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  taskActions: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingLeft: space(1),
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(128,128,128,0.15)',
  },
  taskActionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: space(1),
    paddingVertical: 6,
    minWidth: 52,
  },
  taskActionLabel: {
    ...type.caption,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  // Timeline
  timelineWrap: {
    gap: space(2),
  },
  timelineBlock: {
    gap: space(1),
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineRail: {
    borderLeftWidth: 1,
    marginLeft: 3.5,
    paddingLeft: space(1.75),
    gap: space(1.5),
  },
  overrideRow: {},
  overrideRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TAP,
    paddingHorizontal: space(2),
    borderRadius: radius.md,
    borderWidth: 1,
  },
  h3: { ...type.h3 },
  body: { ...type.body },
  small: { ...type.small },
  monoSmall: {
    ...type.mono,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  monoBadge: {
    ...type.mono,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});
