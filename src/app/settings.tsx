/**
 * CheckOff — Settings screen.
 *
 * Holds:
 * - Logs (append-only event log with filters & JSON/CSV export)
 * - Theme (Dark / Light / System)
 * - Clock Format (12h / 24h) & Week Start (Monday / Sunday)
 * - Alarm Sound Picker (Pulse / Beacon / Chime / Industrial with live preview)
 * - Grace & Snooze Windows (detent Sliders)
 * - Haptic Intensity (custom Switch + Light / Medium / Strong)
 * - Data Backup / Export (full SQLite JSON dump via Share sheet)
 * - About & Version (with OTA update check)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Appearance,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  ArrowRight,
  Bell,
  Database,
  Download,
  FileText,
  Info,
  Palette,
  RefreshCw,
  ShieldCheck,
  Vibrate,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { useDb } from '../db/useDb';
import { setMeta, META_KEYS } from '../db/repos/meta';
import { logEvent } from '../db/log';
import {
  useUiStore,
  type AlarmSoundId,
  type ClockFormat,
  type HapticIntensity,
  type ThemeMode,
  type WeekStart,
} from '../state/ui';
import { configureHaptics, haptics } from '../haptics';
import { dark, hitSlop8, light, radius, space, type } from '../theme/tokens';
import { updaterActions, useUpdaterStore } from '../updates/updaterStore';
import { PressableScale } from '../components/PressableScale';
import { MetallicText } from '../components/MetallicText';
import { Card } from '../components/Card';
import { Switch } from '../components/Switch';
import { Slider } from '../components/Slider';
import { Button } from '../components/Button';
import { NativeTimeButton } from '../components/TaskForm';
import { FAB_CLEARANCE } from '../components/Fab';
import {
  rescheduleRewardNotifications,
  saveRewardNotifPrefs,
} from '../notifications/rewards';
import pkg from '../../package.json';

const GRACE_DETENTS = [5, 10, 15, 20, 30, 45, 60];
const SNOOZE_DETENTS = [3, 5, 9, 10, 15, 20, 30];
const INTENSITY_OPTIONS: HapticIntensity[] = ['light', 'medium', 'strong'];

const ALARM_SOUNDS: {
  id: AlarmSoundId;
  label: string;
  desc: string;
  rate: number;
}[] = [
  { id: 'pulse', label: 'Pulse', desc: 'Crisp standard digital pulse', rate: 1.0 },
  { id: 'beacon', label: 'Beacon', desc: 'Deep resonant low-frequency alert', rate: 0.8 },
  { id: 'chime', label: 'Chime', desc: 'High-clarity harmonic double chime', rate: 1.25 },
  { id: 'industrial', label: 'Industrial', desc: 'Rapid high-urgency mechanical cadence', rate: 1.5 },
];

/** Card section header: accent icon box + caption label, Today-page style. */
function SectionHeader({
  palette,
  icon,
  label,
}: {
  palette: typeof dark;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <View style={styles.sectionHeaderWrap}>
      <View
        style={[
          styles.sectionIconBox,
          { backgroundColor: palette.accentDim, borderColor: palette.borderStrong },
        ]}
      >
        {icon}
      </View>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.sectionHeadLabel, { color: palette.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const db = useDb();
  const router = useRouter();
  const ui = useUiStore();
  const palette = ui.theme === 'dark' ? dark : light;
  const { phase, checking } = useUpdaterStore();

  const [previewingSound, setPreviewingSound] = useState<AlarmSoundId | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      try {
        playerRef.current?.pause();
        playerRef.current?.remove();
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  const persist = useCallback(
    async (key: string, value: string) => {
      try {
        await setMeta(db, key, value);
      } catch {
        // UI store already updated
      }
    },
    [db]
  );

  const setThemeMode = (mode: ThemeMode) => {
    haptics.selection();
    const sys = Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
    const resolved = mode === 'system' ? sys : mode;
    ui.set({ themeMode: mode, theme: resolved });
    void persist(META_KEYS.theme, mode);
  };

  const setClockFormat = (clockFormat: ClockFormat) => {
    haptics.selection();
    ui.set({ clockFormat });
    void persist('clock_format', clockFormat);
  };

  const setWeekStart = (weekStart: WeekStart) => {
    haptics.selection();
    ui.set({ weekStart });
    void persist('week_start', weekStart);
  };

  const setHapticsEnabled = (enabled: boolean) => {
    ui.set({ hapticsEnabled: enabled });
    configureHaptics({ enabled, intensity: ui.hapticIntensity });
    void persist(META_KEYS.hapticsEnabled, enabled ? '1' : '0');
    if (enabled) void haptics.light();
  };

  const setIntensity = (intensity: HapticIntensity) => {
    ui.set({ hapticIntensity: intensity });
    configureHaptics({ enabled: ui.hapticsEnabled, intensity });
    void persist(META_KEYS.hapticIntensity, intensity);
    void haptics.medium();
  };

  const setGrace = (min: number) => {
    ui.set({ graceMin: min });
    void persist(META_KEYS.graceMin, String(min));
  };

  const setSnooze = (min: number) => {
    ui.set({ snoozeMin: min });
    void persist(META_KEYS.snoozeMin, String(min));
  };

  // --- Reward notification prefs (persisted via notifications/rewards) ---

  const persistRewardPrefs = useCallback(
    async (patch: Parameters<typeof saveRewardNotifPrefs>[1]) => {
      try {
        await saveRewardNotifPrefs(db, patch);
      } catch {
        // UI store already updated
      }
      try {
        await rescheduleRewardNotifications(db);
      } catch {
        // rescheduling is best-effort
      }
    },
    [db]
  );

  const setRewardToggle = (
    key:
      | 'streakAlerts'
      | 'dailyNudge'
      | 'affordableAlerts'
      | 'levelUp'
      | 'weeklyReview',
    value: boolean
  ) => {
    haptics.selection();
    ui.setRewardNotif({ [key]: value });
    void persistRewardPrefs({ [key]: value });
  };

  const setRewardTime = (
    key: 'nudgeTime' | 'quietStart' | 'quietEnd',
    value: string
  ) => {
    haptics.selection();
    ui.setRewardNotif({ [key]: value });
    void persistRewardPrefs({ [key]: value });
  };

  const splitTime = (hhmm: string): { h: number; m: number } => {
    const [h, m] = hhmm.split(':').map(Number);
    return {
      h: Number.isFinite(h) ? h : 0,
      m: Number.isFinite(m) ? m : 0,
    };
  };
  const toHHMM = (h: number, m: number): string =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  const nudge = splitTime(ui.rewardNudgeTime);
  const quietStart = splitTime(ui.rewardQuietStart);
  const quietEnd = splitTime(ui.rewardQuietEnd);

  const stopPreview = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    try {
      playerRef.current?.pause();
      playerRef.current?.seekTo(0);
    } catch {
      // ignore
    }
    setPreviewingSound(null);
  }, []);

  const selectAndPreviewSound = (sound: (typeof ALARM_SOUNDS)[number]) => {
    ui.set({ alarmSound: sound.id });
    void persist('alarm_sound', sound.id);
    void haptics.alarmTick();

    if (previewingSound === sound.id) {
      stopPreview();
      return;
    }

    stopPreview();
    try {
      if (!playerRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const src = require('../../assets/sounds/alarm.wav');
        playerRef.current = createAudioPlayer(src);
      }
      const player = playerRef.current;
      player.loop = false;
      try {
        player.setPlaybackRate(sound.rate);
      } catch {
        // fallback if playbackRate unsupported on platform
      }
      player.seekTo(0);
      player.play();
      setPreviewingSound(sound.id);
      previewTimerRef.current = setTimeout(() => {
        stopPreview();
      }, 2600);
    } catch {
      setPreviewingSound(null);
    }
  };

  const exportFullBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    haptics.light();
    try {
      const [instances, templates, categories, skills, sessions, logs, metas] =
        await Promise.all([
          db.getAllAsync('SELECT * FROM task_instances'),
          db.getAllAsync('SELECT * FROM task_templates'),
          db.getAllAsync('SELECT * FROM categories'),
          db.getAllAsync('SELECT * FROM skills'),
          db.getAllAsync('SELECT * FROM timer_sessions'),
          db.getAllAsync('SELECT * FROM log_events ORDER BY id DESC LIMIT 5000'),
          db.getAllAsync('SELECT * FROM meta'),
        ]);

      const payload = {
        exportedAtUtc: new Date().toISOString(),
        version: pkg.version,
        counts: {
          instances: instances.length,
          templates: templates.length,
          categories: categories.length,
          skills: skills.length,
          sessions: sessions.length,
          logs: logs.length,
        },
        data: {
          meta: metas,
          categories,
          skills,
          task_templates: templates,
          task_instances: instances,
          timer_sessions: sessions,
          log_events: logs,
        },
      };

      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `checkoff-backup-${stamp}.json`;
      const file = new File(Paths.cache, filename);
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(payload, null, 2));

      await logEvent(db, {
        eventType: 'exported',
        payload: {
          format: 'backup-json',
          instances: instances.length,
          logs: logs.length,
        },
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Export CheckOff Data Backup',
        });
      } else {
        Alert.alert('Backup saved', file.uri);
      }
    } catch (err) {
      Alert.alert('Backup failed', String(err));
    } finally {
      setBackingUp(false);
    }
  };

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
            PREFERENCES & LEDGER
          </Text>
          <MetallicText variant="h1" palette={palette}>
            Settings
          </MetallicText>
          <Text style={[styles.headerSub, { color: palette.textSecondary }]}>
            Alarms, haptics, theme, and data — every change applies instantly.
          </Text>
        </View>

        {/* Append-Only Event Log Card */}
        <Card palette={palette} variant="elevated" padding="md">
          <PressableScale
            onPress={() => {
              haptics.light();
              router.push('/(tabs)/log');
            }}
            accessibilityRole="button"
            accessibilityLabel="Open Append-Only Event Logs"
            style={styles.logPortalRow}
          >
            <View
              style={[
                styles.iconBadge,
                {
                  backgroundColor: palette.bgSurface,
                  borderColor: palette.borderStrong,
                },
              ]}
            >
              <FileText size={20} color={palette.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.portalTitle, { color: palette.textPrimary }]}>
                Append-Only Event Logs
              </Text>
              <Text style={[styles.portalSub, { color: palette.textSecondary }]}>
                Inspect, filter, and export every state transition in JSON or CSV
              </Text>
            </View>
            <ArrowRight size={18} color={palette.textPrimary} />
          </PressableScale>
        </Card>

        {/* Appearance & Regional */}
        <Card palette={palette} padding="md">
          <SectionHeader
            palette={palette}
            icon={<Palette size={16} color={palette.accent} strokeWidth={2.2} />}
            label="APPEARANCE & TIME"
          />

          {/* Theme Mode: Dark / Light / System */}
          <View style={styles.blockRow}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
              Theme
            </Text>
            <View
              style={[
                styles.segmentWrap,
                { backgroundColor: palette.bgElevated, borderColor: palette.border },
              ]}
            >
              {(
                [
                  { id: 'dark', label: 'Dark' },
                  { id: 'light', label: 'Light' },
                  { id: 'system', label: 'System' },
                ] as const
              ).map((opt) => {
                const active = ui.themeMode === opt.id;
                return (
                  <PressableScale
                    key={opt.id}
                    onPress={() => setThemeMode(opt.id)}
                    style={[
                      styles.segmentBtn,
                      active && {
                        backgroundColor: palette.accent,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        {
                          color: active
                            ? palette.onAccent
                            : palette.textSecondary,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          {/* Clock Format: 12h / 24h */}
          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Clock Format
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                Live hero clock and task timestamps
              </Text>
            </View>
            <View
              style={[
                styles.segmentCompact,
                { backgroundColor: palette.bgElevated, borderColor: palette.border },
              ]}
            >
              {(['12h', '24h'] as ClockFormat[]).map((fmt) => {
                const active = ui.clockFormat === fmt;
                return (
                  <PressableScale
                    key={fmt}
                    onPress={() => setClockFormat(fmt)}
                    style={[
                      styles.segmentCompactBtn,
                      active && { backgroundColor: palette.accent },
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        {
                          color: active
                            ? palette.onAccent
                            : palette.textSecondary,
                        },
                      ]}
                    >
                      {fmt.toUpperCase()}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          {/* Week Start: Monday / Sunday */}
          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Week Starts On
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                Calendar grids and weekly telemetry
              </Text>
            </View>
            <View
              style={[
                styles.segmentCompact,
                { backgroundColor: palette.bgElevated, borderColor: palette.border },
              ]}
            >
              {(
                [
                  { id: 'mon', label: 'Mon' },
                  { id: 'sun', label: 'Sun' },
                ] as const
              ).map((w) => {
                const active = ui.weekStart === w.id;
                return (
                  <PressableScale
                    key={w.id}
                    onPress={() => setWeekStart(w.id)}
                    style={[
                      styles.segmentCompactBtn,
                      active && { backgroundColor: palette.accent },
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        {
                          color: active
                            ? palette.onAccent
                            : palette.textSecondary,
                        },
                      ]}
                    >
                      {w.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        </Card>

        {/* Alarm Sound Picker & Windows */}
        <Card palette={palette} padding="md">
          <SectionHeader
            palette={palette}
            icon={<Volume2 size={16} color={palette.accent} strokeWidth={2.2} />}
            label="ALARMS & WINDOWS"
          />

          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
            Alarm Sound Profile
          </Text>
          <Text
            style={[
              styles.rowHint,
              { color: palette.textMuted, marginBottom: space.sm },
            ]}
          >
            Tap any profile to select and preview audio + vibration
          </Text>

          <View style={styles.soundList}>
            {ALARM_SOUNDS.map((snd) => {
              const selected = ui.alarmSound === snd.id;
              const playing = previewingSound === snd.id;
              return (
                <PressableScale
                  key={snd.id}
                  onPress={() => selectAndPreviewSound(snd)}
                  hitSlop={hitSlop8}
                  accessibilityRole="button"
                  accessibilityLabel={`${snd.label} alarm sound`}
                  style={[
                    styles.soundRow,
                    {
                      backgroundColor: selected
                        ? palette.bgElevated
                        : palette.bg,
                      borderColor: selected
                        ? palette.accent
                        : palette.border,
                      borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.soundTitleRow}>
                      <Text
                        style={[
                          styles.soundLabel,
                          { color: palette.textPrimary },
                        ]}
                        numberOfLines={1}
                      >
                        {snd.label}
                      </Text>
                      {selected ? (
                        <Text
                          style={[
                            styles.activeTag,
                            { color: palette.accent },
                          ]}
                        >
                          ACTIVE
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      style={[styles.soundDesc, { color: palette.textMuted }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {snd.desc}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.previewCircle,
                      {
                        backgroundColor: playing
                          ? palette.accent
                          : palette.bgSurface,
                        borderColor: playing ? palette.accent : palette.borderStrong,
                      },
                    ]}
                  >
                    {playing ? (
                      <VolumeX size={15} color={palette.onAccent} />
                    ) : (
                      <Volume2 size={15} color={palette.textPrimary} />
                    )}
                  </View>
                </PressableScale>
              );
            })}
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          {/* Snooze Window Slider */}
          <Slider
            label="Snooze Duration"
            value={ui.snoozeMin}
            options={SNOOZE_DETENTS}
            onChange={setSnooze}
            formatValue={(v) => `${v} min`}
            palette={palette}
          />

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          {/* Grace Window Slider */}
          <Slider
            label="On-Time Grace Window"
            value={ui.graceMin}
            options={GRACE_DETENTS}
            onChange={setGrace}
            formatValue={(v) => `±${v} min`}
            palette={palette}
          />
        </Card>

        {/* Reward Notifications */}
        <Card palette={palette} padding="md">
          <SectionHeader
            palette={palette}
            icon={<Bell size={16} color={palette.accent} strokeWidth={2.2} />}
            label="REWARD NOTIFICATIONS"
          />

          <View style={styles.rewardHeadRow}>
            <Bell size={16} color={palette.textSecondary} />
            <Text style={[styles.rewardHeadText, { color: palette.textSecondary }]}>
              Max 3 per day. Never inside quiet hours. Separate low-priority
              channel from alarms.
            </Text>
          </View>

          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Streak At Risk
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                2h before day end when your streak is 3+ days and today&apos;s
                goal is unmet
              </Text>
            </View>
            <Switch
              value={ui.rewardStreakAlerts}
              onValueChange={(v) => setRewardToggle('streakAlerts', v)}
              palette={palette}
              accessibilityLabel="Toggle streak at risk alerts"
            />
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Daily Reward Nudge
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                Remind me to claim an earned daily reward
              </Text>
            </View>
            <Switch
              value={ui.rewardDailyNudge}
              onValueChange={(v) => setRewardToggle('dailyNudge', v)}
              palette={palette}
              accessibilityLabel="Toggle daily reward nudge"
            />
          </View>

          <View style={styles.rewardTimeRow}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textSecondary }]}>
              Nudge time
            </Text>
            <View
              style={!ui.rewardDailyNudge && { opacity: 0.4 }}
              pointerEvents={ui.rewardDailyNudge ? 'auto' : 'none'}
            >
              <NativeTimeButton
                theme={palette}
                hour={nudge.h}
                minute={nudge.m}
                onChange={(h, m) => setRewardTime('nudgeTime', toHHMM(h, m))}
              />
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Reward Affordable
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                Alert once when your balance first reaches a reward&apos;s cost
              </Text>
            </View>
            <Switch
              value={ui.rewardAffordableAlerts}
              onValueChange={(v) => setRewardToggle('affordableAlerts', v)}
              palette={palette}
              accessibilityLabel="Toggle reward affordable alerts"
            />
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Level Up
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                Celebrate when you reach a new level
              </Text>
            </View>
            <Switch
              value={ui.rewardLevelUp}
              onValueChange={(v) => setRewardToggle('levelUp', v)}
              palette={palette}
              accessibilityLabel="Toggle level up notifications"
            />
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Weekly Review
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                Sunday 19:00 recap of streaks, focus, and badges
              </Text>
            </View>
            <Switch
              value={ui.rewardWeeklyReview}
              onValueChange={(v) => setRewardToggle('weeklyReview', v)}
              palette={palette}
              accessibilityLabel="Toggle weekly review notifications"
            />
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <View style={styles.rewardTimeRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Quiet Hours
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                No reward notifications between these times
              </Text>
            </View>
            <View style={styles.quietRow}>
              <NativeTimeButton
                theme={palette}
                hour={quietStart.h}
                minute={quietStart.m}
                onChange={(h, m) => setRewardTime('quietStart', toHHMM(h, m))}
              />
              <Text style={[styles.quietDash, { color: palette.textMuted }]}>
                –
              </Text>
              <NativeTimeButton
                theme={palette}
                hour={quietEnd.h}
                minute={quietEnd.m}
                onChange={(h, m) => setRewardTime('quietEnd', toHHMM(h, m))}
              />
            </View>
          </View>
        </Card>

        {/* Tactile Haptics */}
        <Card palette={palette} padding="md">
          <SectionHeader
            palette={palette}
            icon={<Vibrate size={16} color={palette.accent} strokeWidth={2.2} />}
            label="TACTILE ENGINE"
          />

          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Haptic Feedback
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                Physical detents on sliders, switches, and task swipes
              </Text>
            </View>
            <Switch
              value={ui.hapticsEnabled}
              onValueChange={setHapticsEnabled}
              palette={palette}
              accessibilityLabel="Toggle haptic feedback"
            />
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <View style={styles.blockRow}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
              Impulse Intensity
            </Text>
            <View
              style={[
                styles.segmentWrap,
                { backgroundColor: palette.bgElevated, borderColor: palette.border },
              ]}
            >
              {INTENSITY_OPTIONS.map((opt) => {
                const active = ui.hapticIntensity === opt;
                return (
                  <PressableScale
                    key={opt}
                    onPress={() => setIntensity(opt)}
                    disabled={!ui.hapticsEnabled}
                    style={[
                      styles.segmentBtn,
                      active && { backgroundColor: palette.accent },
                      !ui.hapticsEnabled && { opacity: 0.4 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        {
                          color: active
                            ? palette.onAccent
                            : palette.textSecondary,
                        },
                      ]}
                    >
                      {opt.toUpperCase()}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        </Card>

        {/* Data Backup & Export */}
        <Card palette={palette} padding="md">
          <SectionHeader
            palette={palette}
            icon={<Database size={16} color={palette.accent} strokeWidth={2.2} />}
            label="DATA SOVEREIGNTY & BACKUP"
          />

          <View style={styles.backupRow}>
            <Database size={18} color={palette.textSecondary} />
            <Text style={[styles.backupDesc, { color: palette.textSecondary }]}>
              All tasks, recurring templates, timer sessions, and append-only logs live locally in SQLite on this device.
            </Text>
          </View>

          <View style={styles.backupActions}>
            <Button
              label={backingUp ? 'Exporting Backup...' : 'Export Full Backup (JSON)'}
              variant="secondary"
              loading={backingUp}
              icon={<Download size={15} color={palette.textPrimary} />}
              onPress={() => void exportFullBackup()}
              fullWidth
            />
          </View>
        </Card>

        {/* About & Version */}
        <Card palette={palette} padding="md">
          <SectionHeader
            palette={palette}
            icon={<Info size={16} color={palette.accent} strokeWidth={2.2} />}
            label="ABOUT CHECKOFF"
          />

          <View style={styles.inlineRow}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
              Installed Build
            </Text>
            <Text style={[styles.monoVal, { color: palette.textSecondary }]}>
              {updaterActions.installedVersionName} ({pkg.version})
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <PressableScale
            accessibilityRole="button"
            onPress={() => {
              haptics.light();
              void updaterActions.runCheck(true);
            }}
            style={styles.inlineRow}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Over-the-Air Release Status
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.rowHint, { color: palette.textMuted }]}>
                {checking
                  ? 'Checking release channel...'
                  : phase.kind === 'available'
                    ? `Update available: ${phase.release.versionName}`
                    : phase.kind === 'downloading'
                      ? `Downloading package ${Math.round(phase.progress * 100)}%`
                      : phase.kind === 'failed'
                        ? 'Last check failed — tap to retry'
                        : 'Up to date — tap to check now'}
              </Text>
            </View>
            <RefreshCw size={16} color={palette.textSecondary} />
          </PressableScale>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <View style={styles.privacyRow}>
            <ShieldCheck size={15} color={palette.textMuted} />
            <Text style={[styles.privacyText, { color: palette.textMuted }]}>
              Offline-first architecture. Zero cloud accounts or telemetry tracking.
            </Text>
          </View>
        </Card>
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
  eyebrow: {
    ...type.label,
    marginBottom: 2,
  },
  headerSub: {
    ...type.caption,
    marginTop: 4,
  },
  sectionHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  sectionIconBox: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeadLabel: {
    ...type.label,
  },
  logPortalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portalTitle: {
    ...type.h3,
  },
  portalSub: {
    ...type.caption,
    marginTop: 2,
  },
  blockRow: {
    gap: space.sm,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 48,
  },
  rowLabel: {
    ...type.body,
    fontWeight: '600',
    flexShrink: 1,
  },
  rowHint: {
    ...type.caption,
    marginTop: 2,
    flexShrink: 1,
  },
  monoVal: {
    ...type.monoSm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: space.md,
  },
  segmentWrap: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentCompact: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  segmentCompactBtn: {
    paddingHorizontal: space.md,
    minHeight: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    ...type.caption,
    fontWeight: '700',
  },
  soundList: {
    gap: space.sm,
  },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    minHeight: 58,
  },
  soundTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  soundLabel: {
    ...type.body,
    fontWeight: '700',
  },
  activeTag: {
    ...type.monoSm,
    fontSize: 10,
  },
  soundDesc: {
    ...type.caption,
    marginTop: 2,
  },
  previewCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginBottom: space.md,
  },
  backupDesc: {
    ...type.bodySm,
    flex: 1,
  },
  backupActions: {
    marginTop: space.xs,
  },
  rewardHeadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginBottom: space.md,
  },
  rewardHeadText: {
    ...type.caption,
    flex: 1,
  },
  rewardTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.md,
    minHeight: 48,
  },
  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  quietDash: {
    ...type.body,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  privacyText: {
    ...type.caption,
    flex: 1,
  },
});
