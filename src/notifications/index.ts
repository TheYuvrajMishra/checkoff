/**
 * CheckOff — notifications: task alarms + timer chimes.
 *
 * Architecture:
 * - Task alarms are scheduled with a DATE trigger (exact on Android when the
 *   user has granted SCHEDULE_EXACT_ALARM; the native layer falls back to an
 *   inexact window otherwise — verified in expo-notifications v57 source).
 * - expo-notifications natively re-arms scheduled notifications on
 *   BOOT_COMPLETED (NotificationsService.SETUP_ACTIONS -> onSetupScheduledNotifications,
 *   verified in the v57 native source). `scheduled_alarms` is our own ledger so
 *   JS can cancel/reconcile; `rescheduleAllAlarms` rebuilds it on bootstrap.
 * - Foreground receipts play the alarm sound via expo-audio + a haptic tick
 *   loop (the OS channel sound covers background/killed delivery).
 *
 * Coordinator bootstrap must call, in order:
 *   1. setNotificationsDb(db)      — gives listeners a DB handle
 *   2. setupNotifications()        — permissions, channels, categories, listeners
 *   3. rescheduleAllAlarms(db)     — rebuild today's + tomorrow's alarms
 *   4. processMissedAlarms(db, new Date())
 *   5. reconcileTimers(db)         — from ../timers
 *
 * Verified against expo-notifications v57 docs + installed 57.0.23 source:
 * - trigger: { type: SchedulableTriggerInputTypes.DATE, date } / TIME_INTERVAL
 * - setNotificationChannelAsync(id, { name, importance, enableVibrate,
 *   vibrationPattern, sound }) — sound is a raw-resource filename ('alarm.wav'),
 *   wired via the expo-notifications config plugin `sounds` array.
 * - setNotificationCategoryAsync(id, [{ identifier, buttonTitle, options }])
 *   with options { isDestructive?, opensAppToForeground? }.
 * - addNotificationReceivedListener / addNotificationResponseReceivedListener.
 * - No JS API exists for the SCHEDULE_EXACT_ALARM grant state in v57; we
 *   warn (never throw) on Android 12+ and document the settings path.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { InstanceStatus, TaskInstance } from '../db/types';
import { logEvent } from '../db/log';
import { addDays, localDateString, nowUtcIso } from '../db/time';
import { getMeta, META_KEYS } from '../db/repos/meta';
import { haptics } from '../haptics';

export const ALARM_CHANNEL_ID = 'checkoff-alarms';
export const TIMER_CHANNEL_ID = 'checkoff-timer';
export const TASK_ALARM_CATEGORY = 'task-alarm';
export const TIMER_END_CATEGORY = 'timer-end';
/** Raw-resource filename (assets/sounds/alarm.wav -> res/raw/alarm.wav). */
export const ALARM_SOUND = 'alarm.wav';

type AlarmAction = 'done' | 'snooze' | 'skip';

interface AlarmData {
  kind: 'task-alarm';
  instanceId: string;
}

interface TimerEndData {
  kind: 'timer-end';
  timerSessionId: string;
}

/** Union of the data payloads we schedule; unknown kinds are ignored. */
type ScheduledNotificationData = AlarmData | TimerEndData;

function getNotificationData(notification: Notifications.Notification): Partial<ScheduledNotificationData> | undefined {
  const data = notification.request.content.data as Partial<ScheduledNotificationData> | undefined;
  return data;
}

let notificationsDb: SQLiteDatabase | null = null;
let listenersRegistered = false;

/**
 * Bootstrap wiring (coordinator-owned). The response/received listeners need
 * a DB handle; setupNotifications() intentionally takes no arguments, so the
 * coordinator hands the DB over here first.
 */
export function setNotificationsDb(db: SQLiteDatabase): void {
  notificationsDb = db;
}

// ---------------------------------------------------------------------------
// Alarm sound (foreground attention). Lazy singleton; never throws.
// ---------------------------------------------------------------------------

