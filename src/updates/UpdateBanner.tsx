/**
 * CheckOff — update banner (Android only).
 *
 * Clean in-app banner shown when a newer release is available:
 * "Update available v1.0.X" with Install / Later buttons, changelog preview,
 * download progress bar, retry on failure, and a "skip this version" option.
 * No emoji.
 */
import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '../components/PressableScale';
import { useUiStore } from '../state/ui';
import { dark, light, space, TAP, type as type } from '../theme/tokens';
import { updaterActions, useUpdaterStore } from './updaterStore';

export function UpdateBanner() {
  const ui = useUiStore();
  const palette = ui.theme === 'dark' ? dark : light;
  const styles = makeStyles(palette);
  const { phase } = useUpdaterStore();

  if (phase.kind === 'idle') return null;

  const release = phase.release;

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Update available v{release.versionName}</Text>
        </View>
        {release.changelog ? (
          <Text style={styles.changelog} numberOfLines={4}>
            {release.changelog.trim()}
          </Text>
        ) : null}

        {phase.kind === 'available' && (
          <View style={styles.actions}>
            <PressableScale
              accessibilityRole="button"
              onPress={updaterActions.startDownload}
              style={[styles.btn, styles.btnPrimary]}
            >
              <Text style={styles.btnPrimaryText}>Install</Text>
            </PressableScale>
            <PressableScale accessibilityRole="button" onPress={updaterActions.later} style={styles.btn}>
              <Text style={styles.btnText}>Later</Text>
            </PressableScale>
            <PressableScale accessibilityRole="button" onPress={updaterActions.skip} style={styles.btn}>
              <Text style={styles.btnText}>Skip this version</Text>
            </PressableScale>
          </View>
        )}

        {phase.kind === 'downloading' && (
          <View>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${Math.round(phase.progress * 100)}%` }]}
              />
            </View>
            <View style={styles.actions}>
              <Text style={styles.btnText}>
                Downloading {Math.round(phase.progress * 100)}%
              </Text>
              <PressableScale
                accessibilityRole="button"
                onPress={updaterActions.cancelDownload}
                style={styles.btn}
              >
                <Text style={styles.btnText}>Cancel</Text>
              </PressableScale>
            </View>
          </View>
        )}

        {phase.kind === 'downloaded' && (
          <View style={styles.actions}>
            <PressableScale
              accessibilityRole="button"
              onPress={updaterActions.retryInstall}
              style={[styles.btn, styles.btnPrimary]}
            >
              <Text style={styles.btnPrimaryText}>Install</Text>
            </PressableScale>
            <PressableScale accessibilityRole="button" onPress={updaterActions.later} style={styles.btn}>
              <Text style={styles.btnText}>Later</Text>
            </PressableScale>
          </View>
        )}

        {phase.kind === 'failed' && (
          <View>
            <Text style={styles.error}>{phase.error}</Text>
            <View style={styles.actions}>
              <PressableScale
                accessibilityRole="button"
                onPress={updaterActions.startDownload}
                style={[styles.btn, styles.btnPrimary]}
              >
                <Text style={styles.btnPrimaryText}>Retry</Text>
              </PressableScale>
              <PressableScale accessibilityRole="button" onPress={updaterActions.later} style={styles.btn}>
                <Text style={styles.btnText}>Later</Text>
              </PressableScale>
              <PressableScale accessibilityRole="button" onPress={updaterActions.skip} style={styles.btn}>
                <Text style={styles.btnText}>Skip this version</Text>
              </PressableScale>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function makeStyles(p: typeof dark) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      elevation: 9999,
      paddingHorizontal: space(2),
      paddingTop: space(1),
    },
    card: {
      backgroundColor: p.surface2,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: p.borderStrong,
      padding: space(2),
    },
    header: { marginBottom: space(1) },
    title: { ...type.bodyStrong, color: p.text },
    changelog: { ...type.small, color: p.textDim, marginBottom: space(1) },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: space(1),
      marginTop: space(1),
    },
    btn: {
      minHeight: TAP,
      paddingHorizontal: space(2),
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: p.border,
    },
    btnPrimary: { backgroundColor: p.accent, borderColor: p.accent },
    btnText: { ...type.small, color: p.textDim, fontWeight: '600' },
    btnPrimaryText: { ...type.small, color: p.onAccent, fontWeight: '700' },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: p.surface3,
      overflow: 'hidden',
      marginTop: space(1),
    },
    progressFill: { height: '100%', backgroundColor: p.accent },
    error: { ...type.small, color: p.text, marginTop: space(1) },
  });
}
