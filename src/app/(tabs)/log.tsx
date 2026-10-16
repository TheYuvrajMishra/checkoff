import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useDb } from '../../db/useDb';
import { getLogEvents, logEvent } from '../../db/log';
import { useUiStore } from '../../state/ui';
import { dark, light, radius, space, TAP, type } from '../../theme/tokens';
import { titlesForEvents } from '../../stats/queries';
import { addDays, localDateString } from '../../db/time';
import type { LogEvent, LogEventType } from '../../db/types';

const TYPE_FILTERS: ('all' | LogEventType)[] = [
  'all',
  'created',
  'scheduled',
  'alarm_fired',
  'started',
  'paused',
  'resumed',
  'completed',
  'unchecked',
  'skipped',
  'missed',
  'timer_session_started',
  'timer_session_ended',
  'edited',
  'deleted',
  'override',
  'exported',
  'streak_milestone',
];

const PAGE_LIMIT = 1000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** "21:04:33 UTC+05:30" — device-local clock at event time + original offset. */
function eventClock(tsUtc: string, offsetMin: number): string {
  const d = new Date(new Date(tsUtc).getTime() + offsetMin * 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ` +
    `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function payloadSummary(payload: Record<string, unknown> | null): string {
  if (!payload) return '—';
  const s = JSON.stringify(payload);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

function csvEscape(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export default function LogScreen() {
  const db = useDb();
  const themeName = useUiStore((s) => s.theme);
  const p = themeName === 'light' ? light : dark;

  const today = localDateString();
  const [day, setDay] = useState(today);
  const [typeFilter, setTypeFilter] = useState<'all' | LogEventType>('all');
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const evts = await getLogEvents(db, {
        day,
        eventTypes: typeFilter === 'all' ? undefined : [typeFilter],
        limit: PAGE_LIMIT,
      });
      evts.reverse(); // newest first
      setEvents(evts);
      setTitles(await titlesForEvents(db, evts));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [db, day, typeFilter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      const title =
        titles[e.taskInstanceId ?? ''] ?? titles[e.templateId ?? ''] ?? '';
      return (
        title.toLowerCase().includes(q) ||
        e.eventType.includes(q) ||
        e.actor.includes(q) ||
        (e.timerSessionId ?? '').toLowerCase().includes(q)
      );
    });
  }, [events, titles, search]);

  const shiftDay = (delta: number) => setDay((d) => addDays(d, delta));

  const exportLog = async (format: 'json' | 'csv') => {
    if (exporting || visible.length === 0) return;
    setExporting(true);
    try {
      let content: string;
      if (format === 'json') {
        content = JSON.stringify(
          visible.map((e) => ({
            id: e.id,
            ts_utc: e.tsUtc,
            ts_offset_min: e.tsOffsetMin,
            event_type: e.eventType,
            actor: e.actor,
            task: titles[e.taskInstanceId ?? ''] ?? titles[e.templateId ?? ''] ?? null,
            task_instance_id: e.taskInstanceId,
            template_id: e.templateId,
            timer_session_id: e.timerSessionId,
            payload: e.payload,
          })),
          null,
          2
        );
      } else {
        const rows = [
          'id,ts_utc,ts_offset_min,event_type,actor,title,task_instance_id,template_id,timer_session_id,payload',
          ...visible.map((e) =>
            [
              String(e.id),
              e.tsUtc,
              String(e.tsOffsetMin),
              e.eventType,
              e.actor,
              titles[e.taskInstanceId ?? ''] ?? titles[e.templateId ?? ''] ?? '',
              e.taskInstanceId ?? '',
              e.templateId ?? '',
              e.timerSessionId ?? '',
              e.payload ? JSON.stringify(e.payload) : '',
            ]
              .map(csvEscape)
              .join(',')
          ),
        ];
        content = rows.join('\n');
      }

      const file = new File(Paths.cache, `checkoff-log-${day}.${format}`);
      file.create({ overwrite: true });
      file.write(content, { encoding: 'utf8' });

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device.');
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: format === 'json' ? 'application/json' : 'text/csv',
        dialogTitle: 'Share CheckOff log export',
      });

      await logEvent(db, {
        eventType: 'exported',
        actor: 'user',
        payload: { format, count: visible.length, day },
      });
      // Refresh so the just-written 'exported' event appears.
      load();
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setExporting(false);
    }
  };

  const renderItem = ({ item }: { item: LogEvent }) => {
    const title =
      titles[item.taskInstanceId ?? ''] ?? titles[item.templateId ?? ''] ?? '—';
    return (
      <View style={[styles.row, { backgroundColor: p.surface, borderColor: p.border }]}>
        <Text style={[styles.time, { color: p.textDim }]}>
          {eventClock(item.tsUtc, item.tsOffsetMin)}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.chip, { backgroundColor: p.surface2, color: p.text }]}>
            {item.eventType}
          </Text>
          <Text style={[styles.actor, { color: p.textFaint }]}>{item.actor}</Text>
        </View>
        <Text style={[styles.title, { color: p.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.payload, { color: p.textFaint }]} numberOfLines={1}>
          {payloadSummary(item.payload)}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: p.bg }]}>
      {/* Day pager */}
      <View style={styles.pager}>
        <Pressable
          accessibilityLabel="Previous day"
          onPress={() => shiftDay(-1)}
          style={[styles.pagerBtn, { borderColor: p.border }]}
          hitSlop={8}
        >
          <Text style={[styles.pagerGlyph, { color: p.text }]}>‹</Text>
        </Pressable>
        <Pressable onPress={() => setDay(today)} hitSlop={8}>
          <Text style={[styles.dayLabel, { color: p.text }]}>
            {day === today ? 'Today' : day}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Next day"
          onPress={() => shiftDay(1)}
          disabled={day >= today}
          style={[styles.pagerBtn, { borderColor: p.border, opacity: day >= today ? 0.3 : 1 }]}
          hitSlop={8}
        >
          <Text style={[styles.pagerGlyph, { color: p.text }]}>›</Text>
        </Pressable>
      </View>

      {/* Export */}
      <View style={styles.exportRow}>
        <Pressable
          accessibilityLabel="Export as JSON"
          onPress={() => exportLog('json')}
          disabled={exporting || visible.length === 0}
          style={[
            styles.exportBtn,
            { borderColor: p.border, opacity: exporting || visible.length === 0 ? 0.4 : 1 },
          ]}
        >
          <Text style={[styles.exportLabel, { color: p.text }]}>JSON</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Export as CSV"
          onPress={() => exportLog('csv')}
          disabled={exporting || visible.length === 0}
          style={[
            styles.exportBtn,
            { borderColor: p.border, opacity: exporting || visible.length === 0 ? 0.4 : 1 },
          ]}
        >
          <Text style={[styles.exportLabel, { color: p.text }]}>CSV</Text>
        </Pressable>
        <Text style={[styles.exportHint, { color: p.textFaint }]}>
          {exporting ? 'Preparing…' : `${visible.length} events`}
        </Text>
      </View>

      {/* Type filter chips */}
      <FlatList
        data={TYPE_FILTERS}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(t) => t}
        contentContainerStyle={styles.chips}
        renderItem={({ item: t }) => {
          const active = typeFilter === t;
          return (
            <Pressable
              onPress={() => setTypeFilter(t)}
              style={[
                styles.typeChip,
                {
                  backgroundColor: active ? p.accentDim : p.surface,
                  borderColor: active ? p.accent : p.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.typeChipText,
                  { color: active ? p.accent : p.textDim },
                ]}
              >
                {t}
              </Text>
            </Pressable>
          );
        }}
      />

      {/* Task search */}
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Filter by task…"
        placeholderTextColor={p.textFaint}
        style={[
          styles.search,
          { backgroundColor: p.surface, borderColor: p.border, color: p.text },
        ]}
      />

      {/* Events */}
      {loading ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[styles.row, styles.skeleton, { backgroundColor: p.surface }]}
            />
          ))}
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(e) => String(e.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: p.text }]}>
                Nothing recorded this day.
              </Text>
              <Text style={[styles.emptyBody, { color: p.textFaint }]}>
                Every check, skip, alarm and timer lands here — the full trail of the day.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space(2) },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space(1),
  },
  pagerBtn: {
    width: TAP,
    height: TAP,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerGlyph: { fontSize: 26, lineHeight: 30, fontWeight: '600' },
  dayLabel: { ...type.h2 },
  exportRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space(1) },
  exportBtn: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space(2),
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space(1),
  },
  exportLabel: { ...type.caption, textTransform: 'uppercase' },
  exportHint: { ...type.small, marginLeft: 'auto' },
  chips: { paddingVertical: space(1), gap: space(1) },
  typeChip: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space(2),
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space(1),
  },
  typeChipText: { ...type.small, fontWeight: '500' },
  search: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    height: TAP,
    ...type.body,
    marginBottom: space(1),
  },
  list: { paddingBottom: space(3), gap: space(1) },
  row: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space(2),
  },
  skeleton: { height: 96, opacity: 0.5 },
  time: { ...type.mono },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: space(1) },
  chip: {
    ...type.caption,
    textTransform: 'uppercase',
    paddingHorizontal: space(1),
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  actor: { ...type.caption, marginLeft: space(1) },
  title: { ...type.body, marginTop: space(1) },
  payload: { ...type.small, marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: space(6), paddingHorizontal: space(4) },
  emptyTitle: { ...type.h3, marginBottom: space(1) },
  emptyBody: { ...type.body, textAlign: 'center' },
});