let alarmPlayer: AudioPlayer | null = null;

function getAlarmPlayer(): AudioPlayer | null {
  if (alarmPlayer) return alarmPlayer;
  try {
    // Bundled via assetBundlePatterns; Metro resolves the wav at build time.
    // `require` returns `any`, so no asset module declaration is needed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require('../../assets/sounds/alarm.wav');
    alarmPlayer = createAudioPlayer(source);
    alarmPlayer.loop = true;
  } catch {
    alarmPlayer = null;
  }
  return alarmPlayer;
}

async function playAlarmSound(): Promise<void> {
  try {
    const player = getAlarmPlayer();
    if (!player) return;
    player.seekTo(0);
    player.play();
  } catch {
    // Sound is decorative next to the OS channel sound; never break flow.
  }
}

function stopAlarmSound(): void {
  try {
    alarmPlayer?.pause();
    alarmPlayer?.seekTo(0);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Foreground attention loop: haptic tick every 2s, max 30s.
// ---------------------------------------------------------------------------

let attentionTimer: ReturnType<typeof setInterval> | null = null;

function stopAttentionLoop(): void {
  if (attentionTimer) {
    clearInterval(attentionTimer);
    attentionTimer = null;
  }
  stopAlarmSound();
}

function startAttentionLoop(): void {
  stopAttentionLoop();
  void playAlarmSound();
  void haptics.alarmTick();
  let ticks = 1;
  const maxTicks = 15; // 30s at a 2s cadence
  attentionTimer = setInterval(() => {
    ticks += 1;
    if (ticks >= maxTicks) {
      stopAttentionLoop();
      return;
    }
    void haptics.alarmTick();
  }, 2000);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Android 12+ (API 31) gates exact alarms behind the user-grantable
 * SCHEDULE_EXACT_ALARM ("Alarms & reminders") permission. expo-notifications
 * v57 exposes no JS API for its grant state, so this is a best-effort check:
 * it warns with the exact settings path and NEVER throws. The native
 * scheduler degrades to an inexact window when the permission is missing.
 */
function checkExactAlarmPermission(): void {
  try {
    if (Platform.OS !== 'android') return;
    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    if (Number.isNaN(apiLevel) || apiLevel < 31) return;
    console.warn(
      '[checkoff] Exact alarms need "Alarms & reminders" allowed for CheckOff ' +
        '(Settings > Apps > CheckOff > Alarms & reminders). ' +
        'Without it, alarms may fire late. Date-triggered notifications fall back ' +
        'to an inexact window natively; nothing crashes.'
    );
  } catch {
    // Permission introspection must never break setup.
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export async function setupNotifications(): Promise<void> {
  // 1. Notification permission (Android 13+ runtime prompt).
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      if (requested.status !== 'granted') {
        console.warn('[checkoff] notification permission not granted; alarms will not fire');
      }
    }
  } catch (e) {
    console.warn('[checkoff] notification permission request failed', e);
  }

  // 2. Exact-alarm state (warn-only, never throws).
  checkExactAlarmPermission();

  // 3. Audio session: alarm must play even in silent mode.
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch (e) {
    console.warn('[checkoff] setAudioModeAsync failed', e);
  }

  // 4. Foreground presentation: show banner + list, but do NOT play the OS
  //    sound — we play our own looped alarm.wav via expo-audio (no doubling).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  // 5. Android channels.
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
        name: 'Task alarms',
        importance: Notifications.AndroidImportance.MAX,
        enableVibrate: true,
        vibrationPattern: [0, 400, 200, 400],
        // Custom sound; wired via the expo-notifications config plugin
        // `sounds` array (assets/sounds/alarm.wav -> res/raw/alarm.wav).
        // Falls back to the default sound if wiring ever breaks.
        sound: ALARM_SOUND,
      });
    } catch (e) {
      console.warn('[checkoff] could not create alarm channel', e);
    }
    try {
      await Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
        name: 'Timer',
        importance: Notifications.AndroidImportance.LOW,
        enableVibrate: false,
        sound: null,
      });
    } catch (e) {
      console.warn('[checkoff] could not create timer channel', e);
    }
  }

  // 6. Interactive categories. NOTE: v57 docs warn against '-' in category
  //    identifiers, but the Android native builder reads categoryIdentifier
  //    verbatim (verified in ExpoNotificationBuilder.kt), and the contract
  //    fixes these ids. iOS is not a target for this build.
  try {
    await Notifications.setNotificationCategoryAsync(TASK_ALARM_CATEGORY, [
      { identifier: 'done', buttonTitle: 'Done', options: { opensAppToForeground: false } },
      { identifier: 'snooze', buttonTitle: 'Snooze', options: { opensAppToForeground: false } },
      {
        identifier: 'skip',
        buttonTitle: 'Skip',
        options: { isDestructive: true, opensAppToForeground: false },
      },
    ]);
    await Notifications.setNotificationCategoryAsync(TIMER_END_CATEGORY, [
      { identifier: 'done', buttonTitle: 'Done', options: { opensAppToForeground: true } },
      { identifier: 'dismiss', buttonTitle: 'Dismiss', options: { opensAppToForeground: false } },
    ]);
  } catch (e) {
    console.warn('[checkoff] could not register notification categories', e);
  }

  // 7. Listeners (registered once; setup may run again on foreground).
  if (!listenersRegistered) {
    listenersRegistered = true;

    Notifications.addNotificationReceivedListener((notification) => {
      const data = getNotificationData(notification);
      if (data?.kind !== 'task-alarm' && data?.kind !== 'timer-end') return;
      startAttentionLoop();
      const db = notificationsDb;
      if (!db) return;
      if (data.kind === 'task-alarm' && data.instanceId) {
        void logEvent(db, {
          eventType: 'alarm_fired',
          actor: 'alarm',
          taskInstanceId: data.instanceId,
          payload: { kind: 'task-alarm' },
        }).catch(() => {});
      } else if (data.kind === 'timer-end' && data.timerSessionId) {
        void logEvent(db, {
          eventType: 'alarm_fired',
          actor: 'alarm',
          timerSessionId: data.timerSessionId,
          payload: { kind: 'timer-end' },
        }).catch(() => {});
      }
    });

    Notifications.addNotificationResponseReceivedListener((response) => {
      stopAttentionLoop();
      const db = notificationsDb;
      if (!db) return;
      const data = getNotificationData(response.notification);
      const actionId = response.actionIdentifier;
      if (data?.kind === 'task-alarm' && data.instanceId) {
        if (actionId === 'done' || actionId === 'snooze' || actionId === 'skip') {
          void applyAlarmAction(db, data.instanceId, actionId).catch(() => {});
        }
        // Plain tap (DEFAULT_ACTION_IDENTIFIER): no state change. The
        // coordinator routes via data.instanceId for navigation.
      }
      // timer-end actions (done/dismiss) are presentation-level: the session
      // row is the source of truth and reconcileTimers derives its end.
    });
  }
}

