import { Fragment, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Polyline,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import {
  Award,
  CalendarDays,
  ChartColumn,
  Clock,
  Flame,
  Medal,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react-native';
import { useDb } from '../../db/useDb';
import { logEvent } from '../../db/log';
import { getMeta, setMeta } from '../../db/repos/meta';
import { useUiStore } from '../../state/ui';
import { categoryColor, dark, light, radius, space, type, type ThemePalette } from '../../theme/tokens';
import { AddTaskSheet } from '../../components/AddTaskSheet';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Card } from '../../components/Card';
import { MetallicText } from '../../components/MetallicText';
import { FAB_CLEARANCE } from '../../components/Fab';
import {
  categoryMeta,
  categoryMinutes,
  completedTimestamps,
  instancesInRange,
  sessionsInRange,
  skillMinutes,
  skillNames,
  categoryName,
} from '../../stats/queries';
import { addDays, localDateString } from '../../db/time';
import type { TaskInstance } from '../../db/types';
import { haptics } from '../../haptics';

const MILESTONES = [7, 30, 100];

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    .toUpperCase();
}

interface DayRituals {
  rituals: number;
  done: number;
  failed: number;
}

interface DayRate {
  date: string;
  dow: string;
  dayNum: string;
  rate: number;
  done: number;
  total: number;
  isToday: boolean;
}

interface StatsData {
  currentStreak: number;
  longestStreak: number;
  rate7: number;
  rate30: number;
  rate7Label: string;
  rate30Label: string;
  onTimeRate: number | null;
  ritualAdherence: number | null;
  focusMin: number;
  daily: DayRate[];
  rangeLabel: string;
  categories: { id: string; name: string; color: string; minutes: number }[];
  skills: { id: string; name: string; minutes: number }[];
  weeks: { label: string; rate: number }[];
  hours: number[];
  bestHour: number | null;
  lastReview: WeeklyReviewData | null;
  milestoneBanner: number | null;
  hasAnyActivity: boolean;
}

interface WeeklyReviewData {
  weekStart: string;
  weekEnd: string;
  completionRate: number;
  done: number;
  total: number;
  topCategory: string | null;
  topSkill: string | null;
  mostSkippedTitle: string | null;
}

function buildRitualMap(instances: TaskInstance[]): Map<string, DayRituals> {
  const m = new Map<string, DayRituals>();
  for (const inst of instances) {
    if (!inst.isRitual) continue;
    const cur = m.get(inst.date) ?? { rituals: 0, done: 0, failed: 0 };
    cur.rituals += 1;
    if (inst.status === 'done') cur.done += 1;
    else cur.failed += 1;
    m.set(inst.date, cur);
  }
  return m;
}

function isStreakDay(d: DayRituals | undefined): boolean {
  return Boolean(d && d.rituals > 0 && d.failed === 0 && d.done === d.rituals);
}

