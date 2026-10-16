import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Check,
  Clock,
  MoveRight,
  Play,
  Plus,
  Sparkles,
} from 'lucide-react-native';
import { useDb } from '../../db/useDb';
import { getLogEvents, logEvent } from '../../db/log';
import { useUiStore } from '../../state/ui';
import { useTasksStore } from '../../state/tasks';
import { dark, hitSlop12, hitSlop8, light, Priority, radius, space, type } from '../../theme/tokens';
import { PressableScale } from '../../components/PressableScale';
import { MetallicText } from '../../components/MetallicText';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { AddTaskSheet } from '../../components/AddTaskSheet';
import {
  categoryMeta,
  instancesInRange,
  sessionsInRange,
  titlesForEvents,
} from '../../stats/queries';
import { addDays, localDateString, nowUtcIso } from '../../db/time';
import type { LogEvent, TaskInstance, TimerSession } from '../../db/types';
import { haptics } from '../../haptics';

function formatHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function dayBoundsUtc(dateStr: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return {
    startUtc: new Date(y, m - 1, d, 0, 0, 0).toISOString(),
    endUtc: new Date(y, m - 1, d, 23, 59, 59, 999).toISOString(),
  };
}

function fmtLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtSessionMin(s: TimerSession): string {
  if (!s.endedAtUtc) return 'active';
  const a = new Date(s.startedAtUtc).getTime();
  const b = new Date(s.endedAtUtc).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return '0m';
  return `${Math.max(1, Math.round((b - a) / 60000))}m`;
}

