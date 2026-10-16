import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { Award, ChartColumn, Flame } from 'lucide-react-native';
import { useDb } from '../../db/useDb';
import { logEvent } from '../../db/log';
import { getMeta, setMeta } from '../../db/repos/meta';
import { useUiStore } from '../../state/ui';
import { categoryColor, dark, light, radius, space, type } from '../../theme/tokens';
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

interface DayRituals {
  rituals: number;
  done: number;
  failed: number;
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

    const categories = Object.entries(catMin30)
      .map(([id, minutes]) => {
        const meta = catMeta[id];
        return {
          id,
          name: meta?.name ?? cNames[id] ?? id,
          color: categoryColor(palette, meta?.colorToken ?? 'catCustom'),
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
      const [, mm, dd] = ws.split('-');
      weeks.push({ label: `${mm}/${dd}`, rate: pct(d, slice.length) });
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
      categories,
      skills,
      weeks,
      hours,
      bestHour,
      lastReview,
      milestoneBanner,
      hasAnyActivity,
    });
  }, [db, graceMin, palette, weekStart]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Responsive SVG chart widths (320dp -> 430dp+)
  const chartW = Math.max(240, width - space.base * 2 - space.md * 2 - 8);
  const chartH = 128;

  if (!data) {
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.safe, { backgroundColor: palette.bg }]}
      >
        <View style={styles.content}>
          <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
            PERFORMANCE TELEMETRY
          </Text>
          <MetallicText variant="h1" palette={palette}>
            Stats
          </MetallicText>
          <View style={styles.row}>
            <Skeleton height={116} borderRadius={radius.lg} style={{ flex: 1 }} />
            <Skeleton height={116} borderRadius={radius.lg} style={{ flex: 1 }} />
          </View>
          <Skeleton height={180} borderRadius={radius.lg} />
          <Skeleton height={160} borderRadius={radius.lg} />
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
            <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
              PERFORMANCE TELEMETRY
            </Text>
            <MetallicText variant="h1" palette={palette}>
              Stats
            </MetallicText>
          </View>
          <EmptyState
            icon={ChartColumn}
            title="No telemetry yet"
            subtitle="Complete rituals and tasks to unlock monochrome completion curves, streak records, and peak-hour histograms."
            ctaLabel="+ Create First Task"
            onPressCta={() => setAddSheetVisible(true)}
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

  const linePts = data.weeks
    .map((w, idx) => {
      const x =
        16 +
        (idx / Math.max(1, data.weeks.length - 1)) * (chartW - 32);
      const y = chartH - 22 - (w.rate / 100) * (chartH - 40);
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
        <View>
          <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
            PERFORMANCE TELEMETRY
          </Text>
          <MetallicText variant="h1" palette={palette}>
            Stats
          </MetallicText>
        </View>

        {data.milestoneBanner != null ? (
          <Animated.View entering={enter(0)}>
            <Card palette={palette} variant="elevated" padding="md">
              <View style={styles.milestoneRow}>
                <Award size={20} color={palette.textPrimary} />
                <Text style={[styles.milestoneText, { color: palette.textPrimary }]}>
                  Milestone unlocked: {data.milestoneBanner}-day ritual streak!
                </Text>
              </View>
            </Card>
          </Animated.View>
        ) : null}

        {/* Streaks */}
        <Animated.View entering={enter(1)} style={styles.row}>
          <Card palette={palette} variant="elevated" padding="md" style={styles.halfCard}>
            <View style={styles.metricTopRow}>
              <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
                CURRENT STREAK
              </Text>
              <Flame size={15} color={palette.textSecondary} />
            </View>
            <MetallicText variant="display" palette={palette}>
              {data.currentStreak}d
            </MetallicText>
            <Text style={[styles.cardSub, { color: palette.textSecondary }]}>
              All daily rituals done
            </Text>
          </Card>

          <Card palette={palette} padding="md" style={styles.halfCard}>
            <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
              LONGEST STREAK
            </Text>
            <MetallicText variant="display" palette={palette}>
              {data.longestStreak}d
            </MetallicText>
            <Text style={[styles.cardSub, { color: palette.textSecondary }]}>
              All-time record
            </Text>
          </Card>
        </Animated.View>

        {/* 7d & 30d Completion Rates */}
        <Animated.View entering={enter(2)} style={styles.row}>
          <Card palette={palette} padding="md" style={styles.halfCard}>
            <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
              7-DAY RATE
            </Text>
            <MetallicText variant="h1" palette={palette}>
              {data.rate7}%
            </MetallicText>
            <Text style={[styles.cardSub, { color: palette.textSecondary }]}>
              {data.rate7Label} tasks done
            </Text>
          </Card>

          <Card palette={palette} padding="md" style={styles.halfCard}>
            <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
              30-DAY RATE
            </Text>
            <MetallicText variant="h1" palette={palette}>
              {data.rate30}%
            </MetallicText>
            <Text style={[styles.cardSub, { color: palette.textSecondary }]}>
              {data.rate30Label} tasks done
            </Text>
          </Card>
        </Animated.View>

        {/* On-time & Ritual adherence */}
        <Animated.View entering={enter(3)} style={styles.row}>
          <Card palette={palette} padding="md" style={styles.halfCard}>
            <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
              ON-TIME (±{graceMin}M)
            </Text>
            <MetallicText variant="h1" palette={palette}>
              {data.onTimeRate == null ? '—' : `${data.onTimeRate}%`}
            </MetallicText>
            <Text style={[styles.cardSub, { color: palette.textSecondary }]}>
              30d alarmed tasks
            </Text>
          </Card>

          <Card palette={palette} padding="md" style={styles.halfCard}>
            <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
              RITUAL ADHERENCE
            </Text>
            <MetallicText variant="h1" palette={palette}>
              {data.ritualAdherence == null ? '—' : `${data.ritualAdherence}%`}
            </MetallicText>
            <Text style={[styles.cardSub, { color: palette.textSecondary }]}>
              30d morning rituals
            </Text>
          </Card>
        </Animated.View>

        {/* Weekly Trend (8 weeks monotone SVG line chart) */}
        <Animated.View entering={enter(4)}>
          <Card palette={palette} padding="md">
            <View style={styles.chartHeader}>
              <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
                WEEKLY COMPLETION TREND (8 WKS)
              </Text>
              <Text style={[styles.chartBadge, { color: palette.textSecondary }]}>
                {data.weeks[data.weeks.length - 1]?.rate ?? 0}% THIS WK
              </Text>
            </View>
            <Svg width={chartW} height={chartH}>
              <Line
                x1={16}
                y1={chartH - 22}
                x2={chartW - 16}
                y2={chartH - 22}
                stroke={palette.border}
                strokeWidth={1}
              />
              <Line
                x1={16}
                y1={18}
                x2={chartW - 16}
                y2={18}
                stroke={palette.borderSubtle}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <Polyline
                points={linePts}
                fill="none"
                stroke={palette.textPrimary}
                strokeWidth={2.25}
              />
              {data.weeks.map((w, idx) => {
                const x =
                  16 +
                  (idx / Math.max(1, data.weeks.length - 1)) * (chartW - 32);
                const y = chartH - 22 - (w.rate / 100) * (chartH - 40);
                return (
                  <Circle
                    key={w.label}
                    cx={x}
                    cy={y}
                    r={3.5}
                    fill={palette.bg}
                    stroke={palette.textPrimary}
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
                    y={chartH - 5}
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

        {/* Time per Category */}
        <Animated.View entering={enter(5)}>
          <Card palette={palette} padding="md">
            <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
              TIME PER CATEGORY · 30 DAYS
            </Text>
            {data.categories.length === 0 ? (
              <Text style={[styles.empty, { color: palette.textMuted }]}>
                No category time logged yet.
              </Text>
            ) : (
              <View style={styles.barList}>
                {data.categories.map((c) => {
                  const wPct = Math.max(6, Math.round((c.minutes / maxCatMin) * 100));
                  return (
                    <View key={c.id} style={styles.barGroup}>
                      <View style={styles.barLabelRow}>
                        <Text
                          style={[styles.barLabel, { color: palette.textPrimary }]}
                          numberOfLines={1}
                        >
                          {c.name}
                        </Text>
                        <Text
                          style={[styles.barVal, { color: palette.textSecondary }]}
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
                              backgroundColor: c.color,
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
        <Animated.View entering={enter(6)}>
          <Card palette={palette} padding="md">
            <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
              TIME PER CREATIVE SKILL · 30 DAYS
            </Text>
            {data.skills.length === 0 ? (
              <Text style={[styles.empty, { color: palette.textMuted }]}>
                No skill timer sessions logged yet.
              </Text>
            ) : (
              <View style={styles.barList}>
                {data.skills.map((s) => {
                  const wPct = Math.max(
                    6,
                    Math.round((s.minutes / maxSkillMin) * 100)
                  );
                  return (
                    <View key={s.id} style={styles.barGroup}>
                      <View style={styles.barLabelRow}>
                        <Text
                          style={[styles.barLabel, { color: palette.textPrimary }]}
                          numberOfLines={1}
                        >
                          {s.name}
                        </Text>
                        <Text
                          style={[styles.barVal, { color: palette.textSecondary }]}
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
                              backgroundColor: palette.textPrimary,
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

        {/* Best Hours Histogram */}
        <Animated.View entering={enter(7)}>
          <Card palette={palette} padding="md">
            <View style={styles.chartHeader}>
              <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
                PEAK COMPLETION HOURS · 30 DAYS
              </Text>
              <Text style={[styles.chartBadge, { color: palette.textPrimary }]}>
                {data.bestHour == null
                  ? 'NO PEAK YET'
                  : `PEAK ${fmtHourLabel(data.bestHour)}`}
              </Text>
            </View>
            <Svg width={chartW} height={100}>
              {data.hours.map((count, h) => {
                const slotW = (chartW - 12) / 24;
                const barW = Math.max(3, slotW - 3);
                const barH =
                  count > 0 ? Math.max(4, (count / maxHour) * 68) : 2;
                const x = 6 + h * slotW;
                const y = 78 - barH;
                const isPeak = h === data.bestHour && count > 0;
                return (
                  <Rect
                    key={h}
                    x={x}
                    y={y}
                    width={barW}
                    height={barH}
                    rx={2}
                    fill={
                      isPeak
                        ? palette.textPrimary
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
          <Animated.View entering={enter(8)}>
            <Card palette={palette} variant="elevated" padding="md">
              <Text style={[styles.cardLabel, { color: palette.textMuted }]}>
                WEEKLY REVIEW · {data.lastReview.weekStart} →{' '}
                {data.lastReview.weekEnd}
              </Text>
              <MetallicText variant="h2" palette={palette}>
                {data.lastReview.completionRate}% ({data.lastReview.done}/
                {data.lastReview.total})
              </MetallicText>
              <View style={styles.reviewList}>
                <Text style={[styles.reviewLine, { color: palette.textSecondary }]}>
                  Top category: {data.lastReview.topCategory ?? '—'}
                </Text>
                <Text style={[styles.reviewLine, { color: palette.textSecondary }]}>
                  Top skill: {data.lastReview.topSkill ?? '—'}
                </Text>
                <Text style={[styles.reviewLine, { color: palette.textSecondary }]}>
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

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: space.base,
    paddingTop: space.md,
    gap: space.md,
  },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: space.base,
    paddingTop: space.md,
  },
  emptyHeader: {
    marginBottom: space.base,
  },
  eyebrow: {
    ...type.label,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    gap: space.md,
  },
  halfCard: {
    flex: 1,
  },
  metricTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {
    ...type.label,
    marginBottom: 4,
  },
  cardSub: {
    ...type.caption,
    marginTop: 4,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  chartBadge: {
    ...type.monoSm,
    fontWeight: '700',
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  milestoneText: {
    ...type.body,
    fontWeight: '700',
    flex: 1,
  },
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
    justifyContent: 'space-between',
    gap: space.sm,
  },
  barLabel: {
    ...type.bodySm,
    fontWeight: '600',
    flex: 1,
  },
  barVal: {
    ...type.monoSm,
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
  reviewList: {
    gap: 4,
    marginTop: space.sm,
  },
  reviewLine: {
    ...type.bodySm,
  },
});