// ---------------------------------------------------------------------------
// scheduled_alarms ledger (operational state, not domain data)
// ---------------------------------------------------------------------------

async function ensureScheduledAlarmsTable(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS scheduled_alarms (
       instance_id TEXT PRIMARY KEY,
       notification_id TEXT NOT NULL,
       fire_at_utc TEXT NOT NULL
     );`
  );
}

/** Fire datetime from the instance's local date + alarm_time ("HH:MM"). */
export function alarmFireDate(instance: Pick<TaskInstance, 'date' | 'alarmTime'>): Date | null {
  if (!instance.alarmTime) return null;
  const [h, m] = instance.alarmTime.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const [y, mo, d] = instance.date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0); // device-local
}

/**
 * Schedule (or re-schedule) the exact alarm for one instance. No-op when the
 * instance has no alarm_time or the fire time is already past. Idempotent:
 * any previous schedule for the instance is cancelled first.
 */
export async function scheduleTaskAlarm(db: SQLiteDatabase, instance: TaskInstance): Promise<void> {
  await ensureScheduledAlarmsTable(db);
  const fireAt = alarmFireDate(instance);
  if (!fireAt || fireAt.getTime() <= Date.now()) return;
  try {
    await cancelTaskAlarm(db, instance.id);
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: instance.title,
        body: `Scheduled · ${instance.alarmTime}`,
        // Android reads this verbatim for action buttons (verified native).
        categoryIdentifier: TASK_ALARM_CATEGORY,
        sound: ALARM_SOUND,
        data: { instanceId: instance.id, kind: 'task-alarm' } satisfies AlarmData,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      },
    });
    await db.runAsync(
      `INSERT INTO scheduled_alarms (instance_id, notification_id, fire_at_utc)
       VALUES (?, ?, ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         notification_id = excluded.notification_id,
         fire_at_utc = excluded.fire_at_utc`,
      instance.id,
      notificationId,
      nowUtcIso(fireAt)
    );
  } catch (e) {
    console.warn('[checkoff] scheduleTaskAlarm failed', e);
  }
}

/** Cancel a scheduled alarm. Never throws. */
export async function cancelTaskAlarm(db: SQLiteDatabase, instanceId: string): Promise<void> {
  try {
    await ensureScheduledAlarmsTable(db);
    const row = await db.getFirstAsync<{ notification_id: string }>(
      'SELECT notification_id FROM scheduled_alarms WHERE instance_id = ?',
      instanceId
    );
    if (row?.notification_id) {
      try {
        await Notifications.cancelScheduledNotificationAsync(row.notification_id);
      } catch {
        // Already fired / unknown id — the ledger row is still stale, drop it.
      }
    }
    await db.runAsync('DELETE FROM scheduled_alarms WHERE instance_id = ?', instanceId);
  } catch {
    // Never throws by contract.
  }
}

// ---------------------------------------------------------------------------
// Local instance access (identical semantics to the sibling repo; no import)
// ---------------------------------------------------------------------------

function rowToInstance(row: Record<string, unknown>): TaskInstance {
  return {
    id: row.id as string,
    templateId: (row.template_id as string) ?? null,
    date: row.date as string,
    title: row.title as string,
    categoryId: (row.category_id as string) ?? null,
    durationMin: (row.duration_min as number) ?? 30,
    alarmTime: (row.alarm_time as string) ?? null,
    isRitual: (row.is_ritual as number) === 1,
    status: row.status as InstanceStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function getInstance(db: SQLiteDatabase, id: string): Promise<TaskInstance | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM task_instances WHERE id = ?',
    id
  );
  return row ? rowToInstance(row) : null;
}

async function setInstanceStatus(
  db: SQLiteDatabase,
  id: string,
  status: InstanceStatus
): Promise<void> {
  await db.runAsync('UPDATE task_instances SET status = ?, updated_at = ? WHERE id = ?', status, nowUtcIso(), id);
}

/**
 * Rebuild every alarm from the ledger + today's/tomorrow's pending instances.
 * Called on bootstrap and whenever the app returns to the foreground.
 */
export async function rescheduleAllAlarms(db: SQLiteDatabase): Promise<void> {
  await ensureScheduledAlarmsTable(db);
  // Cancel everything we know about first (ledger may reference dead ids).
  try {
    const rows = await db.getAllAsync<{ notification_id: string }>(
      'SELECT notification_id FROM scheduled_alarms'
    );
    for (const row of rows) {
      try {
        await Notifications.cancelScheduledNotificationAsync(row.notification_id);
      } catch {
        // ignore stale ids
      }
    }
    await db.execAsync('DELETE FROM scheduled_alarms');
  } catch (e) {
    console.warn('[checkoff] rescheduleAllAlarms cancel phase failed', e);
  }

  const today = localDateString();
  const tomorrow = addDays(today, 1);
  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM task_instances
       WHERE date IN (?, ?) AND alarm_time IS NOT NULL AND status = 'pending'`,
      today,
      tomorrow
    );
    for (const row of rows) {
      await scheduleTaskAlarm(db, rowToInstance(row));
    }
  } catch (e) {
    console.warn('[checkoff] rescheduleAllAlarms schedule phase failed', e);
  }
}