export default function DayDetailScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const dayStr = typeof date === 'string' && date.length > 0 ? date : localDateString();
  const db = useDb();
  const router = useRouter();
  const theme = useUiStore((s) => s.theme);
  const rescheduleTask = useTasksStore((s) => s.rescheduleTask);
  const refreshTodayStore = useTasksStore((s) => s.refresh);
  const palette = theme === 'light' ? light : dark;
  const today = useMemo(() => localDateString(), []);

  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [sessions, setSessions] = useState<TimerSession[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [cats, setCats] = useState<Record<string, { name: string }>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [movingTask, setMovingTask] = useState<TaskInstance | null>(null);

  const loadDay = useCallback(async () => {
    const { startUtc, endUtc } = dayBoundsUtc(dayStr);
    const [inst, sess, evts, cMeta] = await Promise.all([
      instancesInRange(db, dayStr, dayStr),
      sessionsInRange(db, startUtc, endUtc),
      getLogEvents(db, { day: dayStr, limit: 200 }),
      categoryMeta(db),
    ]);
    const tMap = await titlesForEvents(db, evts);
    for (const i of inst) tMap[i.id] = i.title;
    setInstances(inst);
    setSessions(sess);
    setEvents(evts);
    setCats(cMeta);
    setTitles(tMap);
  }, [db, dayStr]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  const toggleTask = async (t: TaskInstance) => {
    haptics.medium();
    const nextStatus = t.status === 'done' ? 'pending' : 'done';
    const now = nowUtcIso();
    await db.runAsync(
      'UPDATE task_instances SET status = ?, updated_at = ? WHERE id = ?',
      nextStatus,
      now,
      t.id
    );
    await logEvent(db, {
      eventType: nextStatus === 'done' ? 'completed' : 'unchecked',
      taskInstanceId: t.id,
      templateId: t.templateId,
      payload: { source: 'day_detail', date: dayStr },
    });
    if (dayStr === today) {
      await refreshTodayStore(today);
    }
    await loadDay();
  };

  const handleMoveTaskToDate = async (targetDate: string) => {
    if (!movingTask) return;
    haptics.success();
    await rescheduleTask(movingTask.id, targetDate);
    setMovingTask(null);
    await loadDay();
  };

  const doneCount = instances.filter((i) => i.status === 'done').length;

  const moveOptions = useMemo(() => {
    if (!movingTask) return [];
    const base = movingTask.date;
    return [
      { label: 'Today', sub: today, date: today },
      { label: 'Tomorrow', sub: addDays(today, 1), date: addDays(today, 1) },
      { label: '+1 Day from Task', sub: addDays(base, 1), date: addDays(base, 1) },
      { label: '+2 Days from Task', sub: addDays(base, 2), date: addDays(base, 2) },
      { label: 'Next Week (+7d)', sub: addDays(base, 7), date: addDays(base, 7) },
    ];
  }, [movingTask, today]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <PressableScale
          onPress={() => router.back()}
          hitSlop={hitSlop12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={[
            styles.backBtn,
            { backgroundColor: palette.bgSurface, borderColor: palette.border },
          ]}
        >
          <ArrowLeft size={18} color={palette.textPrimary} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
            DAY ARCHIVE & PLAN
          </Text>
          <MetallicText variant="h2" palette={palette} numberOfLines={1}>
            {formatHeading(dayStr)}
          </MetallicText>
        </View>
        <Button
          label="Add"
          size="sm"
          palette={palette}
          icon={<Plus size={14} color={palette.textInverse} strokeWidth={2.5} />}
          onPress={() => setAddTaskOpen(true)}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary Pill */}
        <Card palette={palette} variant="elevated" padding="md">
          <View style={styles.summaryRow}>
            <View>
              <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
                COMPLETION
              </Text>
              <MetallicText variant="h1" palette={palette}>
                {doneCount}/{instances.length}
              </MetallicText>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
                SESSIONS / LOGS
              </Text>
              <Text style={[styles.summaryRightVal, { color: palette.textPrimary }]}>
                {sessions.length} timers · {events.length} events
              </Text>
            </View>
          </View>
        </Card>

        {/* Tasks Section */}
        <Card palette={palette} padding="md">
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>
              TASKS ({doneCount}/{instances.length})
            </Text>
            <Text style={[styles.hintText, { color: palette.textMuted }]}>
              LONG-PRESS TO MOVE
            </Text>
          </View>

          {instances.length === 0 ? (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              No tasks scheduled for this date.
            </Text>
          ) : (
            <View style={styles.listGap}>
              {instances.map((t) => {
                const isDone = t.status === 'done';
                const catName = t.categoryId
                  ? cats[t.categoryId]?.name ?? t.categoryId
                  : 'General';
                return (
                  <PressableScale
                    key={t.id}
                    onPress={() => void toggleTask(t)}
                    onLongPress={() => {
                      haptics.medium();
                      setMovingTask(t);
                    }}
                    style={[
                      styles.taskRow,
                      {
                        backgroundColor: palette.bgElevated,
                        borderColor: palette.border,
                        borderLeftColor:
                          palette.priority[t.priority as Priority] ?? palette.border,
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

                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.taskTitle,
                          {
                            color: isDone
                              ? palette.textMuted
                              : palette.textPrimary,
                            textDecorationLine: isDone ? 'line-through' : 'none',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {t.title}
                      </Text>
                      <View style={styles.metaRow}>
                        <Text
                          style={[styles.metaMono, { color: palette.textSecondary }]}
                        >
                          {t.alarmTime ?? 'ANYTIME'}
                        </Text>
                        <Text style={[styles.metaMono, { color: palette.textMuted }]}>
                          · {catName}
                        </Text>
                        {t.durationMin > 0 ? (
                          <Text
                            style={[styles.metaMono, { color: palette.textMuted }]}
                          >
                            · {t.durationMin}m
                          </Text>
                        ) : null}
                        {t.isRitual ? (
                          <Sparkles size={11} color={palette.textSecondary} />
                        ) : null}
                      </View>
                    </View>

                    <PressableScale
                      onPress={() => {
                        haptics.medium();
                        setMovingTask(t);
                      }}
                      hitSlop={hitSlop8}
                      style={[
                        styles.iconAction,
                        {
                          backgroundColor: palette.bgSurface,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <MoveRight size={14} color={palette.textSecondary} />
                    </PressableScale>

                    {!isDone ? (
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
                        style={[
                          styles.iconAction,
                          {
                            backgroundColor: palette.bgSurface,
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
            </View>
          )}
        </Card>

        {/* Timer Sessions */}
        <Card palette={palette} padding="md">
          <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>
            TIMER SESSIONS ({sessions.length})
          </Text>
          {sessions.length === 0 ? (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              No timer sessions recorded on this day.
            </Text>
          ) : (
            <View style={styles.listGap}>
              {sessions.map((s) => {
                const label =
                  (s.taskInstanceId && titles[s.taskInstanceId]) ||
                  'Focus session';
                return (
                  <View
                    key={s.id}
                    style={[
                      styles.infoRow,
                      {
                        backgroundColor: palette.bgElevated,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <Clock size={15} color={palette.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.taskTitle, { color: palette.textPrimary }]}
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                      <Text style={[styles.metaMono, { color: palette.textMuted }]}>
                        {s.mode.toUpperCase()} · {fmtLocalTime(s.startedAtUtc)}
                      </Text>
                    </View>
                    <Text style={[styles.metaMono, { color: palette.textPrimary }]}>
                      {fmtSessionMin(s)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* Log Events */}
        <Card palette={palette} padding="md">
          <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>
            LOG EVENTS ({events.length})
          </Text>
          {events.length === 0 ? (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              No log events recorded on this day.
            </Text>
          ) : (
            <View style={styles.listGap}>
              {events.map((e) => {
                const ref =
                  (e.taskInstanceId && titles[e.taskInstanceId]) ||
                  (e.templateId && titles[e.templateId]) ||
                  null;
                return (
                  <View
                    key={e.id}
                    style={[
                      styles.infoRow,
                      {
                        backgroundColor: palette.bgElevated,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <Text style={[styles.metaMono, { color: palette.textMuted }]}>
                      {fmtLocalTime(e.tsUtc)}
                    </Text>
                    <Text
                      style={[
                        styles.taskTitle,
                        { color: palette.textPrimary, flex: 1 },
                      ]}
                      numberOfLines={1}
                    >
                      {e.eventType.replace(/_/g, ' ').toUpperCase()}
                      {ref ? ` · ${ref}` : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      </ScrollView>

      <AddTaskSheet
        visible={addTaskOpen}
        defaultDate={dayStr}
        onClose={() => {
          setAddTaskOpen(false);
          void loadDay();
        }}
      />

      <Sheet
        visible={movingTask !== null}
        onClose={() => setMovingTask(null)}
        palette={palette}
        title="Move Task to Day"
      >
        {movingTask ? (
          <View style={styles.moveSheetBody}>
            <Text
              style={[styles.taskTitle, { color: palette.textPrimary }]}
              numberOfLines={2}
            >
              {movingTask.title}
            </Text>
            <View style={styles.listGap}>
              {moveOptions.map((opt) => (
                <PressableScale
                  key={opt.label}
                  onPress={() => void handleMoveTaskToDate(opt.date)}
                  style={[
                    styles.moveOptionRow,
                    {
                      backgroundColor: palette.bgElevated,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <View style={styles.moveOptionLeft}>
                    <CalendarIcon size={16} color={palette.textSecondary} />
                    <Text style={[styles.taskTitle, { color: palette.textPrimary }]}>
                      {opt.label}
                    </Text>
                  </View>
                  <Text style={[styles.metaMono, { color: palette.textMuted }]}>
                    {opt.sub}
                  </Text>
                </PressableScale>
              ))}
            </View>
          </View>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    ...type.label,
    marginBottom: 2,
  },
  content: {
    padding: space.base,
    gap: space.md,
    paddingBottom: space['3xl'],
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryRightVal: {
    ...type.mono,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  sectionTitle: {
    ...type.label,
    marginBottom: space.sm,
  },
  hintText: {
    ...type.label,
    fontSize: 9,
    marginBottom: space.sm,
  },
  listGap: {
    gap: space.sm,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    minHeight: 58,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTitle: {
    ...type.body,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  metaMono: {
    ...type.monoSm,
  },
  iconAction: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    ...type.bodySm,
    paddingVertical: space.sm,
  },
  moveSheetBody: {
    gap: space.md,
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
});
