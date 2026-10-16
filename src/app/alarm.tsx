import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { BellRing, Check, Clock, SkipForward, Sparkles } from 'lucide-react-native';
import { useDb } from '../db/useDb';
import { useUiStore } from '../state/ui';
import { useTasksStore } from '../state/tasks';
import {
  applyAlarmAction,
  clearActiveAlarmInstanceId,
  getInstance,
  startAttentionLoop,
  stopAttentionLoop,
  type AlarmAction,
} from '../notifications';
import { categoryName } from '../stats/queries';
import type { TaskInstance } from '../db/types';
import { dark, light, radius, space, type } from '../theme/tokens';
import { MetallicText } from '../components/MetallicText';
import { Card } from '../components/Card';
import { PressableScale } from '../components/PressableScale';
import { haptics } from '../haptics';

function formatNowClock(format: '12h' | '24h'): string {
  const now = new Date();
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  if (format === '24h') {
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h12}:${m} ${period}`;
}

export default function FullScreenAlarmScreen() {
  const { instanceId } = useLocalSearchParams<{ instanceId?: string }>();
  const db = useDb();
  const router = useRouter();
  const theme = useUiStore((s) => s.theme);
  const snoozeMin = useUiStore((s) => s.snoozeMin);
  const clockFormat = useUiStore((s) => s.clockFormat);
  const refreshTasks = useTasksStore((s) => s.refresh);
  const palette = theme === 'light' ? light : dark;

  const [instance, setInstance] = useState<TaskInstance | null>(null);
  const [catLabel, setCats] = useState<string>('General');
  const [nowClock, setNowClock] = useState(() => formatNowClock(clockFormat));
  const [acting, setActing] = useState(false);

  // Subtle linear/eased pulse for the alarm beacon ring (zero bounce)
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) }),
      -1,
      true
    );
    startAttentionLoop();
    const timer = setInterval(() => {
      setNowClock(formatNowClock(clockFormat));
    }, 1000);
    return () => {
      clearInterval(timer);
      stopAttentionLoop();
      clearActiveAlarmInstanceId();
    };
  }, [clockFormat, pulse]);

  useEffect(() => {
    if (!instanceId) return;
    void (async () => {
      const [inst, cMap] = await Promise.all([
        getInstance(db, instanceId),
        categoryName(db),
      ]);
      setInstance(inst);
      if (inst?.categoryId && cMap[inst.categoryId]) {
        setCats(cMap[inst.categoryId]);
      }
    })();
  }, [db, instanceId]);

  const pulseRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.14 }],
    opacity: 0.35 - pulse.value * 0.22,
  }));

  const handleAction = async (action: AlarmAction) => {
    if (acting) return;
    setActing(true);
    stopAttentionLoop();
    clearActiveAlarmInstanceId();

    if (action === 'done') haptics.success();
    else if (action === 'snooze') haptics.medium();
    else haptics.light();

    try {
      if (instanceId) {
        await applyAlarmAction(db, instanceId, action);
        await refreshTasks();
      }
    } finally {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg }]}>
      <View style={styles.container}>
        {/* Top Alarm Status Pill */}
        <View style={styles.topSection}>
          <View style={styles.beaconWrap}>
            <Animated.View
              style={[
                styles.pulseRing,
                { borderColor: palette.textPrimary },
                pulseRingStyle,
              ]}
            />
            <View
              style={[
                styles.beaconCircle,
                {
                  backgroundColor: palette.bgElevated,
                  borderColor: palette.borderStrong,
                },
              ]}
            >
              <BellRing size={28} color={palette.textPrimary} strokeWidth={2} />
            </View>
          </View>

          <Text style={[styles.eyebrow, { color: palette.textSecondary }]}>
            TASK ALARM ACTIVE
          </Text>

          <MetallicText variant="hero" palette={palette} numberOfLines={1}>
            {instance?.alarmTime ?? nowClock}
          </MetallicText>

          <Text style={[styles.subClock, { color: palette.textMuted }]}>
            LIVE TIME · {nowClock}
          </Text>
        </View>

        {/* Task Details Card */}
        <Card palette={palette} variant="elevated" padding="lg">
          <View style={styles.cardInner}>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.tagPill,
                  {
                    backgroundColor: palette.bgSurface,
                    borderColor: palette.borderStrong,
                  },
                ]}
              >
                <Text style={[styles.tagText, { color: palette.textPrimary }]}>
                  {catLabel.toUpperCase()}
                </Text>
              </View>

              {instance?.durationMin ? (
                <View
                  style={[
                    styles.tagPill,
                    {
                      backgroundColor: palette.bgSurface,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <Clock size={12} color={palette.textSecondary} />
                  <Text
                    style={[styles.tagText, { color: palette.textSecondary }]}
                  >
                    {instance.durationMin}M
                  </Text>
                </View>
              ) : null}

              {instance?.isRitual ? (
                <View
                  style={[
                    styles.tagPill,
                    {
                      backgroundColor: palette.bgSurface,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <Sparkles size={12} color={palette.textSecondary} />
                  <Text
                    style={[styles.tagText, { color: palette.textSecondary }]}
                  >
                    RITUAL
                  </Text>
                </View>
              ) : null}
            </View>

            <Text
              style={[styles.taskTitle, { color: palette.textPrimary }]}
              numberOfLines={3}
            >
              {instance?.title ?? 'Scheduled Task'}
            </Text>
          </View>
        </Card>

        {/* Big Action Buttons: Done / Snooze / Skip */}
        <View style={styles.actionsCol}>
          <PressableScale
            onPress={() => void handleAction('done')}
            disabled={acting}
            accessibilityRole="button"
            accessibilityLabel="Mark task Done"
            style={[
              styles.bigPrimaryBtn,
              {
                backgroundColor: palette.textPrimary,
                borderColor: palette.textPrimary,
              },
            ]}
          >
            <Check size={24} color={palette.textInverse} strokeWidth={3} />
            <Text style={[styles.bigPrimaryText, { color: palette.textInverse }]}>
              DONE
            </Text>
          </PressableScale>

          <View style={styles.secondaryRow}>
            <PressableScale
              onPress={() => void handleAction('snooze')}
              disabled={acting}
              accessibilityRole="button"
              accessibilityLabel={`Snooze for ${snoozeMin} minutes`}
              style={[
                styles.bigSecondaryBtn,
                {
                  backgroundColor: palette.bgElevated,
                  borderColor: palette.borderStrong,
                },
              ]}
            >
              <Clock size={18} color={palette.textPrimary} />
              <Text
                style={[styles.bigSecondaryText, { color: palette.textPrimary }]}
              >
                SNOOZE +{snoozeMin}M
              </Text>
            </PressableScale>

            <PressableScale
              onPress={() => void handleAction('skip')}
              disabled={acting}
              accessibilityRole="button"
              accessibilityLabel="Skip task"
              style={[
                styles.bigSecondaryBtn,
                {
                  backgroundColor: palette.bgSurface,
                  borderColor: palette.border,
                },
              ]}
            >
              <SkipForward size={18} color={palette.textSecondary} />
              <Text
                style={[
                  styles.bigSecondaryText,
                  { color: palette.textSecondary },
                ]}
              >
                SKIP
              </Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingVertical: space.xl,
    justifyContent: 'space-between',
  },
  topSection: {
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
  },
  beaconWrap: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  pulseRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
  },
  beaconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    ...type.label,
    letterSpacing: 2,
  },
  subClock: {
    ...type.monoSm,
  },
  cardInner: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.xs,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagText: {
    ...type.monoSm,
    fontSize: 10,
    fontWeight: '700',
  },
  taskTitle: {
    ...type.h1,
    textAlign: 'center',
  },
  actionsCol: {
    gap: space.md,
    marginBottom: space.md,
  },
  bigPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 68,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  bigPrimaryText: {
    ...type.h2,
    letterSpacing: 1.5,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  bigSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 60,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.sm,
  },
  bigSecondaryText: {
    ...type.mono,
    fontWeight: '700',
  },
});
