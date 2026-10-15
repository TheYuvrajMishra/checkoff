/**
 * CheckOff — settings screen.
 *
 * Every row: 48dp+ tap target, caption label, no emoji. Writes go to the
 * meta table (source of truth) and mirror into the UI store for fast reads.
 */
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useDb } from '../db/useDb';
import { setMeta, META_KEYS } from '../db/repos/meta';
import { useUiStore, type HapticIntensity, type ThemeName } from '../state/ui';
import { configureHaptics } from '../haptics';
import { dark, light, space, TAP, type as type } from '../theme/tokens';
import { updaterActions, useUpdaterStore } from '../updates/updaterStore';
import pkg from '../../package.json';

const GRACE_OPTIONS = [5, 10, 15, 30];
const SNOOZE_OPTIONS = [5, 9, 15];
const INTENSITY_OPTIONS: HapticIntensity[] = ['light', 'medium', 'strong'];

export default function SettingsScreen() {
  const db = useDb();
  const ui = useUiStore();
  const palette = ui.theme === 'dark' ? dark : light;
  const { phase, checking } = useUpdaterStore();

  const persist = useCallback(
    async (key: string, value: string) => {
      try {
        await setMeta(db, key, value);
      } catch {
        // UI store already updated; meta write is best-effort here.
      }
    },
    [db]
  );

  const setTheme = (theme: ThemeName) => {
    ui.set({ theme });
    void persist(META_KEYS.theme, theme);
  };

  const setHapticsEnabled = (enabled: boolean) => {
    ui.set({ hapticsEnabled: enabled });
    configureHaptics({ enabled, intensity: ui.hapticIntensity });
    void persist(META_KEYS.hapticsEnabled, enabled ? '1' : '0');
  };

  const setIntensity = (intensity: HapticIntensity) => {
    ui.set({ hapticIntensity: intensity });
    configureHaptics({ enabled: ui.hapticsEnabled, intensity });
    void persist(META_KEYS.hapticIntensity, intensity);
  };

  const setGrace = (min: number) => {
    ui.set({ graceMin: min });
    void persist(META_KEYS.graceMin, String(min));
  };

  const setSnooze = (min: number) => {
    ui.set({ snoozeMin: min });
    void persist(META_KEYS.snoozeMin, String(min));
  };

  const styles = makeStyles(palette);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.sectionLabel}>Appearance</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Theme</Text>
          <View style={styles.segment}>
            {(['dark', 'light'] as ThemeName[]).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="button"
                onPress={() => setTheme(t)}
                style={[styles.segmentBtn, ui.theme === t && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, ui.theme === t && styles.segmentTextActive]}>
                  {t === 'dark' ? 'Dark' : 'Light'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Haptics</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Haptic feedback</Text>
          <Switch value={ui.hapticsEnabled} onValueChange={setHapticsEnabled} />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Intensity</Text>
          <View style={styles.segment}>
            {INTENSITY_OPTIONS.map((opt) => (
              <Pressable
                key={opt}
                accessibilityRole="button"
                onPress={() => setIntensity(opt)}
                style={[styles.segmentBtn, ui.hapticIntensity === opt && styles.segmentBtnActive]}
              >
                <Text
                  style={[styles.segmentText, ui.hapticIntensity === opt && styles.segmentTextActive]}
                >
                  {opt[0].toUpperCase() + opt.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Alarms</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Grace window</Text>
            <Text style={styles.rowHint}>Time after the alarm before a task counts as missed</Text>
          </View>
        </View>
        <View style={styles.optionsRow}>
          {GRACE_OPTIONS.map((min) => (
            <Pressable
              key={min}
              accessibilityRole="button"
              onPress={() => setGrace(min)}
              style={[styles.optionBtn, ui.graceMin === min && styles.optionBtnActive]}
            >
              <Text style={[styles.optionText, ui.graceMin === min && styles.optionTextActive]}>
                {min}m
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Snooze length</Text>
            <Text style={styles.rowHint}>How long a snoozed alarm waits before firing again</Text>
          </View>
        </View>
        <View style={styles.optionsRow}>
          {SNOOZE_OPTIONS.map((min) => (
            <Pressable
              key={min}
              accessibilityRole="button"
              onPress={() => setSnooze(min)}
              style={[styles.optionBtn, ui.snoozeMin === min && styles.optionBtnActive]}
            >
              <Text style={[styles.optionText, ui.snoozeMin === min && styles.optionTextActive]}>
                {min}m
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.sectionLabel}>About</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>
            {updaterActions.installedVersionName} ({pkg.version})
          </Text>
        </View>
        <View style={styles.divider} />
        <Pressable
          accessibilityRole="button"
          onPress={() => void updaterActions.runCheck(true)}
          style={styles.row}
        >
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Check for updates</Text>
            <Text style={styles.rowHint}>
              {checking
                ? 'Checking'
                : phase.kind === 'available'
                  ? `Update available ${phase.release.versionName}`
                  : phase.kind === 'downloading'
                    ? `Downloading ${Math.round(phase.progress * 100)}%`
                    : phase.kind === 'failed'
                      ? 'Last check failed — tap to retry'
                      : 'Up to date'}
            </Text>
          </View>
        </Pressable>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowValue}>Data stays on this device. No accounts, no network.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function makeStyles(p: typeof dark) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: p.bg },
    content: { padding: space(2), paddingBottom: space(6) },
    title: { ...type.h1, color: p.text, marginBottom: space(2) },
    sectionLabel: {
      ...type.caption,
      color: p.textFaint,
      textTransform: 'uppercase',
      marginTop: space(3),
      marginBottom: space(1),
    },
    card: {
      backgroundColor: p.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
      paddingHorizontal: space(2),
    },
    row: {
      minHeight: TAP,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: space(1),
    },
    rowTextWrap: { flex: 1, paddingRight: space(2) },
    rowLabel: { ...type.body, color: p.text },
    rowHint: { ...type.small, color: p.textDim, marginTop: 2 },
    rowValue: { ...type.body, color: p.textDim },
    divider: { height: 1, backgroundColor: p.border },
    segment: { flexDirection: 'row', backgroundColor: p.surface2, borderRadius: 10, padding: 4 },
    segmentBtn: {
      minHeight: TAP - 8,
      minWidth: TAP,
      paddingHorizontal: space(2),
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBtnActive: { backgroundColor: p.accent },
    segmentText: { ...type.small, color: p.textDim, fontWeight: '600' },
    segmentTextActive: { color: p.onAccent },
    optionsRow: { flexDirection: 'row', gap: space(1), paddingBottom: space(2) },
    optionBtn: {
      minHeight: TAP,
      minWidth: TAP,
      paddingHorizontal: space(2),
      borderRadius: 10,
      borderWidth: 1,
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionBtnActive: { backgroundColor: p.accentDim, borderColor: p.accent },
    optionText: { ...type.body, color: p.textDim, fontWeight: '600' },
    optionTextActive: { color: p.accent },
  });
}
