import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { ChartColumn } from 'lucide-react-native';
import { useDb } from '../../db/useDb';
import { logEvent } from '../../db/log';
import { getMeta, setMeta } from '../../db/repos/meta';
import { useUiStore } from '../../state/ui';
import { categoryColor, dark, light, radius, space, type } from '../../theme/tokens';
import { AddTaskSheet } from '../../components/AddTaskSheet';
import { EmptyState } from '../../components/EmptyState';
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
  review: {
    thisWeek: number;
    lastWeek: number | null;
    held: string[];
    slipped: string[];
    missedRituals: number;
    improveLabel: string;
    improveValue: number | null;
  };
}

function localDayStartUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
}
function localDayEndUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

export default function StatsScreen() {
  const db = useDb();
  const themeName = useUiStore((s) => s.theme);
  const p = themeName === 'light' ? light : dark;
  const { width } = useWindowDimensions();

  const [data, setData] = useState<StatsData | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  const load = useCallback(async () => {
    const today = localDateString();
    const from400 = addDays(today, -399);
    const from30 = addDays(today, -29);
    const graceMin = useUiStore.getState().graceMin;

    const [instances, catMeta, sNames, catNames] = await Promise.all([
      instancesInRange(db, from400, today),
      categoryMeta(db),
      skillNames(db),
      categoryName(db),
    ]);

    // ---- Streaks ----
    // Rule (shown in UI): a day counts when it has at least one ritual
    // and every ritual is done.
    const dayMap = new Map<string, DayRituals>();
    for (const i of instances) {
      if (!i.isRitual) continue;
      const e = dayMap.get(i.date) ?? { rituals: 0, done: 0, failed: 0 };
      e.rituals += 1;
      if (i.status === 'done') e.done += 1;
      else if (i.status === 'missed' || i.status === 'skipped') e.failed += 1;
      dayMap.set(i.date, e);
    }
    const counts = (date: string): boolean => {
      const e = dayMap.get(date);
      return !!e && e.rituals > 0 && e.done === e.rituals;
    };
    let current = 0;
    const tInfo = dayMap.get(today);
    if (tInfo && tInfo.rituals > 0 && tInfo.done === tInfo.rituals) {
      let d = today;
      while (counts(d)) {
        current += 1;
        d = addDays(d, -1);
      }
    } else if (tInfo && tInfo.rituals > 0 && tInfo.failed > 0) {
      current = 0; // streak broken today
    } else {
      // Today undecided (pending) or ritual-free — evaluate from yesterday.
      let d = addDays(today, -1);
      while (counts(d)) {
        current += 1;
        d = addDays(d, -1);
      }
    }
    let longest = 0;
    let run = 0;
    let prev: string | null = null;
    for (const date of [...dayMap.keys()].sort()) {
      if (counts(date) && (prev === null || date === addDays(prev, 1))) run += 1;
      else if (counts(date)) run = 1;
      else run = 0;
      longest = Math.max(longest, run);
      prev = date;
    }

    // Milestone events — logged once per milestone, guarded by meta.
    for (const n of MILESTONES) {
      if (current === n && (await getMeta(db, `milestone_${n}`)) !== '1') {
        await logEvent(db, { eventType: 'streak_milestone', actor: 'system', payload: { days: n } });
        await setMeta(db, `milestone_${n}`, '1');
        const level = (n === 7 ? 1 : n === 30 ? 2 : 3) as 1 | 2 | 3;
        void haptics.milestone(level);
      }
    }

    // ---- Completion rates ----
    const inLast = (n: number) =>
      instances.filter((i) => i.date >= addDays(today, -(n - 1)));
    const last7 = inLast(7);
    const last30 = inLast(30);
    const doneOf = (list: TaskInstance[]) => list.filter((i) => i.status === 'done').length;
    const rate7 = pct(doneOf(last7), last7.length);
    const rate30 = pct(doneOf(last30), last30.length);

    // ---- On-time rate: completed with alarm_time, completed ≤ alarm + grace ----
    const completed = await completedTimestamps(db, from30, today);
    const firstCompleted = new Map<string, { tsUtc: string; tsOffsetMin: number }>();
    for (const c of completed) {
      if (!firstCompleted.has(c.instanceId)) {
        firstCompleted.set(c.instanceId, { tsUtc: c.tsUtc, tsOffsetMin: c.tsOffsetMin });
      }
    }
    let onTime = 0;
    let onTimeTotal = 0;
    for (const i of last30) {
      if (!i.alarmTime || i.status !== 'done') continue;
      const c = firstCompleted.get(i.id);
      if (!c) continue;
      const alarmMs = new Date(`${i.date}T${i.alarmTime}:00`).getTime();
      if (!Number.isFinite(alarmMs)) continue;
      const doneLocalMs = new Date(c.tsUtc).getTime() + c.tsOffsetMin * 60000;
      onTimeTotal += 1;
      if (doneLocalMs <= alarmMs + graceMin * 60000) onTime += 1;
    }
    const onTimeRate = onTimeTotal > 0 ? pct(onTime, onTimeTotal) : null;

    // ---- Ritual adherence (30d) ----
    const rituals30 = last30.filter((i) => i.isRitual);
    const ritualAdherence =
      rituals30.length > 0 ? pct(doneOf(rituals30), rituals30.length) : null;

    // ---- Time per category (timers + planned time) ----
    const catMin = await categoryMinutes(db, from30, today);
    const categories = Object.entries(catMin)
      .map(([id, minutes]) => ({
        id,
        name: catMeta[id]?.name ?? catNames[id] ?? 'Uncategorized',
        color: categoryColor(catMeta[id]?.colorToken ?? 'slate'),
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes);

    // ---- Time per skill (from timer_session_ended payloads) ----
    const skMin = await skillMinutes(db, localDayStartUtc(from30), localDayEndUtc(today));
    const skills = Object.entries(skMin)
      .map(([id, minutes]) => ({ id, name: sNames[id] ?? 'Unknown skill', minutes }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);

    // ---- Weekly trend: last 8 weeks completion %, Monday-start ----
    const dow = (new Date().getDay() + 6) % 7; // 0 = Monday
    const thisMonday = addDays(today, -dow);
    const weeks: { label: string; rate: number }[] = [];
    for (let w = 7; w >= 0; w--) {
      const mon = addDays(thisMonday, -7 * w);
      const sun = addDays(mon, 6);
      const wk = instances.filter((i) => i.date >= mon && i.date <= sun && i.date <= today);
      weeks.push({
        label: `${Number(mon.slice(5, 7))}/${Number(mon.slice(8, 10))}`,
        rate: pct(doneOf(wk), wk.length),
      });
    }

    // ---- Best hour: completed-event local hours ----
    const hours = new Array(24).fill(0) as number[];
    for (const c of completed) {
      const local = new Date(new Date(c.tsUtc).getTime() + c.tsOffsetMin * 60000);
      hours[local.getUTCHours()] += 1;
    }

    // ---- Weekly review ----
    const thisWeek = instances.filter((i) => i.date >= thisMonday && i.date <= today);
    const lastMon = addDays(thisMonday, -7);
    const lastSun = addDays(thisMonday, -1);
    const prevWeek = instances.filter((i) => i.date >= lastMon && i.date <= lastSun);
    const byCat = new Map<string, { done: number; total: number }>();
    let missedRituals = 0;
    for (const i of thisWeek) {
      const key = i.categoryId ?? '__none';
      const e = byCat.get(key) ?? { done: 0, total: 0 };
      e.total += 1;
      if (i.status === 'done') e.done += 1;
      byCat.set(key, e);
      if (i.isRitual && i.status === 'missed') missedRituals += 1;
    }
    const held: string[] = [];
    const slipped: string[] = [];
    for (const [key, e] of byCat) {
      const name = key === '__none' ? 'Uncategorized' : catNames[key] ?? 'Uncategorized';
      const r = e.done / e.total;
      if (r === 1) held.push(name);
      else if (r < 0.5) slipped.push(name);
    }
    const improveCandidates = (
      [
        { label: 'Completion (30d)', value: last30.length > 0 ? rate30 : null },
        { label: 'On-time', value: onTimeRate },
        { label: 'Ritual adherence', value: ritualAdherence },
      ] as { label: string; value: number | null }[]
    ).filter((c): c is { label: string; value: number } => c.value !== null);
    const worst = improveCandidates.sort((a, b) => a.value - b.value)[0];

    setData({
      currentStreak: current,
      longestStreak: longest,
      rate7,
      rate30,
      rate7Label: `${doneOf(last7)}/${last7.length}`,
      rate30Label: `${doneOf(last30)}/${last30.length}`,
      onTimeRate,
      ritualAdherence,
      categories,
      skills,
      weeks,
      hours,
      review: {
        thisWeek: pct(doneOf(thisWeek), thisWeek.length),
        lastWeek: prevWeek.length > 0 ? pct(doneOf(prevWeek), prevWeek.length) : null,
        held: held.slice(0, 3),
        slipped: slipped.slice(0, 3),
        missedRituals,
        improveLabel: worst?.label ?? 'Completion (30d)',
        improveValue: worst?.value ?? null,
      },
    });
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      setData(null);
      load();
    }, [load])
  );

  const cardW = width - space(2) * 2 - space(2) * 2; // screen padding + card padding

  const handleTaskAdded = useCallback(() => {
    setData(null);
    load();
  }, [load]);

  // No meaningful data yet: no tasks in 30d, no timed work, no streak ever.
  const isEmpty =
    data !== null &&
    data.rate30Label === '0/0' &&
    data.categories.length === 0 &&
    data.skills.length === 0 &&
    data.longestStreak === 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.pageTitle, { color: p.text }]}>Stats</Text>
        {data === null ? (
          <>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.card, styles.skeleton, { backgroundColor: p.surface }]} />
            ))}
          </>
        ) : isEmpty ? (
          <EmptyState
            icon={ChartColumn}
            title="No stats yet"
            subtitle="Complete tasks and timers and your trends will appear here."
            actionLabel="Add your first task"
            onAction={() => setAddSheetOpen(true)}
          />
        ) : (
          <>
            <Card index={0} p={p}>
              <Caption p={p}>Streak</Caption>
              <View style={styles.streakRow}>
                <View>
                  <Text style={[styles.bigNum, { color: p.text }]}>{data.currentStreak}</Text>
                  <Text style={[styles.sub, { color: p.textDim }]}>current</Text>
                </View>
                <View style={styles.streakSep} />
                <View>
                  <Text style={[styles.bigNum, { color: p.textDim }]}>{data.longestStreak}</Text>
                  <Text style={[styles.sub, { color: p.textFaint }]}>longest</Text>
                </View>
              </View>
              <Text style={[styles.rule, { color: p.textFaint }]}>
                A day counts when it has at least one ritual and every ritual is done.
              </Text>
              {data.currentStreak === 0 && data.longestStreak === 0 ? (
                <Text style={[styles.calm, { color: p.textDim }]}>
                  No rituals yet — the streak starts with one.
                </Text>
              ) : null}
              {MILESTONES.includes(data.currentStreak) && (
                <View style={[styles.milestone, { borderColor: p.accent }]}>
                  <Text style={[styles.milestoneText, { color: p.accent }]}>
                    {data.currentStreak}-day streak — rituals held.
                  </Text>
                </View>
              )}
            </Card>

            <Card index={1} p={p}>
              <Caption p={p}>Completion rate</Caption>
              <RateRow p={p} label="Last 7 days" value={data.rate7} detail={data.rate7Label} />
              <RateRow p={p} label="Last 30 days" value={data.rate30} detail={data.rate30Label} />
            </Card>

            <Card index={2} p={p}>
              <Caption p={p}>On-time rate</Caption>
              {data.onTimeRate === null ? (
                <Text style={[styles.calm, { color: p.textDim }]}>
                  No completed alarms in the last 30 days.
                </Text>
              ) : (
                <>
                  <Text style={[styles.bigNum, { color: p.text }]}>{data.onTimeRate}%</Text>
                  <Text style={[styles.sub, { color: p.textFaint }]}>
                    completed within the grace window
                  </Text>
                </>
              )}
            </Card>

            <Card index={3} p={p}>
              <Caption p={p}>Time per category — timers + planned time</Caption>
              {data.categories.length === 0 ? (
                <Text style={[styles.calm, { color: p.textDim }]}>
                  No timed work in the last 30 days.
                </Text>
              ) : (
                <>
                  <StackedBar p={p} items={data.categories.map((c) => ({ color: c.color, minutes: c.minutes }))} />
                  {data.categories.map((c) => (
                    <View key={c.id} style={styles.legendRow}>
                      <View style={[styles.dot, { backgroundColor: c.color }]} />
                      <Text style={[styles.legendName, { color: p.text }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={[styles.legendMin, { color: p.textDim }]}>{fmtMin(c.minutes)}</Text>
                    </View>
                  ))}
                </>
              )}
            </Card>

            <Card index={4} p={p}>
              <Caption p={p}>Time per skill</Caption>
              {data.skills.length === 0 ? (
                <Text style={[styles.calm, { color: p.textDim }]}>
                  No skill practice timed in the last 30 days.
                </Text>
              ) : (
                data.skills.map((s) => {
                  const max = Math.max(...data.skills.map((x) => x.minutes));
                  return (
                    <View key={s.id} style={styles.barRow}>
                      <Text style={[styles.barName, { color: p.text }]} numberOfLines={1}>
                        {s.name}
                      </Text>
                      <View style={[styles.barTrack, { backgroundColor: p.surface2 }]}>
                        <View
                          style={[
                            styles.barFill,
                            { backgroundColor: p.accent, width: `${(s.minutes / max) * 100}%` },
                          ]}
                        />
                      </View>
                      <Text style={[styles.barMin, { color: p.textDim }]}>{fmtMin(s.minutes)}</Text>
                    </View>
                  );
                })
              )}
            </Card>

            <Card index={5} p={p}>
              <Caption p={p}>Weekly trend — completion %</Caption>
              <WeekTrendChart p={p} weeks={data.weeks} width={cardW} />
            </Card>

            <Card index={6} p={p}>
              <Caption p={p}>Best hour — completions by hour</Caption>
              <HourChart p={p} hours={data.hours} width={cardW} />
            </Card>

            <Card index={7} p={p}>
              <Caption p={p}>Weekly review</Caption>
              <View style={styles.reviewRow}>
                <View>
                  <Text style={[styles.bigNum, { color: p.text }]}>{data.review.thisWeek}%</Text>
                  <Text style={[styles.sub, { color: p.textDim }]}>this week</Text>
                </View>
                <View style={styles.streakSep} />
                <View>
                  <Text style={[styles.bigNum, { color: p.textDim }]}>
                    {data.review.lastWeek === null ? '—' : `${data.review.lastWeek}%`}
                  </Text>
                  <Text style={[styles.sub, { color: p.textFaint }]}>last week</Text>
                </View>
              </View>
              <Text style={[styles.reviewLine, { color: p.textDim }]}>
                Held: {data.review.held.length > 0 ? data.review.held.join(', ') : '—'}
              </Text>
              <Text style={[styles.reviewLine, { color: p.textDim }]}>
                Slipped: {data.review.slipped.length > 0 ? data.review.slipped.join(', ') : '—'}
                {data.review.missedRituals > 0 &&
                  ` · ${data.review.missedRituals} missed ritual${data.review.missedRituals > 1 ? 's' : ''}`}
              </Text>
              <View style={[styles.improve, { borderColor: p.border }]}>
                <Text style={[styles.improveLabel, { color: p.textFaint }]}>One number to improve</Text>
                <Text style={[styles.improveValue, { color: p.text }]}>
                  {data.review.improveLabel}
                  {data.review.improveValue !== null ? ` — ${data.review.improveValue}%` : ' — no data'}
                </Text>
              </View>
            </Card>
          </>
        )}
      </ScrollView>
      <AddTaskSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onAdded={handleTaskAdded}
      />
    </SafeAreaView>
  );
}