/**
 * Grace-window sweep: pending instances whose alarm fire time + grace passed
 * with no response are marked missed (actor 'auto'). Runs on bootstrap and
 * foreground; idempotent by the status='pending' filter.
 */
export async function processMissedAlarms(db: SQLiteDatabase, now: Date): Promise<void> {
  let graceMin = 15;
  try {
    const raw = await getMeta(db, META_KEYS.graceMin);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0) graceMin = parsed;
  } catch {
    // default stands
  }
  const today = localDateString(now);
  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM task_instances
       WHERE date <= ? AND alarm_time IS NOT NULL AND status = 'pending'`,
      today
    );
    for (const row of rows) {
      const instance = rowToInstance(row);
      const fireAt = alarmFireDate(instance);
      if (!fireAt) continue;
      if (fireAt.getTime() + graceMin * 60_000 < now.getTime()) {
        await setInstanceStatus(db, instance.id, 'missed');
        await cancelTaskAlarm(db, instance.id);
        await logEvent(db, {
          eventType: 'missed',
          actor: 'auto',
          taskInstanceId: instance.id,
          payload: { autoMissed: true, reason: 'no-response-after-grace' },
        });
      }
    }
  } catch (e) {
    console.warn('[checkoff] processMissedAlarms failed', e);
  }
}

/**
 * Apply a notification action button press. All writes go through logEvent;
 * every UPDATE stamps updated_at.
 */
export async function applyAlarmAction(
  db: SQLiteDatabase,
  instanceId: string,
  action: AlarmAction
): Promise<void> {
  const instance = await getInstance(db, instanceId);
  if (!instance) return;
  if (instance.status !== 'pending') return; // stale action; nothing to do

  if (action === 'done') {
    await setInstanceStatus(db, instanceId, 'done');
    await cancelTaskAlarm(db, instanceId);
    await logEvent(db, {
      eventType: 'completed',
      actor: 'alarm',
      taskInstanceId: instanceId,
      payload: { via: 'notification-action' },
    });
  } else if (action === 'skip') {
    await setInstanceStatus(db, instanceId, 'skipped');
    await cancelTaskAlarm(db, instanceId);
    await logEvent(db, {
      eventType: 'skipped',
      actor: 'alarm',
      taskInstanceId: instanceId,
    });
  } else {
    // snooze
    let snoozeMin = 9;
    try {
      const raw = await getMeta(db, META_KEYS.snoozeMin);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (!Number.isNaN(parsed) && parsed > 0) snoozeMin = parsed;
    } catch {
      // default stands
    }
    await cancelTaskAlarm(db, instanceId);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: instance.title,
          body: `Snoozed · ${snoozeMin} min`,
          categoryIdentifier: TASK_ALARM_CATEGORY,
          sound: ALARM_SOUND,
          data: { instanceId: instance.id, kind: 'task-alarm' } satisfies AlarmData,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: snoozeMin * 60,
        },
      });
    } catch (e) {
      console.warn('[checkoff] snooze schedule failed', e);
    }
    await logEvent(db, {
      eventType: 'scheduled',
      actor: 'alarm',
      taskInstanceId: instanceId,
      payload: { snoozed: true, minutes: snoozeMin },
    });
  }
}
