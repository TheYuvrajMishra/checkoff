import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import Animated, {
  createAnimatedComponent,
  Easing,
  FadeInDown,
  LinearTransition,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  BarChart3,
  CalendarPlus,
  Check,
  ChevronRight,
  Clock,
  Flame,
  Trophy,
  List,
  MoreVertical,
  Play,
  Plus,
  Rows3,
  Star,
  Target,
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
  useTheme,
} from '../../theme/tokens';
import { AddTaskSheet } from '../../components/AddTaskSheet';
import { EmptyState } from '../../components/EmptyState';
import { Fab, FAB_CLEARANCE } from '../../components/Fab';
import { MetalFill } from '../../components/Button';
import { PressableScale } from '../../components/PressableScale';
import { Skeleton } from '../../components/Skeleton';
import { TaskActionSheet } from '../../components/TaskActionSheet';
import { formatTimeDisplay } from '../../components/TaskRow';
import { createInstance, type TaskInstanceEx } from '../../db/repos/instances';
import {
  addDays,
  localDateString,
  localTimeString,
} from '../../db/time';
import { ensureInstancesForDate, markPastDueMissed } from '../../tasks/recurrence';
import { getLogEvents } from '../../db/log';
import { listCategories } from '../../db/repos/categories';
import { instancesInRange, sessionsInRange } from '../../stats/queries';
import { haptics } from '../../haptics';
import {
  claimDailyReward,
  getBalance,
  getDailyRewardState,
  type DailyRewardState,
} from '../../rewards/engine';
import type { Category, Priority, TaskInstance } from '../../db/types';

const AnimatedCircle = createAnimatedComponent(Circle);

type HeroKey = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * Static requires must be literal, so each hero variant gets its own call.
 * The try/catch keeps the screen alive if a file is ever deleted; the
 * placeholders in src/assets/ currently stand in for the real artwork —
 * replace them with the real hero-dawn/day/dusk/night.webp exports.
 */
function heroSourceForKey(key: HeroKey): number | null {
  try {
    switch (key) {
      case 'dawn':
        return require('../../assets/hero-dawn.webp');
      case 'day':
        return require('../../assets/hero-day.webp');
      case 'dusk':
        return require('../../assets/hero-dusk.webp');
      case 'night':
      default:
        return require('../../assets/hero-night.webp');
    }
  } catch {
    return null;
  }
}

function nextupSource(): number | null {
  try {
    return require('../../assets/nextup-backdrop.webp');
  } catch {
    return null;
  }
}

function rewardChestSource(): number | null {
  try {
    return require('../../assets/reward-chest.webp');
  } catch {
    return null;
  }
}