/* ---------- local building blocks ---------- */

function Card({
  index,
  p,
  children,
}: {
  index: number;
  p: { surface: string };
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(200)
        .delay(index * 60)
        .easing(Easing.out(Easing.quad))}
      style={[styles.card, { backgroundColor: p.surface }]}
    >
      {children}
    </Animated.View>
  );
}

function Caption({ p, children }: { p: { textFaint: string }; children: React.ReactNode }) {
  return (
    <Text style={[styles.caption, { color: p.textFaint }]}>{children}</Text>
  );
}

function RateRow({
  p,
  label,
  value,
  detail,
}: {
  p: { text: string; textDim: string; textFaint: string; surface2: string; accent: string };
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <View style={styles.rateRow}>
      <Text style={[styles.rateLabel, { color: p.textDim }]}>{label}</Text>
      <View style={[styles.rateTrack, { backgroundColor: p.surface2 }]}>
        <View style={[styles.rateFill, { backgroundColor: p.accent, width: `${value}%` }]} />
      </View>
      <Text style={[styles.rateValue, { color: p.text }]}>{value}%</Text>
      <Text style={[styles.rateDetail, { color: p.textFaint }]}>{detail}</Text>
    </View>
  );
}

function StackedBar({
  p,
  items,
}: {
  p: { surface2: string };
  items: { color: string; minutes: number }[];
}) {
  const total = items.reduce((a, b) => a + b.minutes, 0);
  return (
    <View style={[styles.stacked, { backgroundColor: p.surface2 }]}>
      {items.map((it, i) => (
        <View
          key={i}
          style={{ backgroundColor: it.color, flex: it.minutes / total }}
        />
      ))}
    </View>
  );
}

