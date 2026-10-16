import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCcw,
  Search,
} from 'lucide-react-native';
import { useDb } from '../../db/useDb';
import { getLogEvents, logEvent } from '../../db/log';
import { useUiStore } from '../../state/ui';
import { dark, hitSlop12, hitSlop8, light, radius, space, type } from '../../theme/tokens';
import { titlesForEvents } from '../../stats/queries';
import { addDays, localDateString } from '../../db/time';
import type { LogEvent, LogEventType } from '../../db/types';
import { Skeleton } from '../../components/Skeleton';
import { PressableScale } from '../../components/PressableScale';
import { MetallicText } from '../../components/MetallicText';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { FAB_CLEARANCE } from '../../components/Fab';
import { haptics } from '../../haptics';

/** Primary accent — matches the Today page (migration from amber to purple). */
const PURPLE = '#8B5CF6';

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
  const router = useRouter();
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
      evts.reverse();
      setEvents(evts);
      setTitles(await titlesForEvents(db, evts));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [db, day, typeFilter]);

  useFocusEffect(
    useCallback(() => {
      void load();
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

  const shiftDay = (delta: number) => {
    haptics.selection();
    setDay((d) => addDays(d, delta));
  };

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
            task_instance_id: e.taskInstanceId,
            template_id: e.templateId,
            timer_session_id: e.timerSessionId,
            title:
              titles[e.taskInstanceId ?? ''] ??
              titles[e.templateId ?? ''] ??
              null,
            payload: e.payload,
          })),
          null,
          2
        );
      } else {
        const header =
          'id,ts_utc,ts_offset_min,event_type,actor,task_instance_id,template_id,timer_session_id,title,payload';
        const rows = visible.map((e) => {
          const title =
            titles[e.taskInstanceId ?? ''] ?? titles[e.templateId ?? ''] ?? '';
          return [
            String(e.id),
            e.tsUtc,
            String(e.tsOffsetMin),
            e.eventType,
            e.actor,
            e.taskInstanceId ?? '',
            e.templateId ?? '',
            e.timerSessionId ?? '',
            title,
            e.payload ? JSON.stringify(e.payload) : '',
          ]
            .map(csvEscape)
            .join(',');
        });
        content = [header, ...rows].join('\n');
      }

      const filename = `checkoff-log-${day}.${format}`;
      const file = new File(Paths.cache, filename);
      if (file.exists) file.delete();
      file.create();
      file.write(content);

      await logEvent(db, {
        eventType: 'exported',
        payload: { format, day, filter: typeFilter, count: visible.length },
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: format === 'json' ? 'application/json' : 'text/csv',
          dialogTitle: `Export CheckOff Log (${day})`,
        });
      } else {
        Alert.alert('Export saved', file.uri);
      }
      await load();
    } catch (err) {
      Alert.alert('Export failed', String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: p.bg }]}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <PressableScale
          onPress={() => router.push('/(tabs)/settings')}
          hitSlop={hitSlop12}
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
          style={[
            styles.backBtn,
            { backgroundColor: p.bgSurface, borderColor: p.border },
          ]}
        >
          <ArrowLeft size={18} color={p.textPrimary} />
        </PressableScale>

        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: p.textMuted }]}>
            IMMUTABLE LEDGER
          </Text>
          <MetallicText variant="h2" palette={p} numberOfLines={1}>
            Event Logs
          </MetallicText>
          <Text style={[styles.headerSub, { color: p.textSecondary }]} numberOfLines={2}>
            Every state transition, preserved in order.
          </Text>
        </View>

        <View style={styles.exportBtns}>
          <Button
            label="JSON"
            size="sm"
            variant="secondary"
            icon={<Download size={13} color={p.textPrimary} />}
            disabled={exporting || visible.length === 0}
            onPress={() => void exportLog('json')}
          />
          <Button
            label="CSV"
            size="sm"
            variant="secondary"
            icon={<Download size={13} color={p.textPrimary} />}
            disabled={exporting || visible.length === 0}
            onPress={() => void exportLog('csv')}
          />
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controlsWrap}>
        <Card palette={p} padding="sm">
          <View style={styles.dayBar}>
            <PressableScale
              onPress={() => shiftDay(-1)}
              hitSlop={hitSlop12}
              style={[
                styles.stepBtn,
                { backgroundColor: p.bgElevated, borderColor: p.border },
              ]}
            >
              <ChevronLeft size={16} color={p.textPrimary} />
            </PressableScale>

            <View style={{ alignItems: 'center' }}>
              <Text style={[styles.dayLabel, { color: p.textPrimary }]}>
                {day}
              </Text>
              <Text style={[styles.countSub, { color: p.textMuted }]}>
                {visible.length} EVENTS
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 6 }}>
              {day !== today ? (
                <PressableScale
                  onPress={() => {
                    haptics.selection();
                    setDay(today);
                  }}
                  hitSlop={hitSlop8}
                  style={[
                    styles.stepBtn,
                    { backgroundColor: p.bgElevated, borderColor: p.border },
                  ]}
                >
                  <RotateCcw size={14} color={p.textPrimary} />
                </PressableScale>
              ) : null}
              <PressableScale
                onPress={() => shiftDay(1)}
                hitSlop={hitSlop12}
                style={[
                  styles.stepBtn,
                  { backgroundColor: p.bgElevated, borderColor: p.border },
                ]}
              >
                <ChevronRight size={16} color={p.textPrimary} />
              </PressableScale>
            </View>
          </View>
        </Card>

        {/* Search Input */}
        <View
          style={[
            styles.searchBox,
            { backgroundColor: p.bgSurface, borderColor: p.border },
          ]}
        >
          <Search size={16} color={p.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Filter by task title, event type, or actor..."
            placeholderTextColor={p.textMuted}
            style={[styles.searchInput, { color: p.textPrimary }]}
          />
        </View>

        {/* Event Type Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {TYPE_FILTERS.map((tf) => {
            const active = typeFilter === tf;
            return (
              <PressableScale
                key={tf}
                onPress={() => {
                  haptics.selection();
                  setTypeFilter(tf);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? PURPLE : p.bgSurface,
                    borderColor: active ? PURPLE : p.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? '#FFFFFF' : p.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {tf.replace(/_/g, ' ').toUpperCase()}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      {/* Event List */}
      {loading ? (
        <View style={styles.listPad}>
          <Skeleton height={74} borderRadius={radius.md} />
          <Skeleton height={74} borderRadius={radius.md} />
          <Skeleton height={74} borderRadius={radius.md} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.listPad,
            { paddingBottom: FAB_CLEARANCE },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={[styles.emptyTitle, { color: p.textSecondary }]}>
                No log events match your filter
              </Text>
              <Text style={[styles.emptySub, { color: p.textMuted }]}>
                Every task creation, completion, alarm trigger, and timer session is recorded here.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const refTitle =
              titles[item.taskInstanceId ?? ''] ??
              titles[item.templateId ?? ''] ??
              null;
            return (
              <View
                style={[
                  styles.logRow,
                  { backgroundColor: p.bgSurface, borderColor: p.border },
                ]}
              >
                <View style={styles.logTopRow}>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: p.bgElevated, borderColor: p.borderStrong },
                    ]}
                  >
                    <Text style={[styles.badgeText, { color: p.textPrimary }]}>
                      {item.eventType.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.clockText, { color: p.textMuted }]}>
                    {eventClock(item.tsUtc, item.tsOffsetMin)}
                  </Text>
                </View>

                {refTitle ? (
                  <Text
                    style={[styles.refTitle, { color: p.textPrimary }]}
                    numberOfLines={1}
                  >
                    {refTitle}
                  </Text>
                ) : null}

                <Text
                  style={[styles.payloadText, { color: p.textSecondary }]}
                  numberOfLines={2}
                >
                  {payloadSummary(item.payload)}
                </Text>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    paddingTop: space.md,
    paddingBottom: space.sm,
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
  headerSub: {
    ...type.caption,
    marginTop: 2,
  },
  exportBtns: {
    flexDirection: 'row',
    gap: 6,
  },
  controlsWrap: {
    paddingHorizontal: space.base,
    gap: space.sm,
    marginBottom: space.sm,
  },
  dayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayLabel: {
    ...type.mono,
    fontSize: 15,
  },
  countSub: {
    ...type.label,
    fontSize: 9,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    ...type.bodySm,
    flex: 1,
    paddingVertical: 8,
  },
  chipsScroll: {
    gap: 6,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: space.md,
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    ...type.caption,
    fontSize: 10,
    fontWeight: '700',
  },
  listPad: {
    paddingHorizontal: space.base,
    gap: space.sm,
  },
  logRow: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  logTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    ...type.monoSm,
    fontSize: 10,
    fontWeight: '700',
  },
  clockText: {
    ...type.monoSm,
    fontSize: 11,
  },
  refTitle: {
    ...type.bodySm,
    fontWeight: '700',
    marginTop: 2,
  },
  payloadText: {
    ...type.monoSm,
    fontSize: 11,
  },
  emptyBox: {
    paddingVertical: space.xl,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    ...type.body,
    fontWeight: '600',
  },
  emptySub: {
    ...type.caption,
    textAlign: 'center',
  },
});