function heroKeyForHour(h: number): HeroKey {
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

function greetingForHour(h: number): string {
  if (h >= 5 && h < 12) return 'Good morning,';
  if (h >= 12 && h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString('en-GB', { weekday: 'short' })
    .toUpperCase();
}

function dayNum(dateStr: string): string {
  return String(Number(dateStr.split('-')[2]));
}

function priorityDotColor(p: Priority, theme: ThemePalette): string {
  if (p === 'high') return '#EF4444';
  if (p === 'low') return '#22C55E';
  return theme.text;
}

function priorityLabel(p: Priority): string {
  return p === 'high' ? 'HIGH' : p === 'low' ? 'LOW' : 'MED';
}

type TaskFilter = 'all' | Priority | 'completed';

interface OnTimeStats {
  done: number;
  planned: number;
  onTimePct: number | null;
}

interface HeaderStats {
  streak: number;
  focusMin: number;
  points: number;
  dayCounts: Record<string, number>;
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

  const [now, setNow] = useState(() => new Date());
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);
  const [categories, setCategories] = useState<Category[]>([]);
  const [onTime, setOnTime] = useState<OnTimeStats>({ done: 0, planned: 0, onTimePct: null });
  const [header, setHeader] = useState<HeaderStats>({
    streak: 0,
    focusMin: 0,
    points: 0,
    dayCounts: {},
  });
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [menuInstance, setMenuInstance] = useState<TaskInstance | null>(null);
  const [menuInitialView, setMenuInitialView] = useState<'menu' | 'reschedule'>('menu');
  const [editingInstance, setEditingInstance] = useState<TaskInstanceEx | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);

  // View mode & filter
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [filter, setFilter] = useState<TaskFilter>('all');

  // Quick add

  // Daily reward state from the real rewards engine.
  const [rewardState, setRewardState] = useState<DailyRewardState | null>(null);
  // Shown day numbers on the 7-day reward track.
  const SHOWN_DAYS = [1, 2, 3, 4, 5, 6, 7];
  const claimableIndex = (() => {
    const day = rewardState?.currentDay ?? 1;
    const exact = SHOWN_DAYS.indexOf(day);
    if (exact !== -1) return exact;
    const next = SHOWN_DAYS.findIndex((d) => d > day);
    return next !== -1 ? next : SHOWN_DAYS.length - 1;
  })();
  const rewardClaimed = SHOWN_DAYS.map((d) => {
    const day = rewardState?.currentDay ?? 1;
    if (d < day) return true;
    if (d === day) return rewardState?.claimed ?? false;
    return false;
  });
  const rewardClaimable = (rewardState?.earned ?? false) && !(rewardState?.claimed ?? true);

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

  // On-time completion stats for the viewed day (drives the progress card).
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

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, k) => addDays(date, k - 3)),
    [date]
  );

  // Header stats: week-strip dots, streak, focus minutes, total points.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const today = localDateString();

        const placeholders = weekDays.map(() => '?').join(',');
        const countRows = await db.getAllAsync<{ date: string; c: number }>(
          `SELECT date, COUNT(*) AS c FROM task_instances
           WHERE date IN (${placeholders}) AND deleted = 0 GROUP BY date`,
          ...weekDays
        );

        // Day streak = consecutive ritual-perfect days (same definition as Stats).
        const all = await instancesInRange(db, addDays(today, -365), today);
        const byDay = new Map<string, { rituals: number; done: number; failed: number }>();
        for (const inst of all) {
          if (!inst.isRitual) continue;
          const cur = byDay.get(inst.date) ?? { rituals: 0, done: 0, failed: 0 };
          cur.rituals += 1;
          if (inst.status === 'done') cur.done += 1;
          else cur.failed += 1;
          byDay.set(inst.date, cur);
        }
        const isStreakDay = (d?: { rituals: number; done: number; failed: number }) =>
          Boolean(d && d.rituals > 0 && d.failed === 0 && d.done === d.rituals);
        const startOffset = isStreakDay(byDay.get(today)) ? 0 : -1;
        let streak = 0;
        for (let i = startOffset; i >= -365; i--) {
          if (isStreakDay(byDay.get(addDays(today, i)))) streak += 1;
          else break;
        }

        // Focus minutes for the viewed day from timer sessions.
        const [y, m, d] = date.split('-').map(Number);
        const fromUtc = new Date(y, m - 1, d, 0, 0, 0).toISOString();
        const toUtc = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
        const sessions = await sessionsInRange(db, fromUtc, toUtc);
        let focusMin = 0;
        for (const s of sessions) {
          if (!s.endedAtUtc) continue;
          const ms =
            new Date(s.endedAtUtc).getTime() - new Date(s.startedAtUtc).getTime();
          if (ms > 0) focusMin += ms / 60000;
        }

        // Total points = real ledger balance from the rewards engine.
        const bal = await getBalance(db);

        // Daily reward strip state.
        const rs = await getDailyRewardState(db, today);

        if (!cancelled) {
          setHeader({
            streak,
            focusMin: Math.round(focusMin),
            points: bal,
            dayCounts: Object.fromEntries(countRows.map((r) => [r.date, r.c])),
          });
          setRewardState(rs);
        }
      } catch (e) {
        console.error('[today] header stats failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, date, instances, weekDays]);

  const handleClaimReward = useCallback(async () => {
    try {
      await claimDailyReward(db, localDateString());
      try {
        void haptics.success();
      } catch {
        /* ignore */
      }
      // Refresh strip state + points after claim.
      try {
        const [rs, bal] = await Promise.all([
          getDailyRewardState(db, localDateString()),
          getBalance(db),
        ]);
        if (!cancelledRef.current) {
          setRewardState(rs);
          setHeader((h) => ({ ...h, points: bal }));
        }
      } catch {
        /* ignore */
      }
    } catch (e) {
      // Not earned / already claimed / expired — surface quietly.
      console.warn('[today] claim failed', e);
    }
  }, [db]);


  const filteredTasks = useMemo(() => {
    return instances.filter((t) => {
      if (filter === 'completed') return t.status === 'done';
      if (filter !== 'all' && (t.priority ?? 'medium') !== filter) return false;
      return true;
    });
  }, [instances, filter]);

  const handleToggle = useCallback(
    async (item: TaskInstance) => {
      const willComplete = item.status !== 'done';
      try {
        if (!willComplete) {
          await haptics.uncheck();
        } else if (item.isRitual) {
          const remaining = instances.filter(
            (r) => r.isRitual && r.id !== item.id && r.status !== 'done'
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
    [instances, toggleDone]
  );

  const nowHHMM = localTimeString(now);
  const todayStr = localDateString();

  // Next-up queue: pending non-ritual tasks, timed ones first (future first).
  const schedulable = useMemo(() => instances.filter((i) => !i.isRitual), [instances]);
  const upcoming = useMemo(() => {
    const pending = schedulable.filter((t) => t.status === 'pending');
    const timed = pending
      .filter((t) => t.alarmTime)
      .sort(
        (a, b) =>
          (a.alarmTime! >= nowHHMM ? 0 : 1) - (b.alarmTime! >= nowHHMM ? 0 : 1) ||
          a.alarmTime!.localeCompare(b.alarmTime!)
      );
    const untimed = pending.filter((t) => !t.alarmTime);
    return [...timed, ...untimed];
  }, [schedulable, nowHHMM]);

  const nextUp = upcoming[0] ?? null;

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

  const handleEdit = useCallback((item: TaskInstance) => {
    setMenuInstance(null);
    setEditingInstance({ ...item, skillId: null } as TaskInstanceEx);
    setEditSheetOpen(true);
  }, []);

  // Hero content
  const hour = now.getHours();
  const heroSrc = useMemo(() => heroSourceForKey(heroKeyForHour(hour)), [hour]);
  const greeting = greetingForHour(hour);
  const heroDateLabel = now
    .toLocaleDateString('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    .toUpperCase();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayPct = Math.round(
    Math.min(1, Math.max(0, (now.getTime() - startOfDay.getTime()) / 86400000)) * 100
  );

  // Progress card
  const doneCount = onTime.done;
  const plannedCount = onTime.planned;
  const doneLine = `${doneCount} of ${plannedCount} done`;
  const focusLabel =
    header.focusMin >= 60
      ? `${Math.floor(header.focusMin / 60)}h ${header.focusMin % 60}m`
      : `${header.focusMin}m`;

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

  const renderTaskCard = (t: TaskInstance, index: number) => (
    <Animated.View
      key={t.id}
      entering={FadeInDown.duration(180).delay(Math.min(index * 30, 180))}
      layout={LinearTransition.duration(180)}
    >
      <TodayTaskRow
        item={t}
        theme={theme}
        clockFormat={clockFormat}
        overdue={isOverdue(t)}
        onToggle={() => handleToggle(t)}
        onPlay={() =>
          router.push({ pathname: '/timer', params: { instanceId: t.id } })
        }
        onMenu={() => openMenu(t)}
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
        {/* 1 — Time-of-day hero */}
        <View style={[styles.hero, { backgroundColor: '#171310' }]}>
          {heroSrc != null && (
            <Image source={heroSrc} style={styles.heroImg} resizeMode="cover" />
          )}
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="heroScrim" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity="0.28" />
                <Stop offset="0.55" stopColor="#000000" stopOpacity="0.12" />
                <Stop offset="1" stopColor="#000000" stopOpacity="0.74" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#heroScrim)" />
          </Svg>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }} />
            <View style={styles.heroDateCol}>
              <Text style={styles.heroDate} numberOfLines={1}>
                {heroDateLabel}
              </Text>
              <Text style={[styles.heroDayPct, { color: theme.text }]} numberOfLines={1}>
                DAY {dayPct}%
              </Text>
            </View>
          </View>
          <View style={styles.heroBottom}>
            <Text style={styles.heroGreeting}>{greeting}</Text>
            <Text style={styles.heroName}>Yuvraj</Text>
            <Text style={styles.heroQuote}>
              A focused day today, a better tomorrow.
            </Text>
          </View>
        </View>

        {/* 2 — Week strip */}
        <View style={styles.weekRow}>
          {weekDays.map((d) => {
            const selected = d === date;
            const isToday = d === todayStr;
            const hasTasks = (header.dayCounts[d] ?? 0) > 0;
            return (
              <PressableScale
                key={d}
                onPress={() => setDate(d)}
                hitSlop={4}
                style={styles.dayCellWrap}
                innerStyle={[
                  styles.dayCell,
                  { backgroundColor: selected ? theme.accent : 'transparent' },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${weekdayShort(d)} ${dayNum(d)}`}
                accessibilityState={{ selected }}
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
                <View
                  style={[
                    styles.dayDot,
                    {
                      backgroundColor: hasTasks
                        ? selected
                          ? theme.onAccent
                          : theme.accent
                        : 'transparent',
                    },
                  ]}
                />
              </PressableScale>
            );
          })}
        </View>

        {/* 3 — Progress card */}
        <View
          style={[
            styles.progressCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={styles.progressTop}>
            <ProgressRing done={doneCount} planned={plannedCount} />
            <View style={styles.progressText}>
              <View style={styles.progressHeadRow}>
                <Text style={[styles.sectionCaption, { color: theme.textFaint }]}>
                  TODAY&apos;S PROGRESS
                </Text>
                <PressableScale
                  onPress={() => router.push('/stats')}
                  hitSlop={HIT_SLOP}
                  innerStyle={[
                    styles.statsPill,
                    { borderColor: theme.borderStrong },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="View stats"
                >
                  <Text style={[styles.statsPillText, { color: theme.text }]}>
                    View Stats
                  </Text>
                  <ChevronRight color={theme.text} size={13} strokeWidth={2.5} />
                </PressableScale>
              </View>
              <Text style={[styles.progressHeading, { color: theme.text }]} numberOfLines={1}>
                {doneLine}
              </Text>
              <Text style={[styles.small, { color: theme.textDim }]} numberOfLines={2}>
                Complete scheduled tasks to build your streak.
              </Text>
            </View>
          </View>
          <View style={[styles.statsRow, { borderTopColor: theme.border }]}>
            <StatCell
              icon={<Flame color={theme.accent} size={20} strokeWidth={2.2} />}
              value={`${header.streak}d`}
              label="Day Streak"
              theme={theme}
            />
            <StatCell
              icon={<Target color={theme.accent} size={20} strokeWidth={2.2} />}
              value={`${plannedCount}`}
              label="Tasks Today"
              theme={theme}
            />
            <StatCell
              icon={<BarChart3 color={theme.accent} size={20} strokeWidth={2.2} />}
              value={focusLabel}
              label="Focus Time"
              theme={theme}
            />
            <StatCell
              icon={<Star color={theme.accent} size={20} strokeWidth={2.2} />}
              value={`${header.points}`}
              label="Total Points"
              theme={theme}
            />
          </View>
        </View>

        {/* 4 — Next Up card */}
        <NextUpCard
          task={nextUp}
          theme={theme}
          clockFormat={clockFormat}
          onStartTimer={() =>
            nextUp &&
            router.push({ pathname: '/timer', params: { instanceId: nextUp.id } })
          }
          onMarkDone={() => nextUp && handleToggle(nextUp)}
        />

        {/* 5 — Daily Reward card (wired to rewards engine) */}
        <DailyRewardStrip
          theme={theme}
          claimed={rewardClaimed}
          claimableIndex={claimableIndex}
          claimable={rewardClaimable}
          onClaim={handleClaimReward}
        />

        {/* 7 — Schedule header + List/Timeline toggle */}
        <View style={styles.tasksHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Schedule</Text>
          <View
            style={[
              styles.viewToggle,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <PressableScale
              onPress={() => setViewMode('list')}
              hitSlop={HIT_SLOP}
              innerStyle={[
                styles.toggleInner,
                viewMode === 'list' && { backgroundColor: theme.accent },
              ]}
              accessibilityRole="button"
              accessibilityLabel="List view"
            >
              <List
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
              innerStyle={[
                styles.toggleInner,
                viewMode === 'timeline' && { backgroundColor: theme.accent },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Timeline view"
            >
              <Rows3
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

        {/* 8 — Filter chips */}
        <View style={styles.filterRow}>
          <FilterChip
            label="All"
            active={filter === 'all'}
            theme={theme}
            onPress={() => setFilter('all')}
          />
          {(
            [
              { key: 'high', label: 'High Prio', dot: '#EF4444' },
              { key: 'medium', label: 'Med Prio', dot: theme.accent },
              { key: 'low', label: 'Low Prio', dot: '#22C55E' },
            ] as const
          ).map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              dot={f.dot}
              active={filter === f.key}
              theme={theme}
              onPress={() => setFilter(filter === f.key ? 'all' : f.key)}
            />
          ))}
          <FilterChip
            label="Completed"
            check
            active={filter === 'completed'}
            theme={theme}
            onPress={() => setFilter(filter === 'completed' ? 'all' : 'completed')}
          />
        </View>

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
            title={instances.length === 0 ? 'No tasks scheduled' : 'No matching tasks'}
            subtitle={
              instances.length === 0
                ? 'Start building your day with a timed task or morning ritual.'
                : 'Clear your active filter to see all tasks.'
            }
            actionLabel={instances.length === 0 ? 'New Task' : 'Reset Filters'}
            onAction={() => {
              if (instances.length === 0) setAddSheetOpen(true);
              else setFilter('all');
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
    </SafeAreaView>
  );
}

/* ---------------------------------- pieces ---------------------------------- */

function FilterChip({
  label,
  dot,
  check,
  active,
  theme,
  onPress,
}: {
  label: string;
  dot?: string;
  check?: boolean;
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
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {dot != null && (
        <View
          style={[
            styles.filterDot,
            { backgroundColor: active ? theme.onAccent : dot },
          ]}
        />
      )}
      {check === true && (
        <Check
          color={active ? theme.onAccent : theme.textDim}
          size={13}
          strokeWidth={2.5}
        />
      )}
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

function StatCell({
  icon,
  value,
  label,
  theme,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  theme: ThemePalette;
}) {
  return (
    <View style={styles.statCell}>
      {icon}
      <Text style={[styles.statValue, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.textFaint }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Circular progress ring with a monochrome metallic gradient stroke. */
function ProgressRing({ done, planned }: { done: number; planned: number }) {
  const theme = useTheme();
  const size = 96;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = planned > 0 ? done / planned : 0;
  const pct = planned > 0 ? Math.round(frac * 100) : 0;

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(frac, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [frac, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - progress.value),
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="todayRingGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={theme.text} />
            <Stop offset="1" stopColor={theme.textDim} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(128, 128, 128, 0.22)"
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#todayRingGrad)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          animatedProps={animatedProps}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringPct}>{pct}%</Text>
        <Text style={styles.ringFrac}>
          {done}/{planned}
        </Text>
      </View>
    </View>
  );
}

/** Next-up card with backdrop image (dark gradient fallback) + dark overlay. */
function NextUpCard({
  task,
  theme,
  clockFormat,
  onStartTimer,
  onMarkDone,
}: {
  task: TaskInstance | null;
  theme: ThemePalette;
  clockFormat: '12h' | '24h';
  onStartTimer: () => void;
  onMarkDone: () => void;
}) {
  const backdrop = useMemo(() => nextupSource(), []);
  const prio = (task?.priority ?? 'medium') as Priority;

  return (
    <View style={[styles.nextCard, { borderColor: theme.border }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#171310' }]} />
      {backdrop != null && (
        <Image source={backdrop} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.62)' }]} />

      {task == null ? (
        <View style={styles.nextEmpty}>
          <Text style={styles.nextEmptyTitle}>All clear</Text>
          <Text style={styles.nextEmptySub}>
            No pending tasks. Rest is part of the discipline too.
          </Text>
        </View>
      ) : (
        <View style={styles.nextContent}>
          <View style={styles.nextBadge}>
            <Text style={[styles.nextBadgeText, { color: theme.text }]}>NEXT UP</Text>
          </View>
          <Text style={styles.nextTitle} numberOfLines={2}>
            {task.title}
          </Text>
          <Text style={styles.nextSub} numberOfLines={1}>
            Start a focused session. You&apos;ve got this.
          </Text>
          <View style={styles.nextChips}>
            <View style={styles.nextChip}>
              <Clock color="#FFFFFF" size={13} strokeWidth={2.2} />
              <Text style={styles.nextChipText}>
                {task.alarmTime
                  ? formatTimeDisplay(task.alarmTime, clockFormat)
                  : `${task.durationMin} min`}
              </Text>
            </View>
            <View style={styles.nextChip}>
              <BarChart3 color="#FFFFFF" size={13} strokeWidth={2.2} />
              <Text style={styles.nextChipText}>
                {prio.charAt(0).toUpperCase() + prio.slice(1)}
              </Text>
            </View>
          </View>
          <View style={styles.nextActions}>
            <PressableScale
              onPress={onStartTimer}
              hitSlop={HIT_SLOP}
              style={{ flex: 1 }}
              innerStyle={styles.nextPrimaryBtn}
              accessibilityRole="button"
              accessibilityLabel="Start timer"
            >
              <MetalFill kind="light" borderRadius={radius.md} />
              <Play color="#14100C" size={16} strokeWidth={2.5} fill="#14100C" />
              <Text style={styles.nextPrimaryText}>Start Timer</Text>
            </PressableScale>
            <PressableScale
              onPress={onMarkDone}
              hitSlop={HIT_SLOP}
              style={{ flex: 1 }}
              innerStyle={styles.nextGhostBtn}
              accessibilityRole="button"
              accessibilityLabel="Mark done"
            >
              <Check color="#FFFFFF" size={16} strokeWidth={2.5} />
              <Text style={styles.nextGhostText}>Mark Done</Text>
            </PressableScale>
          </View>
        </View>
      )}

    </View>
  );
}

interface DailyRewardStripProps {
  theme: ThemePalette;
  /** Claimed flags parallel to the reward-day ladder. */
  claimed: boolean[];
  /** Index of the day currently claimable. */
  claimableIndex: number;
  /** Whether the current day can actually be claimed (goal met, not yet claimed). */
  claimable: boolean;
  onClaim: () => void;
}

/**
 * Daily reward card, wired to the rewards engine.
 * Left column: trophy icon + title + subtitle; right: chest artwork.
 * Below: Day 1→7 connected track — tap the glowing current node to claim.
 */
function DailyRewardStrip({
  theme,
  claimed,
  claimableIndex,
  claimable,
  onClaim,
}: DailyRewardStripProps) {
  const chest = rewardChestSource();
  const days = claimed.map((_, i) => i + 1);
  return (
    <View
      style={[
        styles.rewardCard,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.rewardHeader}>
        <View style={styles.rewardLeft}>
          <View style={[styles.rewardIconBox, { backgroundColor: theme.accentDim }]}>
            <Trophy color={theme.accent} size={24} strokeWidth={2.2} />
          </View>
          <Text style={[styles.rewardTitle, { color: theme.text }]}>
            Daily Reward
          </Text>
          <Text style={[styles.small, { color: theme.textDim }]} numberOfLines={3}>
            Complete today&apos;s tasks to claim your reward!
          </Text>
        </View>
        {chest !== null && (
          <Image
            source={chest}
            style={styles.rewardChest}
            resizeMode="contain"
            accessibilityLabel="Reward chest"
          />
        )}
      </View>
      <View style={styles.rewardTrack}>
        {days.map((d, i) => {
          const isClaimed = claimed[i] === true;
          const isCurrent = i === claimableIndex && !isClaimed && claimable;
          return (
            <View key={d} style={styles.rewardStep}>
              {i < days.length - 1 && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.rewardConnector,
                    {
                      backgroundColor: isClaimed ? theme.accent : theme.border,
                    },
                  ]}
                />
              )}
              <RewardDayNode
                theme={theme}
                claimed={isClaimed}
                current={isCurrent}
                label={`Day ${d}`}
                onClaim={isCurrent ? onClaim : undefined}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RewardDayNode({
  theme,
  claimed,
  current,
  label,
  onClaim,
}: {
  theme: ThemePalette;
  claimed: boolean;
  current: boolean;
  label: string;
  onClaim?: () => void;
}) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (current) {
      pulse.value = withRepeat(withTiming(1.14, { duration: 850 }), -1, true);
    } else {
      pulse.value = withTiming(1, { duration: 150 });
    }
  }, [current, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const inner = (
    <Animated.View
      style={[
        styles.rewardNode,
        {
          backgroundColor: claimed
            ? theme.accent
            : current
              ? theme.accentDim
              : theme.surface,
          borderColor: claimed || current ? theme.accent : theme.border,
          borderWidth: claimed || current ? 2 : 1.5,
        },
        current && {
          shadowColor: theme.accent,
          shadowOpacity: 0.55,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        },
        pulseStyle,
      ]}
    >
      {claimed ? (
        <Check color={theme.onAccent} size={19} strokeWidth={2.6} />
      ) : (
        <Trophy
          color={current ? theme.accent : theme.textFaint}
          size={18}
          strokeWidth={2.2}
        />
      )}
    </Animated.View>
  );

  return (
    <View style={styles.rewardNodeWrap}>
      {onClaim ? (
        <PressableScale
          onPress={onClaim}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`Claim daily reward, ${label}`}
        >
          {inner}
        </PressableScale>
      ) : (
        inner
      )}
      <Text
        style={[
          styles.rewardDayLabel,
          { color: claimed || current ? theme.text : theme.textFaint },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/** Task row: monochrome left accent, checkbox, meta row, play + overflow menu. */
function TodayTaskRow({
  item,
  theme,
  clockFormat,
  overdue,
  onToggle,
  onPlay,
  onMenu,
}: {
  item: TaskInstance;
  theme: ThemePalette;
  clockFormat: '12h' | '24h';
  overdue: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onMenu: () => void;
}) {
  const done = item.status === 'done';
  const prio = (item.priority ?? 'medium') as Priority;

  return (
    <View
      style={[
        styles.taskCard,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderLeftColor: theme.accent,
        },
      ]}
    >
      <View style={styles.taskRow}>
        <Pressable
          onPress={onToggle}
          onLongPress={onMenu}
          delayLongPress={400}
          style={styles.taskCheck}
          hitSlop={HIT_SLOP}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={item.title}
        >
          <View
            style={[
              styles.checkCircle,
              {
                borderColor: done ? theme.accent : theme.borderStrong,
                backgroundColor: done ? theme.accent : 'transparent',
              },
            ]}
          >
            {done && <Check color={theme.onAccent} size={14} strokeWidth={3} />}
          </View>
        </Pressable>

        <Pressable
          onPress={onToggle}
          onLongPress={onMenu}
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
            <View
              style={[styles.prioDot, { backgroundColor: priorityDotColor(prio, theme) }]}
            />
            <Text style={[styles.taskMetaText, { color: theme.textDim }]}>
              {priorityLabel(prio)}
            </Text>
            {overdue && !done && (
              <View style={[styles.lateBadge, { backgroundColor: theme.accent }]}>
                <Text style={[styles.lateBadgeText, { color: theme.onAccent }]}>LATE</Text>
              </View>
            )}
          </View>
        </Pressable>

        <PressableScale
          onPress={onPlay}
          hitSlop={HIT_SLOP}
          innerStyle={styles.playBtn}
          accessibilityRole="button"
          accessibilityLabel="Start timer"
        >
          <Play color={theme.accent} size={17} strokeWidth={2.4} />
        </PressableScale>
        <PressableScale
          onPress={onMenu}
          hitSlop={HIT_SLOP}
          innerStyle={styles.menuBtn}
          accessibilityRole="button"
          accessibilityLabel="Task options"
        >
          <MoreVertical color={theme.textDim} size={18} strokeWidth={2.2} />
        </PressableScale>
      </View>
    </View>
  );
}

/* ---------------------------------- styles ---------------------------------- */

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: space(2),
    paddingTop: space(1.5),
    gap: space(2),
  },
  sectionCaption: { ...type.caption },
  small: { ...type.small },

  /* 1 — Hero */
  hero: {
    height: 212,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  heroImg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: undefined,
    height: undefined,
  },
  heroTop: {
    flexDirection: 'row',
    paddingHorizontal: space(2),
    paddingTop: space(1.75),
  },
  heroDateCol: {
    alignItems: 'flex-end',
    gap: 3,
  },
  heroDate: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 1.2,
    color: 'rgba(255, 255, 255, 0.92)',
  },
  heroDayPct: {
    ...type.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  heroBottom: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: space(2),
    paddingBottom: space(2),
    gap: 1,
  },
  heroGreeting: {
    ...type.body,
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.72)',
  },
  heroName: {
    ...type.h1,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  heroQuote: {
    ...type.small,
    fontSize: 13,
    fontStyle: 'italic',
    color: 'rgba(255, 255, 255, 0.62)',
    marginTop: 3,
  },

  /* 2 — Week strip */
  weekRow: {
    flexDirection: 'row',
    gap: 2,
  },
  dayCellWrap: { flex: 1 },
  dayCell: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space(1),
    borderRadius: radius.md,
    gap: 1,
  },
  dayDow: {
    ...type.caption,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  dayNum: {
    ...type.mono,
    fontSize: 17,
    fontWeight: '700',
  },
  dayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 3,
  },

  /* 3 — Progress card */
  progressCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
    ...{
      elevation: 4,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
  },
  progressTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
  ringCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPct: {
    ...type.mono,
    fontSize: 19,
    lineHeight: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  ringFrac: {
    ...type.mono,
    fontSize: 10,
    lineHeight: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  progressText: {
    flex: 1,
    gap: 5,
  },
  progressHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(1),
  },
  statsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingLeft: space(1.5),
    paddingRight: space(1),
    paddingVertical: 7,
  },
  statsPillText: {
    ...type.caption,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  progressHeading: {
    ...type.h2,
    fontSize: 21,
    lineHeight: 26,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    marginTop: space(2),
    paddingTop: space(1.75),
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    ...type.mono,
    fontSize: 17,
    fontWeight: '700',
  },
  statLabel: {
    ...type.caption,
    fontSize: 9,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },

  /* 4 — Next Up card */
  nextCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    minHeight: 208,
  },
  nextEmpty: {
    padding: space(2.5),
    paddingRight: space(5),
    gap: 6,
    justifyContent: 'center',
    minHeight: 208,
  },
  nextEmptyTitle: {
    ...type.h2,
    fontSize: 19,
    color: '#FFFFFF',
  },
  nextEmptySub: {
    ...type.small,
    color: 'rgba(255, 255, 255, 0.62)',
  },
  nextContent: {
    padding: space(2),
    paddingRight: space(4.5),
    gap: space(1.25),
  },
  nextBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.45)',
    borderRadius: radius.pill,
    paddingHorizontal: space(1.5),
    paddingVertical: 5,
  },
  nextBadgeText: {
    ...type.caption,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  nextTitle: {
    ...type.h2,
    fontSize: 21,
    lineHeight: 27,
    color: '#FFFFFF',
  },
  nextSub: {
    ...type.small,
    color: 'rgba(255, 255, 255, 0.66)',
  },
  nextChips: {
    flexDirection: 'row',
    gap: space(1),
  },
  nextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.13)',
    borderRadius: radius.pill,
    paddingHorizontal: space(1.5),
    paddingVertical: 7,
  },
  nextChipText: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 0.4,
    color: '#FFFFFF',
  },
  nextActions: {
    flexDirection: 'row',
    gap: space(1.25),
    marginTop: space(0.5),
  },
  nextPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    borderRadius: radius.md,
    minHeight: TAP,
    overflow: 'hidden',
  },
  nextPrimaryText: {
    ...type.label,
    fontSize: 14,
    color: '#14100C',
  },
  nextGhostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: radius.md,
    minHeight: TAP,
  },
  nextGhostText: {
    ...type.label,
    fontSize: 14,
    color: '#FFFFFF',
  },
  /* 5 — Daily Reward card */
  rewardCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(2),
    gap: space(1.75),
  },
  rewardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
  },
  rewardLeft: {
    flex: 1,
    gap: space(1),
  },
  rewardIconBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardChest: {
    width: 92,
    height: 72,
  },
  rewardTitle: {
    ...type.bodyStrong,
    fontSize: 16,
  },
  rewardTrack: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: space(0.5),
  },
  rewardStep: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  rewardConnector: {
    position: 'absolute',
    top: 21,
    left: '50%',
    width: '50%',
    height: 2,
    borderRadius: 1,
  },
  rewardNodeWrap: {
    alignItems: 'center',
    gap: 5,
  },
  rewardNode: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardDayLabel: {
    ...type.caption,
    fontSize: 9,
    letterSpacing: 0.4,
  },

  /* 6 — Quick-add */

  /* 7 — Schedule header */
  tasksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space(0.5),
  },
  sectionTitle: {
    ...type.h2,
    fontSize: 19,
  },
  viewToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 2,
    gap: 2,
  },
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

  /* 8 — Filter chips */
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(1),
    paddingVertical: 2,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space(1.75),
    minHeight: 38,
  },
  filterDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  filterChipText: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 0.5,
  },

  /* 9 — Task rows */
  taskList: {
    gap: space(1.5),
  },
  taskCard: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space(1.25),
    paddingLeft: space(0.75),
    paddingRight: space(1),
    gap: space(0.5),
  },
  taskCheck: {
    width: TAP,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
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
  prioDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
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
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Timeline */
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
});