function WeekTrendChart({
  p,
  weeks,
  width,
}: {
  p: { accent: string; textFaint: string; border: string; textDim: string };
  weeks: { label: string; rate: number }[];
  width: number;
}) {
  const H = 170;
  const padL = 28;
  const padR = 12;
  const padT = 22;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = H - padT - padB;
  const x = (i: number) => padL + (i / (weeks.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / 100) * innerH;
  const points = weeks.map((w, i) => `${x(i)},${y(w.rate)}`).join(' ');

  return (
    <Svg width={width} height={H}>
      {[0, 50, 100].map((g) => (
        <Line
          key={g}
          x1={padL}
          x2={width - padR}
          y1={y(g)}
          y2={y(g)}
          stroke={p.border}
          strokeWidth={1}
        />
      ))}
      {[0, 50, 100].map((g) => (
        <SvgText key={`t${g}`} x={4} y={y(g) + 4} fontSize={10} fill={p.textFaint}>
          {g}
        </SvgText>
      ))}
      <Polyline points={points} fill="none" stroke={p.accent} strokeWidth={2.5} />
      {weeks.map((w, i) => (
        <Circle key={`c${i}`} cx={x(i)} cy={y(w.rate)} r={4} fill={p.accent} />
      ))}
      {weeks.map((w, i) => (
        <SvgText
          key={`v${i}`}
          x={x(i)}
          y={y(w.rate) - 9}
          fontSize={10}
          fill={p.textDim}
          textAnchor="middle"
        >
          {w.rate}
        </SvgText>
      ))}
      {weeks.map((w, i) =>
        i % 2 === 0 ? (
          <SvgText
            key={`l${i}`}
            x={x(i)}
            y={H - 6}
            fontSize={10}
            fill={p.textFaint}
            textAnchor="middle"
          >
            {w.label}
          </SvgText>
        ) : null
      )}
    </Svg>
  );
}

function HourChart({
  p,
  hours,
  width,
}: {
  p: { accent: string; textFaint: string; surface2: string };
  hours: number[];
  width: number;
}) {
  const H = 140;
  const padB = 20;
  const max = Math.max(1, ...hours);
  const barW = width / 24;
  return (
    <Svg width={width} height={H}>
      {hours.map((c, h) => {
        const bh = (c / max) * (H - padB - 8);
        const isPeak = c === max && c > 0;
        return (
          <Rect
            key={h}
            x={barW * h + 2}
            y={H - padB - bh}
            width={Math.max(1, barW - 4)}
            height={Math.max(1, bh)}
            rx={2}
            fill={isPeak ? p.accent : p.textFaint}
            opacity={isPeak ? 1 : 0.45}
          />
        );
      })}
      {[0, 6, 12, 18, 23].map((h) => (
        <SvgText
          key={h}
          x={barW * h + barW / 2}
          y={H - 5}
          fontSize={10}
          fill={p.textFaint}
          textAnchor="middle"
        >
          {h}
        </SvgText>
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: space(2), paddingBottom: 128 },
  pageTitle: { ...type.h1, paddingVertical: space(2) },
  card: {
    borderRadius: radius.md,
    padding: space(2),
    marginBottom: space(2),
  },
  skeleton: { height: 140, opacity: 0.5 },
  caption: {
    ...type.caption,
    textTransform: 'uppercase',
    marginBottom: space(2),
  },
  bigNum: { fontSize: 40, lineHeight: 46, fontWeight: '700' },
  sub: { ...type.small },
  streakRow: { flexDirection: 'row', alignItems: 'center' },
  streakSep: { width: 1, height: 40, backgroundColor: 'transparent', marginHorizontal: space(3) },
  rule: { ...type.small, marginTop: space(2) },
  calm: { ...type.body, marginTop: space(1) },
  milestone: {
    marginTop: space(2),
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space(2),
  },
  milestoneText: { ...type.body, fontWeight: '600' },
  rateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space(1) },
  rateLabel: { ...type.body, width: 110 },
  rateTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', marginHorizontal: space(1) },
  rateFill: { height: 8, borderRadius: 4 },
  rateValue: { ...type.body, fontWeight: '600', width: 52, textAlign: 'right' },
  rateDetail: { ...type.small, width: 56, textAlign: 'right' },
  stacked: { height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row', marginBottom: space(2) },
  legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space(1) },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: space(1) },
  legendName: { ...type.body, flex: 1 },
  legendMin: { ...type.mono },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space(1) },
  barName: { ...type.small, width: 110 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', marginHorizontal: space(1) },
  barFill: { height: 8, borderRadius: 4 },
  barMin: { ...type.mono, width: 64, textAlign: 'right' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space(2) },
  reviewLine: { ...type.body, marginBottom: space(1) },
  improve: { borderWidth: 1, borderRadius: radius.sm, padding: space(2), marginTop: space(1) },
  improveLabel: { ...type.caption, textTransform: 'uppercase' },
  improveValue: { ...type.h3, marginTop: 4 },
});
