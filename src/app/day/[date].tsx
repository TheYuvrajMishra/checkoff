import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../db/useDb';
import { getLogEvents } from '../../db/log';
import { useUiStore } from '../../state/ui';
import { categoryColor, dark, light, radius, space, TAP, type } from '../../theme/tokens';
import { categoryMeta, instancesInRange, sessionsInRange } from '../../stats/queries';
import { formatEventTime, localDateString, localWeekdayIndex } from '../../db/time';
import type { LogEvent, TaskInstance, TimerSession } from '../../db/types';

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const STATUS_COLORS: Record<TaskInstance['status'], (p: typeof dark) => string> = {
  done: (p) => p.success,
  missed: (p) => p.danger,
  skipped: (p) => p.textFaint,
  pending: (p) => p.warn,
};

function localDayStartUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
}
function localDayEndUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function sessionMinutes(s: TimerSession): number | null {
  if (!s.endedAtUtc) return null;
  const start = new Date(s.startedAtUtc).getTime();
  const end = new Date(s.endedAtUtc).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / 60000;
}

interface DayData {
  instances: TaskInstance[];
  sessions: TimerSession[];
  events: LogEvent[];
  catMeta: Record<string, { name: string; colorToken: string }>;
}

export default function DayScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const db = useDb();
  const themeName = useUiStore((s) => s.theme);
  const p = themeName === 'light' ? light : dark;

  const valid = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const [data, setData] = useState<DayData | null>(null);

  const load = useCallback(async () => {
    if (!valid || !date) return;
    const [instances, allSessions, events, catMeta] = await Promise.all([
      instancesInRange(db, date, date),
      sessionsInRange(db, localDayStartUtc(date), localDayEndUtc(date)),
      getLogEvents(db, { day: date }),
      categoryMeta(db),
    ]);
    // Keep sessions whose *local* start day is this date (UTC window covers edges).
    const sessions = allSessions.filter(
      (s) => localDateString(new Date(s.startedAtUtc)) === date
    );
    setData({ instances, sessions, events, catMeta });
  }, [db, date, valid]);

  useFocusEffect(
    useCallback(() => {
      setData(null);
      load();
    }, [load])
  );

  if (!valid || !date) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: p.bg }]}>
        <View style={styles.center}>
          <Text style={[styles.title, { color: p.text }]}>Invalid date</Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { borderColor: p.border }]}
          >
            <Text style={[styles.backLabel, { color: p.text }]}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const weekday = WEEKDAY_NAMES[localWeekdayIndex(new Date(date + 'T12:00:00'))];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={[styles.backBtn, { borderColor: p.border }]}
            hitSlop={8}
          >
            <Text style={[styles.backGlyph, { color: p.text }]}>‹</Text>
          </Pressable>
          <View>
            <Text style={[styles.title, { color: p.text }]}>{date}</Text>
            <Text style={[styles.subtitle, { color: p.textFaint }]}>{weekday}</Text>
          </View>
        </View>

        {data === null ? (
          <>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.card, styles.skeleton, { backgroundColor: p.surface }]} />
            ))}
          </>
        ) : (
          <>
            {/* Tasks */}
            <Text style={[styles.section, { color: p.textFaint }]}>Tasks</Text>
            {data.instances.length === 0 ? (
              <View style={[styles.card, { backgroundColor: p.surface }]}>
                <Text style={[styles.calm, { color: p.textDim }]}>
                  Nothing scheduled this day.
                </Text>
              </View>
            ) : (
              data.instances.map((i) => {
                const meta = i.categoryId ? data.catMeta[i.categoryId] : undefined;
                return (
                  <View
                    key={i.id}
                    style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}
                  >
                    <View style={styles.taskTop}>
                      <Text
                        style={[styles.statusChip, { color: STATUS_COLORS[i.status](p) }]}
                      >
                        {i.status.toUpperCase()}
                      </Text>
                      {i.isRitual && (
                        <Text style={[styles.ritualTag, { color: p.accent }]}>RITUAL</Text>
                      )}
                    </View>
                    <Text style={[styles.taskTitle, { color: p.text }]}>{i.title}</Text>
                    <View style={styles.taskMeta}>
                      {meta && (
                        <View style={styles.catRow}>
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: categoryColor(meta.colorToken) },
                            ]}
                          />
                          <Text style={[styles.metaText, { color: p.textDim }]}>{meta.name}</Text>
                        </View>
                      )}
                      <Text style={[styles.metaText, { color: p.textDim }]}>
                        {i.durationMin} min
                      </Text>
                      {i.alarmTime && (
                        <Text style={[styles.metaText, { color: p.textDim }]}>
                          alarm {i.alarmTime}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })
            )}

            {/* Timers */}
            <Text style={[styles.section, { color: p.textFaint }]}>Timers</Text>
            {data.sessions.length === 0 ? (
              <View style={[styles.card, { backgroundColor: p.surface }]}>
                <Text style={[styles.calm, { color: p.textDim }]}>
                  No timer sessions this day.
                </Text>
              </View>
            ) : (
              data.sessions.map((s) => {
                const actual = sessionMinutes(s);
                return (
                  <View
                    key={s.id}
                    style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}
                  >
                    <View style={styles.taskTop}>
                      <Text style={[styles.statusChip, { color: p.textDim }]}>
                        {s.mode.toUpperCase()}
                      </Text>
                      {actual === null && (
                        <Text style={[styles.statusChip, { color: p.warn }]}>RUNNING</Text>
                      )}
                    </View>
                    <Text style={[styles.mono, { color: p.text }]}>
                      {actual === null
                        ? `started ${s.startedAtUtc.slice(11, 16)} UTC`
                        : s.plannedMin != null
                          ? `${Math.round(actual)}m actual / ${s.plannedMin}m planned`
                          : `${Math.round(actual)}m actual`}
                    </Text>
                  </View>
                );
              })
            )}

            {/* Log */}
            <Text style={[styles.section, { color: p.textFaint }]}>Log</Text>
            {data.events.length === 0 ? (
              <View style={[styles.card, { backgroundColor: p.surface }]}>
                <Text style={[styles.calm, { color: p.textDim }]}>
                  No events recorded this day.
                </Text>
              </View>
            ) : (
              data.events.map((e) => (
                <View
                  key={e.id}
                  style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}
                >
                  <Text style={[styles.mono, { color: p.textDim }]}>
                    {formatEventTime(e.tsUtc, e.tsOffsetMin)}
                  </Text>
                  <Text style={[styles.logMeta, { color: p.text }]}>
                    {e.eventType} · {e.actor}
                  </Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: space(2), paddingBottom: space(4) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(1) },
  backBtn: {
    width: TAP,
    height: TAP,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space(2),
  },
  backGlyph: { fontSize: 26, lineHeight: 30, fontWeight: '600' },
  backLabel: { ...type.body, fontWeight: '600' },
  title: { ...type.h1 },
  subtitle: { ...type.small },
  section: {
    ...type.caption,
    textTransform: 'uppercase',
    marginTop: space(3),
    marginBottom: space(1),
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space(2),
    marginBottom: space(1),
  },
  skeleton: { height: 96, opacity: 0.5 },
  calm: { ...type.body },
  taskTop: { flexDirection: 'row', alignItems: 'center', marginBottom: space(1) },
  statusChip: { ...type.caption, textTransform: 'uppercase', fontWeight: '700' },
  ritualTag: { ...type.caption, marginLeft: space(1), fontWeight: '700' },
  taskTitle: { ...type.h3, marginBottom: space(1) },
  taskMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  catRow: { flexDirection: 'row', alignItems: 'center', marginRight: space(2) },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: space(1) },
  metaText: { ...type.small, marginRight: space(2) },
  mono: { ...type.mono },
  logMeta: { ...type.small, marginTop: 2 },
});
