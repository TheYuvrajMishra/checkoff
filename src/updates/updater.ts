/**
 * CheckOff — in-app auto-updater (Android only).
 *
 * Flow:
 * 1. On launch + foreground return (throttled to once per 6h), fetch the
 *    latest GitHub release.
 * 2. Compare the release tag's build number (v1.0.<N>) against the installed
 *    versionCode (expo-application nativeBuildVersion).
 * 3. If newer and not skipped, surface an update banner.
 * 4. On Install: download checkoff.apk to cache (progress), then open the
 *    system package installer via a content URI.
 *
 * Data safety: the APK is signed with the same release keystore as the
 * installed app, so Android performs an in-place update — the app's private
 * files (including the SQLite DB) are preserved. Schema changes are handled
 * by the existing migration system in src/db/migrations.ts on next launch.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

export const UPDATE_OWNER = 'TheYuvrajMishra';
export const UPDATE_REPO = 'checkoff';
const LATEST_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;
const APK_NAME = 'checkoff.apk';

const LAST_CHECK_KEY = 'updater:lastCheckAt';
const SKIPPED_KEY = 'updater:skippedTag';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface ReleaseInfo {
  tag: string; // e.g. "v1.0.42"
  buildNumber: number; // 42
  versionName: string; // "1.0.42"
  changelog: string;
  apkUrl: string;
}

export function parseTag(tag: string): { buildNumber: number; versionName: string } | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!m) return null;
  return { buildNumber: parseInt(m[3], 10), versionName: `${m[1]}.${m[2]}.${m[3]}` };
}

export function installedBuildNumber(): number {
  const v = Application.nativeBuildVersion;
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function installedVersionName(): string {
  return Application.nativeApplicationVersion ?? '1.0.0';
}

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const res = await fetch(LATEST_URL, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  const parsed = parseTag(tag);
  if (!parsed) return null;
  const assets: Array<{ name?: string; browser_download_url?: string }> = Array.isArray(
    data.assets
  )
    ? data.assets
    : [];
  const apk = assets.find(
    (a) => a.name === APK_NAME && typeof a.browser_download_url === 'string'
  );
  if (!apk?.browser_download_url) return null;
  return {
    tag,
    buildNumber: parsed.buildNumber,
    versionName: parsed.versionName,
    changelog: typeof data.body === 'string' ? data.body : '',
    apkUrl: apk.browser_download_url,
  };
}

/**
 * Check for an update. Returns the release if one is available and should be
 * offered, otherwise null. Fails silently (null) when offline or on error.
 */
export async function checkForUpdate(opts?: {
  force?: boolean;
}): Promise<ReleaseInfo | null> {
  if (Platform.OS !== 'android') return null;
  try {
    if (!opts?.force) {
      const last = await AsyncStorage.getItem(LAST_CHECK_KEY);
      if (last && Date.now() - parseInt(last, 10) < CHECK_INTERVAL_MS) return null;
    }
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    const release = await fetchLatestRelease();
    if (!release) return null;
    if (release.buildNumber <= installedBuildNumber()) return null;
    const skipped = await AsyncStorage.getItem(SKIPPED_KEY);
    if (skipped === release.tag) return null;
    return release;
  } catch {
    // Offline or any failure: fail silently.
    return null;
  }
}

export async function skipVersion(tag: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SKIPPED_KEY, tag);
  } catch {
    // best-effort
  }
}

export async function clearSkipped(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SKIPPED_KEY);
  } catch {
    // best-effort
  }
}

export interface DownloadHandle {
  promise: Promise<string>;
  cancel: () => void;
}

/** Download the APK to cache, reporting 0..1 progress. Resolves with file URI. */
export function downloadApk(
  release: ReleaseInfo,
  onProgress: (fraction: number) => void
): DownloadHandle {
  const fileUri = `${FileSystem.cacheDirectory}${APK_NAME}`;
  const resumable = FileSystem.createDownloadResumable(
    release.apkUrl,
    fileUri,
    {},
    (progress) => {
      const { totalBytesWritten, totalBytesExpectedToWrite } = progress;
      if (totalBytesExpectedToWrite > 0) {
        onProgress(totalBytesWritten / totalBytesExpectedToWrite);
      }
    }
  );
  let settled = false;
  const promise = (async () => {
    const result = await resumable.downloadAsync();
    settled = true;
    if (!result || !result.uri) throw new Error('Download produced no file');
    return result.uri;
  })();
  return {
    promise,
    cancel: () => {
      if (!settled) {
        try {
          resumable.pauseAsync();
        } catch {
          // best-effort
        }
      }
    },
  };
}

/** Open the system package installer for a downloaded APK file URI. */
export async function installApk(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}

/**
 * Deep-link to this app's "Install unknown apps" settings screen so the user
 * can grant the permission, then return and tap Install again.
 */
export async function openUnknownSourcesSettings(): Promise<void> {
  const pkg = Application.applicationId ?? 'com.yuvrajmishra.checkoff';
  try {
    await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
      data: `package:${pkg}`,
    });
  } catch {
    // Fallback: generic security settings.
    await IntentLauncher.startActivityAsync('android.settings.SECURITY_SETTINGS');
  }
}