function computeStreaks(
  byDay: Map<string, DayRituals>,
  today: string,
  lookbackDays: number
): { current: number; longest: number } {
  const todayRec = byDay.get(today);
  const startOffset = isStreakDay(todayRec) ? 0 : -1;
  let current = 0;
  for (let i = startOffset; i >= -lookbackDays; i--) {
    const dayStr = addDays(today, i);
    if (isStreakDay(byDay.get(dayStr))) current += 1;
    else break;
  }

  let longest = 0;
  let run = 0;
  for (let i = -lookbackDays; i <= 0; i++) {
    const dayStr = addDays(today, i);
    if (isStreakDay(byDay.get(dayStr))) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return { current, longest };
}

function parseHhMmToMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function utcIsoToLocalMinOfDay(isoUtc: string, offsetMin: number): number | null {
  const ms = new Date(isoUtc).getTime();
  if (!Number.isFinite(ms)) return null;
  const localMs = ms + offsetMin * 60000;
  const d = new Date(localMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function utcIsoToLocalHour(isoUtc: string, offsetMin: number): number | null {
  const min = utcIsoToLocalMinOfDay(isoUtc, offsetMin);
  return min == null ? null : Math.floor(min / 60);
}

function startOfWeek(dateStr: string, weekStart: 'mon' | 'sun'): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const offset = weekStart === 'mon' ? (dow === 0 ? -6 : 1 - dow) : -dow;
  return addDays(dateStr, offset);
}

function fmtHourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

export default function StatsScreen() {
  const db = useDb();
  const theme = useUiStore((s) => s.theme);
  const graceMin = useUiStore((s) => s.graceMin);
  const weekStart = useUiStore((s) => s.weekStart);
  const palette = theme === 'light' ? light : dark;
  const { width } = useWindowDimensions();

  const [data, setData] = useState<StatsData | null>(null);
  const [addSheetVisible, setAddSheetVisible] = useState(false);

  const load = useCallback(async () => {
    const today = localDateString();
    const lookback = 365;
    const fromAll = addDays(today, -lookback);
    const from30 = addDays(today, -29);
    const from7 = addDays(today, -6);

    const [
      allInstances,
      completions30,
      catMeta,
      catMin30,
      sNames,
      cNames,
      sMin30,
    ] = await Promise.all([
      instancesInRange(db, fromAll, today),
      completedTimestamps(db, from30, today),
      categoryMeta(db),
      categoryMinutes(db, from30, today),
      skillNames(db),
      categoryName(db),
      skillMinutes(
        db,
        new Date(Date.now() - 30 * 86400000).toISOString(),
        new Date().toISOString()
      ),
    ]);

    const ritualMap = buildRitualMap(allInstances);
    const { current: currentStreak, longest: longestStreak } = computeStreaks(
      ritualMap,
      today,
      lookback
    );

    let milestoneBanner: number | null = null;
    for (const ms of MILESTONES) {
      if (currentStreak >= ms) {
        const key = `streak_milestone_${ms}`;
        const seen = await getMeta(db, key);
        if (!seen) {
          await setMeta(db, key, new Date().toISOString());
          await logEvent(db, {
            eventType: 'streak_milestone',
            payload: { milestone: ms, streak: currentStreak },
          });
          milestoneBanner = ms;
        }
      }
    }
    if (milestoneBanner !== null) {
      haptics.success();
    }

    const inst7 = allInstances.filter((i) => i.date >= from7 && i.date <= today);
    const inst30 = allInstances.filter((i) => i.date >= from30 && i.date <= today);
    const done7 = inst7.filter((i) => i.status === 'done').length;
    const done30 = inst30.filter((i) => i.status === 'done').length;
    const rate7 = pct(done7, inst7.length);
    const rate30 = pct(done30, inst30.length);

    const earliestByInstance = new Map<string, { tsUtc: string; offsetMin: number }>();
    for (const c of completions30) {
      if (!earliestByInstance.has(c.instanceId)) {
        earliestByInstance.set(c.instanceId, {
          tsUtc: c.tsUtc,
          offsetMin: c.tsOffsetMin,
        });
      }
    }
    const alarmedDone = inst30.filter((i) => i.status === 'done' && i.alarmTime);
    let onTimeHits = 0;
    let onTimeDenom = 0;
    for (const inst of alarmedDone) {
      const targetMin = parseHhMmToMin(inst.alarmTime!);
      const comp = earliestByInstance.get(inst.id);
      if (targetMin == null || !comp) continue;
      const actualMin = utcIsoToLocalMinOfDay(comp.tsUtc, comp.offsetMin);
      if (actualMin == null) continue;
      onTimeDenom += 1;
      if (Math.abs(actualMin - targetMin) <= graceMin) onTimeHits += 1;
    }
    const onTimeRate = onTimeDenom > 0 ? pct(onTimeHits, onTimeDenom) : null;

    const rituals30 = inst30.filter((i) => i.isRitual);
    const ritualsDone30 = rituals30.filter((i) => i.status === 'done').length;
    const ritualAdherence =
      rituals30.length > 0 ? pct(ritualsDone30, rituals30.length) : null;

    // Total focus minutes over the last 30 days from timer sessions.
    const [fy, fm, fd] = from30.split('-').map(Number);
    const sessions30 = await sessionsInRange(
      db,
      new Date(fy, fm - 1, fd, 0, 0, 0).toISOString(),
      new Date().toISOString()
    );
    let focusMin = 0;
    for (const s of sessions30) {
      if (!s.endedAtUtc) continue;
      const ms =
        new Date(s.endedAtUtc).getTime() - new Date(s.startedAtUtc).getTime();
      if (ms > 0) focusMin += ms / 60000;
    }

    // Per-day completion rates for the last 7 days (drives the bar chart).
    const daily: DayRate[] = [];
    for (let i = 6; i >= 0; i--) {
      const ds = addDays(today, -i);
      const slice = allInstances.filter((x) => x.date === ds);
      const d = slice.filter((x) => x.status === 'done').length;
      const [yy, mm, dd] = ds.split('-').map(Number);
      const dt = new Date(yy, mm - 1, dd);
      daily.push({
        date: ds,
        dow: dt.toLocaleDateString('en-GB', { weekday: 'narrow' }).toUpperCase(),
        dayNum: String(dd),
        rate: pct(d, slice.length),
        done: d,
        total: slice.length,
        isToday: ds === today,
      });
    }

    const categories = Object.entries(catMin30)
      .map(([id, minutes]) => {
        const meta = catMeta[id];
        return {
          id,
          name: meta?.name ?? cNames[id] ?? id,
          color: categoryColor(meta?.colorToken ?? 'catCustom', theme),
          minutes,
        };
      })
      .filter((c) => c.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);

    const skills = Object.entries(sMin30)
      .map(([id, minutes]) => ({
        id,
        name: sNames[id] ?? id,
        minutes,
      }))
      .filter((s) => s.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);

    const curWeekStart = startOfWeek(today, weekStart);
    const weeks: { label: string; rate: number }[] = [];
    for (let w = 7; w >= 0; w--) {
      const ws = addDays(curWeekStart, -w * 7);
      const we = addDays(ws, 6);
      const slice = allInstances.filter((i) => i.date >= ws && i.date <= we);
      const d = slice.filter((i) => i.status === 'done').length;
      const [, mth, day] = ws.split('-');
      weeks.push({ label: `${mth}/${day}`, rate: pct(d, slice.length) });
    }

    const hours = new Array<number>(24).fill(0);
    for (const c of completions30) {
      const h = utcIsoToLocalHour(c.tsUtc, c.tsOffsetMin);
      if (h != null && h >= 0 && h < 24) hours[h] += 1;
    }
    const maxHourCount = Math.max(...hours);
    const bestHour = maxHourCount > 0 ? hours.indexOf(maxHourCount) : null;

    const lastWeekStart = addDays(curWeekStart, -7);
    const lastWeekEnd = addDays(curWeekStart, -1);
    const lwInstances = allInstances.filter(
      (i) => i.date >= lastWeekStart && i.date <= lastWeekEnd
    );
    let lastReview: WeeklyReviewData | null = null;
    if (lwInstances.length > 0) {
      const lwDone = lwInstances.filter((i) => i.status === 'done').length;
      const lwRate = pct(lwDone, lwInstances.length);
      const lwCatMin = await categoryMinutes(db, lastWeekStart, lastWeekEnd);
      const topCatEntry = Object.entries(lwCatMin).sort((a, b) => b[1] - a[1])[0];
      const topCategory = topCatEntry
        ? (catMeta[topCatEntry[0]]?.name ?? cNames[topCatEntry[0]] ?? topCatEntry[0])
        : null;
      const lwSkillMin = await skillMinutes(
        db,
        new Date(`${lastWeekStart}T00:00:00`).toISOString(),
        new Date(`${lastWeekEnd}T23:59:59`).toISOString()
      );
      const topSkillEntry = Object.entries(lwSkillMin).sort((a, b) => b[1] - a[1])[0];
      const topSkill = topSkillEntry
        ? (sNames[topSkillEntry[0]] ?? topSkillEntry[0])
        : null;

      const skipCounts = new Map<string, number>();
      for (const i of lwInstances) {
        if (i.status === 'skipped' || i.status === 'missed') {
          skipCounts.set(i.title, (skipCounts.get(i.title) ?? 0) + 1);
        }
      }
      const topSkip = [...skipCounts.entries()].sort((a, b) => b[1] - a[1])[0];

      lastReview = {
        weekStart: lastWeekStart,
        weekEnd: lastWeekEnd,
        completionRate: lwRate,
        done: lwDone,
        total: lwInstances.length,
        topCategory,
        topSkill,
        mostSkippedTitle: topSkip ? topSkip[0] : null,
      };

      const reviewKey = `weekly_review_${lastWeekStart}`;
      const alreadyLogged = await getMeta(db, reviewKey);
      if (!alreadyLogged) {
        await setMeta(db, reviewKey, new Date().toISOString());
        await logEvent(db, {
          eventType: 'weekly_review_generated',
          payload: { ...lastReview },
        });
      }
    }

    const hasAnyActivity =
      allInstances.length > 0 ||
      completions30.length > 0 ||
      categories.length > 0 ||
      skills.length > 0;

    setData({
      currentStreak,
      longestStreak,
      rate7,
      rate30,
      rate7Label: `${done7}/${inst7.length}`,
      rate30Label: `${done30}/${inst30.length}`,
      onTimeRate,
      ritualAdherence,
      focusMin: Math.round(focusMin),
      daily,
      rangeLabel: `${fmtShort(from30)} – ${fmtShort(today)}`,
      categories,
      skills,
      weeks,
      hours,
      bestHour,
      lastReview,
      milestoneBanner,
      hasAnyActivity,
    });
  }, [db, graceMin, theme, weekStart]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Chart widths scale off the real window width: content padding (space(2)
  // each side) + Card padding (space.md each side). No fixed pixel widths.
  const chartW = Math.max(280, width - space(2) * 2 - space.md * 2);

  if (!data) {
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.safe, { backgroundColor: palette.bg }]}
      >
        <View style={styles.content}>
          <Text
            style={[styles.eyebrow, { color: palette.textMuted }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            PERFORMANCE TELEMETRY
          </Text>
          <MetallicText variant="h1" palette={palette}>
            Your Progress
          </MetallicText>
          <View style={styles.grid}>
            <Skeleton height={148} borderRadius={radius.lg} style={{ flex: 1, minWidth: 152 }} />
            <Skeleton height={148} borderRadius={radius.lg} style={{ flex: 1, minWidth: 152 }} />
          </View>
          <Skeleton height={220} borderRadius={radius.lg} />
          <Skeleton height={180} borderRadius={radius.lg} />
        </View>
      </SafeAreaView>
    );
  }

  if (!data.hasAnyActivity) {
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.safe, { backgroundColor: palette.bg }]}
      >
        <View style={styles.emptyWrap}>
          <View style={styles.emptyHeader}>
            <Text
              style={[styles.eyebrow, { color: palette.textMuted }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              PERFORMANCE TELEMETRY
            </Text>
            <MetallicText variant="h1" palette={palette}>
              Your Progress
            </MetallicText>
          </View>
          <EmptyState
            icon={ChartColumn}
            title="No telemetry yet"
            subtitle="Complete rituals and tasks to unlock completion curves, streak records, and peak-hour histograms."
            actionLabel="+ Create First Task"
            onAction={() => setAddSheetVisible(true)}
          />
        </View>
        <AddTaskSheet
          visible={addSheetVisible}
          onClose={() => {
            setAddSheetVisible(false);
            void load();
          }}
        />
      </SafeAreaView>
    );
  }

  const maxCatMin = Math.max(1, ...data.categories.map((c) => c.minutes));
  const maxSkillMin = Math.max(1, ...data.skills.map((s) => s.minutes));
  const maxHour = Math.max(1, ...data.hours);
  const activeDays = data.daily.filter((d) => d.total > 0).length;

  // Weekly bar chart geometry (last 7 days, monochrome gradient bars).
  const barChartH = 148;
  const barTopPad = 22;
  const barBottomPad = 24;
  const maxBarH = barChartH - barTopPad - barBottomPad;
  const slot = (chartW - 16) / 7;
  const barW = Math.min(30, slot * 0.58);

  // 8-week trend line geometry.
  const trendH = 132;
  const trendPts = data.weeks
    .map((w, idx) => {
      const x = 16 + (idx / Math.max(1, data.weeks.length - 1)) * (chartW - 32);
      const y = trendH - 24 - (w.rate / 100) * (trendH - 44);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const enter = (idx: number) =>
    FadeInDown.delay(idx * 35)
      .duration(180)
      .easing(Easing.out(Easing.cubic));

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: palette.bg }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: FAB_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* 1 — Hero header */}
        <View>
          <Text
            style={[styles.eyebrow, { color: palette.textMuted }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            PERFORMANCE TELEMETRY
          </Text>
          <MetallicText variant="h1" palette={palette}>
            Your Progress
          </MetallicText>
          <Text
            style={[styles.rangeLine, { color: palette.textSecondary }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {data.rangeLabel} · LAST 30 DAYS
          </Text>
        </View>

        {/* Streak hero — monochrome gradient, flame highlight */}
        <Animated.View entering={enter(0)}>
          <View style={[styles.hero, { borderColor: palette.border }]}>
            <Svg style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="statsHeroGrad" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={palette.text} stopOpacity={0.32} />
                  <Stop offset="1" stopColor={palette.text} stopOpacity={0.06} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#statsHeroGrad)" />
            </Svg>
            <View style={styles.heroInner}>
              <View style={styles.heroFlameBox}>
                <Flame size={28} color={palette.text} fill={palette.text} strokeWidth={2} />
              </View>
              <View style={styles.heroText}>
                <Text
                  style={styles.heroEyebrow}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  CURRENT STREAK
                </Text>
                <Text
                  style={styles.heroValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                >
                  {data.currentStreak}
                </Text>
                <Text
                  style={styles.heroSub}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {data.currentStreak === 1 ? 'day' : 'days'} burning · best{' '}
                  {data.longestStreak}d
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Milestone banner (only when a new milestone is unlocked this load) */}
        {data.milestoneBanner != null ? (
          <Animated.View entering={enter(1)}>
            <Card palette={palette} variant="elevated" padding="md">
              <View style={styles.milestoneRow}>
                <View style={[styles.msIconBox, { backgroundColor: palette.accentDim }]}>
                  <Award size={20} color={palette.text} />
                </View>
                <Text
                  style={[styles.milestoneText, { color: palette.textPrimary, backgroundColor: palette.accentDim }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  Milestone unlocked: {data.milestoneBanner}-day ritual streak!
                </Text>
              </View>
            </Card>
          </Animated.View>
        ) : null}

        {/* 2 — Stat cards (wrap, 2-up on 360dp) */}
        <View style={styles.grid}>
          <StatCard
            palette={palette}
            index={2}
            icon={<Flame size={18} color={palette.text} strokeWidth={2.2} />}
            label="CURRENT STREAK"
            value={`${data.currentStreak}d`}
          />
          <StatCard
            palette={palette}
            index={3}
            icon={<Trophy size={18} color={palette.text} strokeWidth={2.2} />}
            label="BEST STREAK"
            value={`${data.longestStreak}d`}
          />
          <StatCard
            palette={palette}
            index={4}
            icon={<Target size={18} color={palette.text} strokeWidth={2.2} />}
            label="COMPLETION RATE"
            value={`${data.rate30}%`}
            sub={`${data.rate30Label} in 30d`}
          />
          <StatCard
            palette={palette}
            index={5}
            icon={<Timer size={18} color={palette.text} strokeWidth={2.2} />}
            label="FOCUS TIME"
            value={fmtMin(data.focusMin)}
            sub="last 30 days"
          />
        </View>

        {/* Milestones / badges */}
        <Animated.View entering={enter(6)}>
          <Card palette={palette} padding="md">
            <SectionHead
              palette={palette}
              icon={<Medal size={13} color={palette.text} strokeWidth={2.2} />}
              title="STREAK MILESTONES"
              right={`${MILESTONES.filter((m) => data.currentStreak >= m).length}/${MILESTONES.length} EARNED`}
            />
            <View style={styles.msRow}>
              {MILESTONES.map((ms) => {
                const achieved = data.currentStreak >= ms;
                return (
                  <View key={ms} style={styles.msBadge}>
                    <View
                      style={[
                        styles.msCircle,
                        achieved
                          ? { backgroundColor: palette.accentDim, borderColor: palette.accent }
                          : {
                              backgroundColor: 'transparent',
                              borderColor: palette.border,
                            },
                      ]}
                    >
                      <Medal
                        size={20}
                        color={achieved ? palette.text : palette.textFaint}
                        strokeWidth={2}
                      />
                    </View>
                    <Text
                      style={[
                        styles.msNum,
                        { color: achieved ? palette.textPrimary : palette.textMuted },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {ms}
                    </Text>
                    <Text
                      style={[styles.msLabel, { color: palette.textMuted }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      DAY STREAK
                    </Text>
                  </View>
                );
              })}
            </View>
          </Card>
        </Animated.View>

        {/* 3 — Weekly bar chart (last 7 days, scales to width) */}
        <Animated.View entering={enter(7)}>
          <Card palette={palette} padding="md">
            <SectionHead
              palette={palette}
              icon={<ChartColumn size={13} color={palette.text} strokeWidth={2.2} />}
              title="LAST 7 DAYS"
              right={`${activeDays}/7 ACTIVE`}
            />
            <Svg width={chartW} height={barChartH}>
              <Defs>
                <LinearGradient id="statsBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={palette.text} />
                  <Stop offset="1" stopColor={palette.textDim} />
                </LinearGradient>
              </Defs>
              {data.daily.map((d, i) => {
                const cx = 8 + i * slot + slot / 2;
                const h =
                  d.rate > 0 ? Math.max(6, (d.rate / 100) * maxBarH) : 4;
                const y = barTopPad + (maxBarH - h);
                const x = cx - barW / 2;
                return (
                  <Fragment key={d.date}>
                    {d.rate > 0 ? (
                      <Rect
                        x={x}
                        y={y}
                        width={barW}
                        height={h}
                        rx={barW / 2}
                        fill="url(#statsBarGrad)"
                        opacity={d.isToday ? 1 : 0.8}
                        stroke={d.isToday ? palette.bg : 'none'}
                        strokeWidth={1.5}
                      />
                    ) : (
                      <Rect
                        x={x}
                        y={barTopPad + maxBarH - 4}
                        width={barW}
                        height={4}
                        rx={2}
                        fill={palette.border}
                      />
                    )}
                    {d.rate > 0 ? (
                      <SvgText
                        x={cx}
                        y={y - 6}
                        fontSize={9}
                        fontWeight="700"
                        fill={d.isToday ? palette.text : palette.textMuted}
                        textAnchor="middle"
                      >
                        {`${d.rate}%`}
                      </SvgText>
                    ) : null}
                    <SvgText
                      x={cx}
                      y={barChartH - 8}
                      fontSize={10}
                      fontWeight={d.isToday ? '700' : '600'}
                      fill={d.isToday ? palette.text : palette.textMuted}
                      textAnchor="middle"
                    >
                      {d.dow}
                    </SvgText>
                    <SvgText
                      x={cx}
                      y={barChartH}
                      fontSize={8}
                      fill={palette.textFaint}
                      textAnchor="middle"
                    >
                      {d.dayNum}
                    </SvgText>
                  </Fragment>
                );
              })}
            </Svg>
          </Card>
        </Animated.View>

        {/* 4 — 8-week completion trend */}
        <Animated.View entering={enter(8)}>
          <Card palette={palette} padding="md">
            <SectionHead
              palette={palette}
              icon={<TrendingUp size={13} color={palette.text} strokeWidth={2.2} />}
              title="WEEKLY TREND · 8 WKS"
              right={`${data.weeks[data.weeks.length - 1]?.rate ?? 0}% THIS WK`}
            />
            <Svg width={chartW} height={trendH}>
              <Line
                x1={16}
                y1={trendH - 24}
                x2={chartW - 16}
                y2={trendH - 24}
                stroke={palette.border}
                strokeWidth={1}
              />
              <Line
                x1={16}
                y1={20}
                x2={chartW - 16}
                y2={20}
                stroke={palette.border}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <Polyline
                points={trendPts}
                fill="none"
                stroke={palette.text}
                strokeWidth={2.5}
              />
              {data.weeks.map((w, idx) => {
                const x =
                  16 +
                  (idx / Math.max(1, data.weeks.length - 1)) * (chartW - 32);
                const y = trendH - 24 - (w.rate / 100) * (trendH - 44);
                return (
                  <Circle
                    key={w.label}
                    cx={x}
                    cy={y}
                    r={3.5}
                    fill={palette.bg}
                    stroke={palette.text}
                    strokeWidth={2}
                  />
                );
              })}
              {data.weeks.map((w, idx) => {
                if (idx % 2 !== 0 && idx !== data.weeks.length - 1) return null;
                const x =
                  16 +
                  (idx / Math.max(1, data.weeks.length - 1)) * (chartW - 32);
                return (
                  <SvgText
                    key={`lbl-${w.label}`}
                    x={x}
                    y={trendH - 7}
                    fontSize={9}
                    fill={palette.textMuted}
                    textAnchor="middle"
                  >
                    {w.label}
                  </SvgText>
                );
              })}
            </Svg>
          </Card>
        </Animated.View>

        {/* Consistency rows — 7d rate, on-time, ritual adherence */}
        <Animated.View entering={enter(9)}>
          <Card palette={palette} padding="md">
            <SectionHead
              palette={palette}
              icon={<Zap size={13} color={palette.text} strokeWidth={2.2} />}
              title="CONSISTENCY"
            />
            <View style={styles.metricList}>
              <MetricRow
                palette={palette}
                icon={<CalendarDays size={17} color={palette.text} strokeWidth={2.2} />}
                label="7-DAY RATE"
                sub={`${data.rate7Label} tasks done`}
                value={`${data.rate7}%`}
              />
              <View style={[styles.metricDivider, { backgroundColor: palette.border }]} />
              <MetricRow
                palette={palette}
                icon={<Clock size={17} color={palette.text} strokeWidth={2.2} />}
                label={`ON-TIME (±${graceMin}M)`}
                sub="30d alarmed tasks"
                value={data.onTimeRate == null ? '—' : `${data.onTimeRate}%`}
              />
              <View style={[styles.metricDivider, { backgroundColor: palette.border }]} />
              <MetricRow
                palette={palette}
                icon={<Sparkles size={17} color={palette.text} strokeWidth={2.2} />}
                label="RITUAL ADHERENCE"
                sub="30d morning rituals"
                value={data.ritualAdherence == null ? '—' : `${data.ritualAdherence}%`}
              />
            </View>
          </Card>
        </Animated.View>

        {/* Time per Category */}
        <Animated.View entering={enter(10)}>
          <Card palette={palette} padding="md">
            <SectionHead
              palette={palette}
              title="TIME PER CATEGORY · 30 DAYS"
            />
            {data.categories.length === 0 ? (
              <Text
                style={[styles.empty, { color: palette.textMuted }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                No category time logged yet.
              </Text>
            ) : (
              <View style={styles.barList}>
                {data.categories.map((c) => {
                  const wPct = Math.max(6, Math.round((c.minutes / maxCatMin) * 100));
                  const opacity = 0.35 + 0.65 * (c.minutes / maxCatMin);
                  return (
                    <View key={c.id} style={styles.barGroup}>
                      <View style={styles.barLabelRow}>
                        <View
                          style={[styles.catDot, { backgroundColor: c.color }]}
                        />
                        <Text
                          style={[styles.barLabel, { color: palette.textPrimary }]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {c.name}
                        </Text>
                        <Text
                          style={[styles.barVal, { color: palette.textSecondary }]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {fmtMin(c.minutes)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.barTrack,
                          { backgroundColor: palette.bgElevated },
                        ]}
                      >
                        <View
                          style={[
                            styles.barFill,
                            {
                              width: `${wPct}%`,
                              backgroundColor: palette.accent,
                              opacity,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Card>
        </Animated.View>

        {/* Time per Skill */}
        <Animated.View entering={enter(11)}>
          <Card palette={palette} padding="md">
            <SectionHead
              palette={palette}
              title="TIME PER CREATIVE SKILL · 30 DAYS"
            />
            {data.skills.length === 0 ? (
              <Text
                style={[styles.empty, { color: palette.textMuted }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                No skill timer sessions logged yet.
              </Text>
            ) : (
              <View style={styles.barList}>
                {data.skills.map((s) => {
                  const wPct = Math.max(
                    6,
                    Math.round((s.minutes / maxSkillMin) * 100)
                  );
                  const opacity = 0.35 + 0.65 * (s.minutes / maxSkillMin);
                  return (
                    <View key={s.id} style={styles.barGroup}>
                      <View style={styles.barLabelRow}>
                        <Text
                          style={[styles.barLabel, { color: palette.textPrimary }]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {s.name}
                        </Text>
                        <Text
                          style={[styles.barVal, { color: palette.textSecondary }]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {fmtMin(s.minutes)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.barTrack,
                          { backgroundColor: palette.bgElevated },
                        ]}
                      >
                        <View
                          style={[
                            styles.barFill,
                            {
                              width: `${wPct}%`,
                              backgroundColor: palette.accent,
                              opacity,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Card>
        </Animated.View>

        {/* Peak hours histogram */}
        <Animated.View entering={enter(12)}>
          <Card palette={palette} padding="md">
            <SectionHead
              palette={palette}
              icon={<Zap size={13} color={palette.text} strokeWidth={2.2} />}
              title="PEAK HOURS · 30 DAYS"
              right={
                data.bestHour == null
                  ? 'NO PEAK YET'
                  : `PEAK ${fmtHourLabel(data.bestHour)}`
              }
            />
            <Svg width={chartW} height={100}>
              {data.hours.map((count, h) => {
                const slotW = (chartW - 12) / 24;
                const barW24 = Math.max(3, slotW - 3);
                const barH24 =
                  count > 0 ? Math.max(4, (count / maxHour) * 68) : 2;
                const x = 6 + h * slotW;
                const y = 78 - barH24;
                const isPeak = h === data.bestHour && count > 0;
                return (
                  <Rect
                    key={h}
                    x={x}
                    y={y}
                    width={barW24}
                    height={barH24}
                    rx={2}
                    fill={
                      isPeak
                        ? palette.accent
                        : count > 0
                          ? palette.textMuted
                          : palette.border
                    }
                  />
                );
              })}
              {[0, 6, 12, 18, 23].map((h) => {
                const slotW = (chartW - 12) / 24;
                const x = 6 + h * slotW + slotW / 2;
                return (
                  <SvgText
                    key={`h-${h}`}
                    x={x}
                    y={94}
                    fontSize={9}
                    fill={palette.textMuted}
                    textAnchor="middle"
                  >
                    {`${h}h`}
                  </SvgText>
                );
              })}
            </Svg>
          </Card>
        </Animated.View>

        {/* Weekly Review */}
        {data.lastReview ? (
          <Animated.View entering={enter(13)}>
            <Card palette={palette} variant="elevated" padding="md">
              <SectionHead
                palette={palette}
                icon={<CalendarDays size={13} color={palette.text} strokeWidth={2.2} />}
                title={`WEEKLY REVIEW · ${data.lastReview.weekStart} → ${data.lastReview.weekEnd}`}
              />
              <MetallicText variant="h2" palette={palette}>
                {`${data.lastReview.completionRate}% (${data.lastReview.done}/${data.lastReview.total})`}
              </MetallicText>
              <View style={styles.reviewList}>
                <Text
                  style={[styles.reviewLine, { color: palette.textSecondary }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  Top category: {data.lastReview.topCategory ?? '—'}
                </Text>
                <Text
                  style={[styles.reviewLine, { color: palette.textSecondary }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  Top skill: {data.lastReview.topSkill ?? '—'}
                </Text>
                <Text
                  style={[styles.reviewLine, { color: palette.textSecondary }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  Most skipped: {data.lastReview.mostSkippedTitle ?? 'None'}
                </Text>
              </View>
            </Card>
          </Animated.View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------------------------------- pieces ---------------------------------- */

/** Section eyebrow header: small-caps muted caption + optional icon + right badge. */
function SectionHead({
  palette,
  icon,
  title,
  right,
}: {
  palette: { textMuted: string; textSecondary: string };
  icon?: React.ReactNode;
  title: string;
  right?: string;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionHeadLeft}>
        {icon}
        <Text
          style={[styles.sectionTitle, { color: palette.textMuted }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
      </View>
      {right != null ? (
        <Text
          style={[styles.sectionRight, { color: palette.textSecondary }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {right}
        </Text>
      ) : null}
    </View>
  );
}

/** Wrapping stat card: icon chip, big metallic number, label, optional sub. */
function StatCard({
  palette,
  index,
  icon,
  label,
  value,
  sub,
}: {
  palette: ThemePalette;
  index: number;
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * 35)
        .duration(180)
        .easing(Easing.out(Easing.cubic))}
      style={styles.statWrap}
    >
      <Card palette={palette} variant="elevated" padding="md" style={styles.statCard}>
        <View style={styles.statIconBox}>{icon}</View>
        <Text
          style={[type.display, styles.statValue, { color: palette.text }]}
          numberOfLines={1}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={0.55}
        >
          {value}
        </Text>
        <Text
          style={[styles.statLabel, { color: palette.textMuted }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        {sub != null ? (
          <Text
            style={[styles.statSub, { color: palette.textSecondary }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {sub}
          </Text>
        ) : null}
      </Card>
    </Animated.View>
  );
}

/** Single consistency metric row: icon + label/sub + right-aligned value. */
function MetricRow({
  palette,
  icon,
  label,
  sub,
  value,
}: {
  palette: ThemePalette;
  icon: React.ReactNode;
  label: string;
  sub: string;
  value: string;
}) {
  return (
    <View style={styles.metricRow}>
      <View style={[styles.metricIconBox, { backgroundColor: palette.accentDim }]}>{icon}</View>
      <View style={styles.metricText}>
        <Text
          style={[styles.metricLabel, { color: palette.textMuted }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        <Text
          style={[styles.metricSub, { color: palette.textSecondary }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {sub}
        </Text>
      </View>
      <Text
        style={[styles.metricValue, { color: palette.textPrimary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
    </View>
  );
}

/* ---------------------------------- styles ---------------------------------- */

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: space(2),
    paddingTop: space.md,
    gap: space.md,
  },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: space(2),
    paddingTop: space.md,
  },
  emptyHeader: {
    marginBottom: space.base,
  },
  eyebrow: {
    ...type.label,
    marginBottom: 2,
  },
  rangeLine: {
    ...type.monoSm,
    marginTop: 6,
    letterSpacing: 0.8,
  },

  /* Hero — streak highlight */
  hero: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  heroInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
  },
  heroFlameBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
    flexShrink: 1,
    gap: 1,
  },
  heroEyebrow: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 1.2,
    color: 'rgba(255, 255, 255, 0.72)',
  },
  heroValue: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: '#FFFFFF',
  },
  heroSub: {
    ...type.small,
    color: 'rgba(255, 255, 255, 0.72)',
  },

  /* Milestone banner */
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  msIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneText: {
    ...type.body,
    fontWeight: '700',
    flex: 1,
    flexShrink: 1,
  },

  /* Stat grid */
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  statWrap: {
    flex: 1,
    minWidth: 152,
  },
  statCard: {
    flex: 1,
    gap: 6,
  },
  statIconBox: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    marginTop: 2,
  },
  statLabel: {
    ...type.caption,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  statSub: {
    ...type.caption,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'none',
  },

  /* Section headers */
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.sm,
  },
  sectionHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexShrink: 1,
  },
  sectionTitle: {
    ...type.caption,
    flexShrink: 1,
  },
  sectionRight: {
    ...type.monoSm,
    fontWeight: '700',
    flexShrink: 0,
  },

  /* Milestone badges */
  msRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xs,
  },
  msBadge: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  msCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msNum: {
    ...type.h2,
    fontSize: 17,
  },
  msLabel: {
    ...type.caption,
    fontSize: 8,
    letterSpacing: 0.8,
  },

  /* Consistency rows */
  metricList: {
    gap: space.sm,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  metricIconBox: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  metricText: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  metricLabel: {
    ...type.caption,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  metricSub: {
    ...type.small,
    fontSize: 12,
  },
  metricValue: {
    ...type.monoLg,
    fontSize: 17,
    minWidth: 56,
    textAlign: 'right',
    flexShrink: 0,
  },
  metricDivider: {
    height: 1,
    opacity: 0.6,
  },

  /* Category / skill bars */
  barList: {
    gap: space.md,
    marginTop: space.xs,
  },
  barGroup: {
    gap: 6,
  },
  barLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  catDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  barLabel: {
    ...type.bodySm,
    fontWeight: '600',
    flex: 1,
    flexShrink: 1,
  },
  barVal: {
    ...type.monoSm,
    flexShrink: 0,
  },
  barTrack: {
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  empty: {
    ...type.bodySm,
    paddingVertical: space.sm,
  },

  /* Weekly review */
  reviewList: {
    gap: 4,
    marginTop: space.sm,
  },
  reviewLine: {
    ...type.bodySm,
  },
});
