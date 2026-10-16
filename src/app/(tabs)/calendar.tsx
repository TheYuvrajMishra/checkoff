import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { CalendarPlus } from 'lucide-react-native';
import { useDb } from '../../db/useDb';
import { useUiStore } from '../../state/ui';
import { dark, light, radius, space, TAP, type } from '../../theme/tokens';
import { AddTaskSheet } from '../../components/AddTaskSheet';
import { EmptyState } from '../../components/EmptyState';
import { Fab } from '../../components/Fab';
import { daySummary, monthSummary, type MonthSummary } from '../../stats/queries';
import { addDays, localDateString } from '../../db/time';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** #RRGGBB + alpha → rgba() string. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface SelectedInfo {
  done: number;
  total: number;
  ritualsDone: number;
  ritualsTotal: number;
}

export default function CalendarScreen() {
  const db = useDb();
  const themeName = useUiStore((s) => s.theme);
  const p = themeName === 'light' ? light : dark;

  const today = localDateString();
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth()); // 0..11
  const [selected, setSelected] = useState(today);
  const [summary, setSummary] = useState<MonthSummary>({});
  const [selectedInfo, setSelectedInfo] = useState<SelectedInfo | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      monthSummary(db, viewYear, viewMonth + 1),
      daySummary(db, selected),
    ]);
    setSummary(m);
    setSelectedInfo(s);
  }, [db, viewYear, viewMonth, selected]);

  const handleTaskAdded = useCallback(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leading = new Date(viewYear, viewMonth, 1).getDay();
  const cells: (string | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const pick = (date: string) => {
    setSelected(date);
    router.push(`/day/${date}`);
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: p.bg }]}>
      {/* Month navigation */}
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Previous month"
          onPress={() => shiftMonth(-1)}
          style={[styles.navBtn, { borderColor: p.border }]}
          hitSlop={8}
        >
          <Text style={[styles.navGlyph, { color: p.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: p.text }]}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </Text>
        <Pressable
          accessibilityLabel="Next month"
          onPress={() => shiftMonth(1)}
          style={[styles.navBtn, { borderColor: p.border }]}
          hitSlop={8}
        >
          <Text style={[styles.navGlyph, { color: p.text }]}>›</Text>
        </Pressable>
      </View>

      {/* Weekday header */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={[styles.weekday, { color: p.textFaint }]}>
            {w}
          </Text>
        ))}
      </View>

      {/* Day grid */}
      <View>
        {Array.from({ length: cells.length / 7 }, (_, week) => (
          <View key={week} style={styles.weekRow}>
            {cells.slice(week * 7, week * 7 + 7).map((date, i) => {
              if (!date) return <View key={i} style={styles.cell} />;
              const info = summary[date];
              const done = info?.done ?? 0;
              const total = info?.total ?? 0;
              const intensity = total > 0 ? done / total : 0;
              const isToday = date === today;
              const isSelected = date === selected;
              const isFuture = date > today;
              const dayNum = Number(date.slice(8, 10));
              return (
                <Pressable
                  key={date}
                  accessibilityLabel={`${date}, ${done} of ${total} done`}
                  onPress={() => pick(date)}
                  style={[
                    styles.cell,
                    {
                      backgroundColor:
                        intensity > 0 ? hexToRgba(p.accent, 0.1 + 0.5 * intensity) : 'transparent',
                      borderColor: isSelected ? p.accent : isToday ? p.accent : 'transparent',
                      borderWidth: isSelected || isToday ? 1.5 : 0,
                      opacity: isFuture ? 0.45 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      { color: intensity === 1 ? p.accent : p.text, fontWeight: isToday ? '700' : '500' },
                    ]}
                  >
                    {dayNum}
                  </Text>
                  {total > 0 && (
                    <Text style={[styles.fraction, { color: p.textDim }]}>
                      {done}/{total}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {/* Selected-day summary */}
      <View style={[styles.summaryCard, { backgroundColor: p.surface, borderColor: p.border }]}>
        {selectedInfo ? (
          selectedInfo.total === 0 ? (
            <EmptyState
              icon={CalendarPlus}
              title="No tasks for this day"
              subtitle={`${selected} is clear. Add your first task to plan it.`}
              actionLabel="Add your first task"
              onAction={() => setAddSheetOpen(true)}
            />
          ) : (
            <Text style={[styles.summaryText, { color: p.textDim }]}>
              {selected} — {selectedInfo.done}/{selectedInfo.total} done
              {selectedInfo.ritualsTotal > 0 &&
                ` · rituals ${selectedInfo.ritualsDone}/${selectedInfo.ritualsTotal}`}
            </Text>
          )
        ) : (
          <Text style={[styles.summaryText, { color: p.textFaint }]}>Loading…</Text>
        )}
        <Text style={[styles.hint, { color: p.textFaint }]}>
          {selected === addDays(today, 1) || selected > today
            ? 'Future day — tap to plan ahead.'
            : 'Tap any day to open its detail.'}
        </Text>
      </View>
      <Fab onPress={() => setAddSheetOpen(true)} />
      <AddTaskSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        initialDate={selected}
        onAdded={handleTaskAdded}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space(2), paddingBottom: 128 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space(1),
  },
  navBtn: {
    width: TAP,
    height: TAP,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navGlyph: { fontSize: 26, lineHeight: 30, fontWeight: '600' },
  title: { ...type.h1 },
  weekRow: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: space(1),
    ...type.caption,
    textTransform: 'uppercase',
  },
  cell: {
    flex: 1,
    height: TAP,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 1,
  },
  dayNum: { fontSize: type.body.fontSize, lineHeight: 20 },
  fraction: { fontSize: type.caption.fontSize, lineHeight: 14 },
  summaryCard: {
    marginTop: space(2),
    padding: space(2),
    borderWidth: 1,
    borderRadius: radius.md,
  },
  summaryText: { ...type.body },
  hint: { ...type.small, marginTop: space(1) },
});
