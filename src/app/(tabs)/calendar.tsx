import { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import {
  ArrowUpRight,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  MoveRight,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native';
import { useDb } from '../../db/useDb';
import { getLogEvents, logEvent } from '../../db/log';
import { useUiStore } from '../../state/ui';
import { useTasksStore } from '../../state/tasks';
import { dark, hitSlop12, hitSlop8, light, Priority, priorityRuleColor, radius, space, type } from '../../theme/tokens';
import { PressableScale } from '../../components/PressableScale';
import { MetallicText } from '../../components/MetallicText';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { AddTaskSheet } from '../../components/AddTaskSheet';
import { FAB_CLEARANCE } from '../../components/Fab';
import {
  categoryMeta,
  daySummary,
  instancesInRange,
  monthSummary,
  MonthSummary,
  sessionsInRange,
  titlesForEvents,
} from '../../stats/queries';
import { addDays, localDateString, nowUtcIso } from '../../db/time';
import type { LogEvent, TaskInstance, TimerSession } from '../../db/types';
import { haptics } from '../../haptics';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS_MON = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const WEEKDAYS_SUN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseDate(s: string): { year: number; month: number; day: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function formatDayHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatAlarmDisplay(hhmm: string | null, format: '12h' | '24h'): string {
  if (!hhmm) return 'ANYTIME';
  if (format === '24h') return hhmm;
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  if (!Number.isFinite(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${period}`;
}

interface Cell {
  key: string;
  date: string | null;
  dayNum: number | null;
}

function buildMonthGrid(year: number, month: number, weekStart: 'mon' | 'sun'): Cell[][] {
  const firstDowSun0 = new Date(year, month - 1, 1).getDay();
  const leadBlank =
    weekStart === 'mon' ? (firstDowSun0 + 6) % 7 : firstDowSun0;
  const daysInMonth = new Date(year, month, 0).getDate();
  const flat: Cell[] = [];
  for (let i = 0; i < leadBlank; i++) {
    flat.push({ key: `lead-${i}`, date: null, dayNum: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = dateKey(year, month, d);
    flat.push({ key: dt, date: dt, dayNum: d });
  }
  while (flat.length % 7 !== 0) {
    flat.push({ key: `trail-${flat.length}`, date: null, dayNum: null });
  }
  const rows: Cell[][] = [];
  for (let i = 0; i < flat.length; i += 7) {
    rows.push(flat.slice(i, i + 7));
  }
  return rows;
}

function getWeekDates(centerDateStr: string, weekStart: 'mon' | 'sun'): string[] {
  const { year, month, day } = parseDate(centerDateStr);
  const d = new Date(year, month - 1, day);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const offset = weekStart === 'mon' ? (dow + 6) % 7 : dow;
  const startStr = addDays(centerDateStr, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(startStr, i));
}

function dayBoundsUtc(dateStr: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return {
    startUtc: new Date(y, m - 1, d, 0, 0, 0).toISOString(),
    endUtc: new Date(y, m - 1, d, 23, 59, 59, 999).toISOString(),
  };
}

export default function CalendarScreen() {
  const db = useDb();
  const router = useRouter();
  const theme = useUiStore((s) => s.theme);
  const clockFormat = useUiStore((s) => s.clockFormat);
  const weekStart = useUiStore((s) => s.weekStart);
  const rescheduleTask = useTasksStore((s) => s.rescheduleTask);
  const refreshTodayStore = useTasksStore((s) => s.refresh);
  const palette = theme === 'light' ? light : dark;
  const { width } = useWindowDimensions();

  const today = useMemo(() => localDateString(), []);
  const initialParsed = useMemo(() => parseDate(today), [today]);

  const [selectedDate, setSelectedDate] = useState(today);
  const [year, setYear] = useState(initialParsed.year);
  const [month, setMonth] = useState(initialParsed.month);
  const [monthExpanded, setMonthExpanded] = useState(true);
  const [summary, setSummary] = useState<MonthSummary>({});
  const [weekSummary, setWeekSummary] = useState<MonthSummary>({});

  // Selected day panel state
  const [activeTab, setActiveTab] = useState<'tasks' | 'timers' | 'logs'>('tasks');
  const [dayTasks, setDayTasks] = useState<TaskInstance[]>([]);
  const [dayTimers, setDayTimers] = useState<TimerSession[]>([]);
  const [dayLogs, setDayLogs] = useState<LogEvent[]>([]);
  const [cats, setCats] = useState<Record<string, { name: string }>>({});
  const [logTitles, setLogTitles] = useState<Record<string, string>>({});
  const [dayStats, setDayStats] = useState({ done: 0, total: 0, ritualsDone: 0, ritualsTotal: 0 });

  // Sheets
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [movingTask, setMovingTask] = useState<TaskInstance | null>(null);

  const loadCalendarAndDay = useCallback(async () => {
    const weekDates = getWeekDates(selectedDate, weekStart);
    const { startUtc, endUtc } = dayBoundsUtc(selectedDate);

    const [mSum, wInst, dSum, dInst, dSess, dEvts, cMeta] = await Promise.all([
      monthSummary(db, year, month),
      instancesInRange(db, weekDates[0], weekDates[6]),
      daySummary(db, selectedDate),
      instancesInRange(db, selectedDate, selectedDate),
      sessionsInRange(db, startUtc, endUtc),
      getLogEvents(db, { day: selectedDate, limit: 100 }),
      categoryMeta(db),
    ]);

    const wMap: MonthSummary = {};
    for (const inst of wInst) {
      const entry = wMap[inst.date] ?? { done: 0, total: 0 };
      entry.total += 1;
      if (inst.status === 'done') entry.done += 1;
      wMap[inst.date] = entry;
    }

    const tMap = await titlesForEvents(db, dEvts);
    for (const inst of dInst) tMap[inst.id] = inst.title;

    setSummary(mSum);
    setWeekSummary(wMap);
    setDayStats(dSum);
    setDayTasks(dInst);
    setDayTimers(dSess);
    setDayLogs(dEvts);
    setCats(cMeta);
    setLogTitles(tMap);
  }, [db, year, month, selectedDate, weekStart]);

  useFocusEffect(
    useCallback(() => {
      void loadCalendarAndDay();
    }, [loadCalendarAndDay])
  );

  const selectDay = (dateStr: string) => {
    haptics.selection();
    setSelectedDate(dateStr);
    const parsed = parseDate(dateStr);
    if (parsed.year !== year || parsed.month !== month) {
      setYear(parsed.year);
      setMonth(parsed.month);
    }
  };

  const stepMonth = (delta: number) => {
    haptics.selection();
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setYear(y);
    setMonth(m);
  };

  const stepWeek = (deltaWeeks: number) => {
    const next = addDays(selectedDate, deltaWeeks * 7);
    selectDay(next);
  };

  const jumpToToday = () => {
    haptics.light();
    const t = localDateString();
    const p = parseDate(t);
    setSelectedDate(t);
    setYear(p.year);
    setMonth(p.month);
  };

  const toggleDayTaskDone = async (task: TaskInstance) => {
    haptics.medium();
    const nextStatus = task.status === 'done' ? 'pending' : 'done';
    const now = nowUtcIso();
    await db.runAsync(
      'UPDATE task_instances SET status = ?, updated_at = ? WHERE id = ?',
      nextStatus,
      now,
      task.id
    );
    await logEvent(db, {
      eventType: nextStatus === 'done' ? 'completed' : 'unchecked',
      taskInstanceId: task.id,
      templateId: task.templateId,
      payload: { source: 'calendar_day_panel', date: selectedDate },
    });
    if (selectedDate === today) {
      await refreshTodayStore(today);
    }
    await loadCalendarAndDay();
  };

  const handleMoveTaskToDate = async (targetDate: string) => {
    if (!movingTask) return;
    haptics.success();
    await rescheduleTask(movingTask.id, targetDate);
    setMovingTask(null);
    await loadCalendarAndDay();
  };

  const rows = useMemo(
    () => buildMonthGrid(year, month, weekStart),
    [year, month, weekStart]
  );
  const weekDates = useMemo(
    () => getWeekDates(selectedDate, weekStart),
    [selectedDate, weekStart]
  );
  const weekdayLabels = weekStart === 'mon' ? WEEKDAYS_MON : WEEKDAYS_SUN;

  const isTodaySelected =
    selectedDate === today &&
    year === initialParsed.year &&
    month === initialParsed.month;

  // Responsive cell sizing (works 320dp -> 430dp+)
  const gridPadding = space.base * 2 + space.md * 2;
  const gap = 6;
  const cellSize = Math.max(36, Math.floor((width - gridPadding - gap * 6) / 7));

  function getHeatFill(done: number, total: number, isSelected: boolean): string {
    if (isSelected) return palette.textPrimary;
    if (total === 0 || done === 0) return palette.bgElevated;
    const ratio = done / total;
    if (theme === 'dark') {
      if (ratio >= 1) return 'rgba(255,255,255,0.26)';
      if (ratio >= 0.66) return 'rgba(255,255,255,0.18)';
      if (ratio >= 0.33) return 'rgba(255,255,255,0.11)';
      return 'rgba(255,255,255,0.06)';
    } else {
      if (ratio >= 1) return 'rgba(0,0,0,0.22)';
      if (ratio >= 0.66) return 'rgba(0,0,0,0.15)';
      if (ratio >= 0.33) return 'rgba(0,0,0,0.09)';
      return 'rgba(0,0,0,0.05)';
    }
  }

  const moveOptions = useMemo(() => {
    if (!movingTask) return [];
    const base = movingTask.date;
    return [
      { label: 'Today', sub: today, date: today },
      { label: 'Tomorrow', sub: addDays(today, 1), date: addDays(today, 1) },
      { label: '+1 Day from Task', sub: addDays(base, 1), date: addDays(base, 1) },
      { label: '+2 Days from Task', sub: addDays(base, 2), date: addDays(base, 2) },
      { label: '+3 Days from Task', sub: addDays(base, 3), date: addDays(base, 3) },
      { label: 'Next Week (+7d)', sub: addDays(base, 7), date: addDays(base, 7) },
    ];
  }, [movingTask, today]);

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
        {/* Top Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerTitleCol}>
            <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
              CHRONOLOGY & SCHEDULE
            </Text>
            <MetallicText variant="h1" palette={palette}>
              Calendar
            </MetallicText>
          </View>

          <View style={styles.headerActions}>
            {!isTodaySelected ? (
              <PressableScale
                onPress={jumpToToday}
                hitSlop={hitSlop8}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
                style={[
                  styles.todayJumpPill,
                  {
                    backgroundColor: palette.bgSurface,
                    borderColor: palette.borderStrong,
                  },
                ]}
              >
                <RotateCcw size={13} color={palette.textPrimary} strokeWidth={2} />
                <Text style={[styles.todayJumpText, { color: palette.textPrimary }]}>
                  Today
                </Text>
              </PressableScale>
            ) : null}

            <PressableScale
              onPress={() => {
                haptics.selection();
                setMonthExpanded((v) => !v);
              }}
              hitSlop={hitSlop8}
              accessibilityRole="button"
              accessibilityLabel={
                monthExpanded ? 'Collapse to week view' : 'Expand to month view'
              }
              style={[
                styles.viewToggleBtn,
                {
                  backgroundColor: palette.bgSurface,
                  borderColor: palette.border,
                },
              ]}
            >
              <Text style={[styles.viewToggleText, { color: palette.textSecondary }]}>
                {monthExpanded ? 'MONTH' : 'WEEK'}
              </Text>
              {monthExpanded ? (
                <ChevronUp size={14} color={palette.textSecondary} />
              ) : (
                <ChevronDown size={14} color={palette.textSecondary} />
              )}
            </PressableScale>
          </View>
        </View>

        {/* Week Strip (always visible for rapid horizontal day switching) */}
        <Card palette={palette} variant="elevated" padding="md">
          <View style={styles.stripHeader}>
            <PressableScale
              onPress={() => stepWeek(-1)}
              hitSlop={hitSlop12}
              style={[
                styles.navIconBtn,
                { backgroundColor: palette.bgSurface, borderColor: palette.border },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Previous week"
            >
              <ChevronLeft size={16} color={palette.textPrimary} />
            </PressableScale>

            <Text
              style={[styles.stripLabel, { color: palette.textSecondary }]}
              numberOfLines={1}
            >
              WEEK OF {formatDayHeader(weekDates[0]).toUpperCase()}
            </Text>

            <PressableScale
              onPress={() => stepWeek(1)}
              hitSlop={hitSlop12}
              style={[
                styles.navIconBtn,
                { backgroundColor: palette.bgSurface, borderColor: palette.border },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Next week"
            >
              <ChevronRight size={16} color={palette.textPrimary} />
            </PressableScale>
          </View>

          <View style={styles.weekRow}>
            {weekDates.map((dStr, idx) => {
              const parsed = parseDate(dStr);
              const stat = weekSummary[dStr] ?? summary[dStr] ?? { done: 0, total: 0 };
              const isSelected = dStr === selectedDate;
              const isToday = dStr === today;
              const fill = getHeatFill(stat.done, stat.total, isSelected);
              const textColor = isSelected
                ? palette.textInverse
                : palette.textPrimary;

              return (
                <PressableScale
                  key={dStr}
                  onPress={() => selectDay(dStr)}
                  hitSlop={hitSlop8}
                  accessibilityRole="button"
                  accessibilityLabel={`${dStr}, ${stat.done} of ${stat.total} completed`}
                  style={[
                    styles.weekCell,
                    {
                      width: cellSize,
                      backgroundColor: fill,
                      borderColor: isSelected
                        ? palette.textPrimary
                        : isToday
                          ? palette.borderStrong
                          : palette.border,
                      borderWidth: isSelected || isToday ? 1.5 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.weekDowText,
                      {
                        color: isSelected
                          ? palette.textInverse
                          : palette.textMuted,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {weekdayLabels[idx].slice(0, 1)}
                  </Text>
                  <Text
                    style={[styles.weekDayNum, { color: textColor }]}
                    numberOfLines={1}
                  >
                    {parsed.day}
                  </Text>
                  <View style={styles.dotRow}>
                    {stat.total > 0 ? (
                      <Text
                        style={[
                          styles.countMicro,
                          {
                            color: isSelected
                              ? palette.textInverse
                              : palette.textSecondary,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {stat.done}/{stat.total}
                      </Text>
                    ) : (
                      <View
                        style={[
                          styles.emptyDot,
                          {
                            backgroundColor: isSelected
                              ? palette.textInverse
                              : palette.border,
                          },
                        ]}
                      />
                    )}
                  </View>
                </PressableScale>
              );
            })}
          </View>
        </Card>

        {/* Expandable Month Grid */}
        {monthExpanded ? (
          <Animated.View
            entering={FadeInDown.duration(180).easing(Easing.out(Easing.cubic))}
          >
            <Card palette={palette} padding="md">
              <View style={styles.monthHeader}>
                <PressableScale
                  onPress={() => stepMonth(-1)}
                  hitSlop={hitSlop12}
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                  style={[
                    styles.navIconBtn,
                    {
                      backgroundColor: palette.bgElevated,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <ChevronLeft size={18} color={palette.textPrimary} />
                </PressableScale>

                <Text
                  style={[styles.monthTitle, { color: palette.textPrimary }]}
                  numberOfLines={1}
                >
                  {MONTHS[month - 1]} {year}
                </Text>

                <PressableScale
                  onPress={() => stepMonth(1)}
                  hitSlop={hitSlop12}
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                  style={[
                    styles.navIconBtn,
                    {
                      backgroundColor: palette.bgElevated,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <ChevronRight size={18} color={palette.textPrimary} />
                </PressableScale>
              </View>

              <View style={styles.dowHeaderRow}>
                {weekdayLabels.map((w) => (
                  <View key={w} style={{ width: cellSize, alignItems: 'center' }}>
                    <Text style={[styles.dowHeaderText, { color: palette.textMuted }]}>
                      {w}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.monthGrid}>
                {rows.map((r, rIdx) => (
                  <View key={`row-${rIdx}`} style={styles.monthGridRow}>
                    {r.map((c) => {
                      if (!c.date || c.dayNum == null) {
                        return (
                          <View
                            key={c.key}
                            style={{ width: cellSize, height: cellSize }}
                          />
                        );
                      }
                      const stat = summary[c.date] ?? { done: 0, total: 0 };
                      const isSelected = c.date === selectedDate;
                      const isToday = c.date === today;
                      const fill = getHeatFill(stat.done, stat.total, isSelected);
                      const textColor = isSelected
                        ? palette.textInverse
                        : palette.textPrimary;

                      return (
                        <PressableScale
                          key={c.key}
                          onPress={() => selectDay(c.date!)}
                          hitSlop={hitSlop8}
                          accessibilityRole="button"
                          accessibilityLabel={`${c.date}, ${stat.done} of ${stat.total} done`}
                          style={[
                            styles.monthCell,
                            {
                              width: cellSize,
                              height: cellSize,
                              backgroundColor: fill,
                              borderColor: isSelected
                                ? palette.textPrimary
                                : isToday
                                  ? palette.borderStrong
                                  : palette.border,
                              borderWidth:
                                isSelected || isToday ? 1.5 : StyleSheet.hairlineWidth,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.monthCellNum, { color: textColor }]}
                            numberOfLines={1}
                          >
                            {c.dayNum}
                          </Text>
                          {stat.total > 0 ? (
                            <Text
                              style={[
                                styles.monthCellCount,
                                {
                                  color: isSelected
                                    ? palette.textInverse
                                    : palette.textSecondary,
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {stat.done}/{stat.total}
                            </Text>
                          ) : null}
                        </PressableScale>
                      );
                    })}
                  </View>
                ))}
              </View>

              {/* Heat Legend */}
              <View style={[styles.legendRow, { borderTopColor: palette.border }]}>
                <Text style={[styles.legendText, { color: palette.textMuted }]}>
                  INTENSITY
                </Text>
                <View style={styles.legendSwatches}>
                  {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
                    <View
                      key={i}
                      style={[
                        styles.swatch,
                        {
                          backgroundColor: getHeatFill(r * 4, 4, false),
                          borderColor: palette.border,
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.legendText, { color: palette.textMuted }]}>
                  100%
                </Text>
              </View>
            </Card>
          </Animated.View>
        ) : null}

        {/* Interactive Day Panel */}
        <Card palette={palette} variant="elevated" padding="md">
          <View style={styles.dayPanelHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
                SELECTED DAY
              </Text>
              <Text
                style={[styles.dayPanelTitle, { color: palette.textPrimary }]}
                numberOfLines={1}
              >
                {formatDayHeader(selectedDate)}
                {selectedDate === today ? ' · Today' : ''}
              </Text>
              <Text style={[styles.dayPanelMeta, { color: palette.textSecondary }]}>
                {dayStats.done}/{dayStats.total} tasks completed
                {dayStats.ritualsTotal > 0
                  ? ` · ${dayStats.ritualsDone}/${dayStats.ritualsTotal} rituals`
                  : ''}
              </Text>
            </View>

            <View style={styles.dayPanelHeaderBtns}>
              <PressableScale
                onPress={() => {
                  haptics.light();
                  setAddTaskOpen(true);
                }}
                hitSlop={hitSlop8}
                accessibilityRole="button"
                accessibilityLabel={`Add task for ${selectedDate}`}
                style={[
                  styles.inlineAddBtn,
                  {
                    backgroundColor: palette.textPrimary,
                  },
                ]}
              >
                <Plus size={15} color={palette.textInverse} strokeWidth={2.5} />
                <Text style={[styles.inlineAddText, { color: palette.textInverse }]}>
                  Add
                </Text>
              </PressableScale>

              <PressableScale
                onPress={() => {
                  haptics.selection();
                  router.push(`/day/${selectedDate}`);
                }}
                hitSlop={hitSlop8}
                accessibilityRole="button"
                accessibilityLabel="Open full day screen"
                style={[
                  styles.expandDayBtn,
                  {
                    backgroundColor: palette.bgSurface,
                    borderColor: palette.border,
                  },
                ]}
              >
                <ArrowUpRight size={16} color={palette.textSecondary} />
              </PressableScale>
            </View>
          </View>

          {/* Sub-tabs: Tasks / Timers / Logs */}
          <View
            style={[
              styles.subTabBar,
              { backgroundColor: palette.bg, borderColor: palette.border },
            ]}
          >
            {(
              [
                { key: 'tasks', label: `Tasks (${dayTasks.length})` },
                { key: 'timers', label: `Timers (${dayTimers.length})` },
                { key: 'logs', label: `Logs (${dayLogs.length})` },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.key;
              return (
                <PressableScale
                  key={tab.key}
                  onPress={() => {
                    haptics.selection();
                    setActiveTab(tab.key);
                  }}
                  style={[
                    styles.subTabPill,
                    active && {
                      backgroundColor: palette.bgSurface,
                      borderColor: palette.borderStrong,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.subTabText,
                      {
                        color: active ? palette.textPrimary : palette.textMuted,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {tab.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          {/* Sub-tab Content */}
          {activeTab === 'tasks' ? (
            <View style={styles.daySectionList}>
              {dayTasks.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>
                    No tasks scheduled for {formatDayHeader(selectedDate)}
                  </Text>
                  <Text style={[styles.emptySub, { color: palette.textMuted }]}>
                    Tap + Add above to schedule a task or ritual on this date.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={[styles.longPressHint, { color: palette.textMuted }]}>
                    TAP TO COMPLETE · LONG-PRESS TO MOVE TO ANOTHER DAY
                  </Text>
                  {dayTasks.map((t) => {
                    const isDone = t.status === 'done';
                    const isSkipped = t.status === 'skipped';
                    const catLabel = t.categoryId
                      ? cats[t.categoryId]?.name ?? t.categoryId
                      : 'General';
                    return (
                      <PressableScale
                        key={t.id}
                        onPress={() => void toggleDayTaskDone(t)}
                        onLongPress={() => {
                          haptics.medium();
                          setMovingTask(t);
                        }}
                        style={[
                          styles.dayTaskCard,
                          {
                            backgroundColor: palette.bgSurface,
                            borderColor: palette.border,
                            borderLeftColor: priorityRuleColor(t.priority as Priority, palette) ?? palette.border,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.checkCircle,
                            {
                              borderColor: isDone
                                ? palette.textPrimary
                                : palette.borderStrong,
                              backgroundColor: isDone
                                ? palette.textPrimary
                                : 'transparent',
                            },
                          ]}
                        >
                          {isDone ? (
                            <Check
                              size={13}
                              color={palette.textInverse}
                              strokeWidth={3}
                            />
                          ) : null}
                        </View>

                        <View style={styles.dayTaskBody}>
                          <Text
                            style={[
                              styles.dayTaskTitle,
                              {
                                color:
                                  isDone || isSkipped
                                    ? palette.textMuted
                                    : palette.textPrimary,
                                textDecorationLine: isDone ? 'line-through' : 'none',
                              },
                            ]}
                            numberOfLines={1}
                          >
                            {t.title}
                          </Text>
                          <View style={styles.dayTaskMetaRow}>
                            <Text
                              style={[styles.dayTaskTime, { color: palette.textSecondary }]}
                            >
                              {formatAlarmDisplay(t.alarmTime, clockFormat)}
                            </Text>
                            <Text style={[styles.dayTaskDot, { color: palette.textMuted }]}>
                              ·
                            </Text>
                            <Text
                              style={[styles.dayTaskCat, { color: palette.textMuted }]}
                              numberOfLines={1}
                            >
                              {catLabel}
                            </Text>
                            {t.durationMin > 0 ? (
                              <>
                                <Text
                                  style={[styles.dayTaskDot, { color: palette.textMuted }]}
                                >
                                  ·
                                </Text>
                                <Text
                                  style={[
                                    styles.dayTaskTime,
                                    { color: palette.textMuted },
                                  ]}
                                >
                                  {t.durationMin}m
                                </Text>
                              </>
                            ) : null}
                            {t.isRitual ? (
                              <Sparkles
                                size={11}
                                color={palette.textSecondary}
                                style={{ marginLeft: 4 }}
                              />
                            ) : null}
                          </View>
                        </View>

                        <PressableScale
                          onPress={() => {
                            haptics.medium();
                            setMovingTask(t);
                          }}
                          hitSlop={hitSlop8}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${t.title} to another day`}
                          style={[
                            styles.taskActionMini,
                            {
                              backgroundColor: palette.bgElevated,
                              borderColor: palette.border,
                            },
                          ]}
                        >
                          <MoveRight size={14} color={palette.textSecondary} />
                        </PressableScale>

                        {!isDone && !isSkipped ? (
                          <PressableScale
                            onPress={() => {
                              haptics.light();
                              router.push({
                                pathname: '/timer',
                                params: {
                                  instanceId: t.id,
                                  title: t.title,
                                  durationMin: String(t.durationMin || 25),
                                },
                              });
                            }}
                            hitSlop={hitSlop8}
                            accessibilityRole="button"
                            accessibilityLabel={`Start timer for ${t.title}`}
                            style={[
                              styles.taskActionMini,
                              {
                                backgroundColor: palette.bgElevated,
                                borderColor: palette.border,
                              },
                            ]}
                          >
                            <Play
                              size={13}
                              color={palette.textPrimary}
                              fill={palette.textPrimary}
                            />
                          </PressableScale>
                        ) : null}
                      </PressableScale>
                    );
                  })}
                </>
              )}
            </View>
          ) : null}

          {activeTab === 'timers' ? (
            <View style={styles.daySectionList}>
              {dayTimers.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>
                    No timer sessions on this day
                  </Text>
                </View>
              ) : (
                dayTimers.map((s) => {
                  const startMs = new Date(s.startedAtUtc).getTime();
                  const endMs = s.endedAtUtc ? new Date(s.endedAtUtc).getTime() : null;
                  const elapsedMin =
                    endMs && endMs > startMs
                      ? Math.max(1, Math.round((endMs - startMs) / 60000))
                      : null;
                  const title =
                    (s.taskInstanceId && logTitles[s.taskInstanceId]) ||
                    'Focus session';
                  return (
                    <View
                      key={s.id}
                      style={[
                        styles.infoRow,
                        {
                          backgroundColor: palette.bgSurface,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <Clock size={15} color={palette.textSecondary} />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.infoTitle, { color: palette.textPrimary }]}
                          numberOfLines={1}
                        >
                          {title}
                        </Text>
                        <Text style={[styles.infoSub, { color: palette.textMuted }]}>
                          {s.mode.toUpperCase()} ·{' '}
                          {new Date(s.startedAtUtc).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </View>
                      <Text style={[styles.infoRight, { color: palette.textPrimary }]}>
                        {elapsedMin != null ? `${elapsedMin}m` : 'Active'}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          ) : null}

          {activeTab === 'logs' ? (
            <View style={styles.daySectionList}>
              {dayLogs.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>
                    No log events recorded on this day
                  </Text>
                </View>
              ) : (
                dayLogs.slice(0, 20).map((e) => {
                  const refTitle =
                    (e.taskInstanceId && logTitles[e.taskInstanceId]) ||
                    (e.templateId && logTitles[e.templateId]) ||
                    null;
                  return (
                    <View
                      key={e.id}
                      style={[
                        styles.infoRow,
                        {
                          backgroundColor: palette.bgSurface,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.infoTitle, { color: palette.textPrimary }]}
                          numberOfLines={1}
                        >
                          {e.eventType.replace(/_/g, ' ').toUpperCase()}
                          {refTitle ? ` · ${refTitle}` : ''}
                        </Text>
                        <Text style={[styles.infoSub, { color: palette.textMuted }]}>
                          {new Date(e.tsUtc).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          ) : null}
        </Card>
      </ScrollView>

      {/* Inline Add Task Sheet prefilled for selectedDate */}
      <AddTaskSheet
        visible={addTaskOpen}
        defaultDate={selectedDate}
        onClose={() => {
          setAddTaskOpen(false);
          void loadCalendarAndDay();
        }}
      />

      {/* Long-Press Move Task to Another Day Sheet */}
      <Sheet
        visible={movingTask !== null}
        onClose={() => setMovingTask(null)}
        title="Move Task to Day"
      >
        {movingTask ? (
          <View style={styles.moveSheetBody}>
            <Text
              style={[styles.moveSheetTaskTitle, { color: palette.textPrimary }]}
              numberOfLines={2}
            >
              {movingTask.title}
            </Text>
            <Text style={[styles.moveSheetSub, { color: palette.textMuted }]}>
              CURRENT DATE: {movingTask.date}
            </Text>

            <View style={styles.moveOptionList}>
              {moveOptions.map((opt) => (
                <PressableScale
                  key={opt.label}
                  onPress={() => void handleMoveTaskToDate(opt.date)}
                  style={[
                    styles.moveOptionRow,
                    {
                      backgroundColor: palette.bgElevated,
                      borderColor:
                        opt.date === movingTask.date
                          ? palette.borderStrong
                          : palette.border,
                    },
                  ]}
                >
                  <View style={styles.moveOptionLeft}>
                    <CalendarIcon size={16} color={palette.textSecondary} />
                    <Text
                      style={[styles.moveOptionLabel, { color: palette.textPrimary }]}
                    >
                      {opt.label}
                    </Text>
                  </View>
                  <Text style={[styles.moveOptionDate, { color: palette.textMuted }]}>
                    {opt.sub}
                  </Text>
                </PressableScale>
              ))}
            </View>

            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => setMovingTask(null)}
              fullWidth
            />
          </View>
        ) : null}
      </Sheet>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  headerTitleCol: {
    flex: 1,
  },
  eyebrow: {
    ...type.label,
    marginBottom: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  todayJumpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  todayJumpText: {
    ...type.bodySm,
    fontWeight: '700',
  },
  viewToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  viewToggleText: {
    ...type.label,
  },
  stripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  stripLabel: {
    ...type.label,
    flex: 1,
    textAlign: 'center',
  },
  navIconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  weekCell: {
    paddingVertical: space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  weekDowText: {
    ...type.caption,
    fontSize: 10,
    fontWeight: '700',
  },
  weekDayNum: {
    ...type.mono,
    fontSize: 14,
  },
  dotRow: {
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countMicro: {
    ...type.monoSm,
    fontSize: 9,
  },
  emptyDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  monthTitle: {
    ...type.h3,
  },
  dowHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  dowHeaderText: {
    ...type.caption,
    fontSize: 10,
    fontWeight: '700',
  },
  monthGrid: {
    gap: 6,
  },
  monthGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  monthCell: {
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCellNum: {
    ...type.monoSm,
    fontWeight: '700',
  },
  monthCellCount: {
    fontSize: 9,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.xs,
    marginTop: space.md,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legendSwatches: {
    flexDirection: 'row',
    gap: 4,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendText: {
    ...type.caption,
    fontSize: 10,
  },
  dayPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.md,
  },
  dayPanelTitle: {
    ...type.h3,
    marginTop: 2,
  },
  dayPanelMeta: {
    ...type.caption,
    marginTop: 2,
  },
  dayPanelHeaderBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  inlineAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    minHeight: 40,
    borderRadius: radius.pill,
  },
  inlineAddText: {
    ...type.bodySm,
    fontWeight: '700',
  },
  expandDayBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTabBar: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: space.md,
    gap: 4,
  },
  subTabPill: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  subTabText: {
    ...type.caption,
    fontWeight: '700',
  },
  daySectionList: {
    gap: space.sm,
  },
  longPressHint: {
    ...type.label,
    fontSize: 9,
    marginBottom: 2,
  },
  dayTaskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    minHeight: 60,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTaskBody: {
    flex: 1,
    gap: 2,
  },
  dayTaskTitle: {
    ...type.body,
    fontWeight: '600',
  },
  dayTaskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayTaskTime: {
    ...type.monoSm,
  },
  dayTaskDot: {
    ...type.caption,
  },
  dayTaskCat: {
    ...type.caption,
    flexShrink: 1,
  },
  taskActionMini: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    paddingVertical: space.xl,
    alignItems: 'center',
    gap: 4,
  },
  emptyTitle: {
    ...type.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySub: {
    ...type.caption,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoTitle: {
    ...type.bodySm,
    fontWeight: '600',
  },
  infoSub: {
    ...type.monoSm,
    marginTop: 2,
  },
  infoRight: {
    ...type.mono,
  },
  moveSheetBody: {
    gap: space.md,
  },
  moveSheetTaskTitle: {
    ...type.h3,
  },
  moveSheetSub: {
    ...type.monoSm,
  },
  moveOptionList: {
    gap: space.sm,
    marginVertical: space.xs,
  },
  moveOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  moveOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  moveOptionLabel: {
    ...type.body,
    fontWeight: '600',
  },
  moveOptionDate: {
    ...type.monoSm,
  },
});
