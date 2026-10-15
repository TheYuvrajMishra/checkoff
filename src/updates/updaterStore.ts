/**
 * CheckOff — shared updater store (module singleton).
 *
 * Both the global UpdateBanner (in root layout) and the Settings screen's
 * "Check for updates" row read/write the same state via useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';
import {
  checkForUpdate,
  clearSkipped as clearSkippedTag,
  downloadApk,
  installApk,
  openUnknownSourcesSettings,
  skipVersion,
  installedVersionName as getInstalledVersionName,
  type DownloadHandle,
  type ReleaseInfo,
} from './updater';

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'available'; release: ReleaseInfo }
  | { kind: 'downloading'; release: ReleaseInfo; progress: number }
  | { kind: 'downloaded'; release: ReleaseInfo; fileUri: string }
  | { kind: 'failed'; release: ReleaseInfo; error: string };

interface StoreState {
  phase: UpdatePhase;
  checking: boolean;
}

let state: StoreState = { phase: { kind: 'idle' }, checking: false };
const listeners = new Set<() => void>();
let downloadHandle: DownloadHandle | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): StoreState {
  return state;
}

export function useUpdaterStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export const updaterActions = {
  installedVersionName: getInstalledVersionName(),

  async runCheck(force = false) {
    if (state.checking) return;
    state = { ...state, checking: true };
    emit();
    try {
      const release = await checkForUpdate({ force });
      if (release) {
        state = { ...state, phase: { kind: 'available', release } };
      }
    } finally {
      state = { ...state, checking: false };
      emit();
    }
  },

  later() {
    state = { ...state, phase: { kind: 'idle' } };
    emit();
  },

  async skip() {
    const p = state.phase;
    if (p.kind === 'available' || p.kind === 'failed') {
      await skipVersion(p.release.tag);
    }
    state = { ...state, phase: { kind: 'idle' } };
    emit();
  },

  async clearSkipped() {
    await clearSkippedTag();
  },

  startDownload() {
    const p = state.phase;
    if (p.kind !== 'available' && p.kind !== 'failed') return;
    const release = p.release;
    state = { ...state, phase: { kind: 'downloading', release, progress: 0 } };
    emit();
    const handle = downloadApk(release, (progress) => {
      state = { ...state, phase: { kind: 'downloading', release, progress } };
      emit();
    });
    downloadHandle = handle;
    handle.promise.then(
      (fileUri) => {
        downloadHandle = null;
        state = { ...state, phase: { kind: 'downloaded', release, fileUri } };
        emit();
        installApk(fileUri).catch(async (e) => {
          const msg = String(e?.message ?? e);
          if (/permission|not allowed|unknown/i.test(msg)) {
            try {
              await openUnknownSourcesSettings();
            } catch {
              // best-effort
            }
            // Keep phase as 'downloaded' so the user can retry after
            // granting the permission (banner shows Install again).
            // Do not mark as failed.
            return;
          }
          state = { ...state, phase: { kind: 'failed', release, error: msg } };
          emit();
        });
      },
      (e) => {
        downloadHandle = null;
        state = {
          ...state,
          phase: { kind: 'failed', release, error: String(e?.message ?? 'Download failed') },
        };
        emit();
      }
    );
  },

  cancelDownload() {
    downloadHandle?.cancel();
    downloadHandle = null;
    const p = state.phase;
    if (p.kind === 'downloading') {
      state = { ...state, phase: { kind: 'available', release: p.release } };
      emit();
    }
  },

  /**
   * Retry the system installer for an already-downloaded APK.
   * Called automatically on foreground return (after the user grants
   * "Install unknown apps"), and from the banner's Install button.
   */
  async retryInstall() {
    const p = state.phase;
    if (p.kind !== 'downloaded') return;
    try {
      await installApk(p.fileUri);
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      if (/permission|not allowed|unknown/i.test(msg)) {
        try {
          await openUnknownSourcesSettings();
        } catch {
          // best-effort
        }
        // Stay in 'downloaded' so the user can try again.
        return;
      }
      state = { ...state, phase: { kind: 'failed', release: p.release, error: msg } };
      emit();
    }
  },
};
