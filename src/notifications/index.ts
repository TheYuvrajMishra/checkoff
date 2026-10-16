/**
 * CheckOff — notifications & full-screen alarm engine.
 *
 * End-to-end alarm architecture:
 * 1. High-importance Android channel (`checkoff-alarms`, MAX importance,
 *    bypassDnd, public lockscreen visibility, strong vibration pattern,
 *    custom `alarm.wav` sound).
 * 2. Exact DATE trigger with explicit `channelId: ALARM_CHANNEL_ID` so Android
 *    never routes task alarms to the silent default channel.
 * 3. Foreground attention loop: continuous looping audio via `expo-audio`
 *    (respecting the user's selected sound profile in Settings) + continuous
 *    OS vibration pattern (`Vibration.vibrate`) + haptic pulses.
 * 4. Full-screen in-app Alarm screen (`/alarm?instanceId=...`) launched
 *    automatically whenever an alarm fires while the app is open, when the
 *    in-app exact-time watcher detects a due alarm, or when the user taps the
 *    alarm notification from the shade / lockscreen.
 * 5. Every lifecycle event (`scheduled`, `alarm_fired`, `completed`, `skipped`,
 *    snoozed `scheduled`) writes to the append-only `log_events` table.
 */
import * as Notifications from 'expo-notifications';
import { Platform, Vibration } from 'react-native';
import { router } from 'expo-router';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { InstanceStatus, TaskInstance } from '../db/types';
import { logEvent } from '../db/log';
import { addDays, localDateString, nowUtcIso } from '../db/time';
import { getMeta, META_KEYS } from '../db/repos/meta';
import { useUiStore, type AlarmSoundId } from '../state/ui';
import { haptics } from '../haptics';

export const ALARM_CHANNEL_ID = 'checkoff-alarms';
export const TIMER_CHANNEL_ID = 'checkoff-timer';
export const TASK_ALARM_CATEGORY = 'task-alarm';
export const TIMER_END_CATEGORY = 'timer-end';
export const ALARM_SOUND = 'alarm.wav';

export type AlarmAction = 'done' | 'snooze' | 'skip';

interface AlarmData {
  kind: 'task-alarm';
  instanceId: string;
}

interface TimerEndData {
  kind: 'timer-end';
  timerSessionId: string;
}

type ScheduledNotificationData = AlarmData | TimerEndData;

function getNotificationData(
  notification: Notifications.Notification
): Partial<ScheduledNotificationData> | undefined {
  return notification.request.content.data as
    | Partial<ScheduledNotificationData>
    | undefined;
}

let notificationsDb: SQLiteDatabase | null = null;
let listenersRegistered = false;
let foregroundWatcherTimer: ReturnType<typeof setInterval> | null = null;

/** Tracks `instanceId@YYYY-MM-DDTHH:MM` already fired in this session to prevent double triggers. */
const firedThisSession = new Set<string>();
let activeAlarmInstanceId: string | null = null;

export function setNotificationsDb(db: SQLiteDatabase): void {
  notificationsDb = db;
}

export function getActiveAlarmInstanceId(): string | null {
  return activeAlarmInstanceId;
}

export function clearActiveAlarmInstanceId(): void {
  activeAlarmInstanceId = null;
}

// ---------------------------------------------------------------------------
// Alarm sound + vibration loop
// ---------------------------------------------------------------------------

let alarmPlayer: AudioPlayer | null = null;

const SOUND_RATES: Record<AlarmSoundId, number> = {
  pulse: 1.0,
  beacon: 0.8,
  chime: 1.25,
  industrial: 1.5,
};

function getAlarmPlayer(): AudioPlayer | null {
  if (alarmPlayer) return alarmPlayer;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require('../../assets/sounds/alarm.wav');
    alarmPlayer = createAudioPlayer(source);
    alarmPlayer.loop = true;
  } catch {
    alarmPlayer = null;
  }
  return alarmPlayer;
}

export async function playAlarmSound(): Promise<void> {
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch {
    // ignore
  }
  try {
    const player = getAlarmPlayer();
    if (!player) return;
    player.loop = true;
    const profile = useUiStore.getState().alarmSound ?? 'pulse';
    try {
      player.setPlaybackRate(SOUND_RATES[profile] ?? 1.0);
    } catch {
      // ignore if unsupported
    }
    player.seekTo(0);
    player.play();
  } catch {
    // never break flow
  }
}

export function stopAlarmSound(): void {
  try {
    alarmPlayer?.pause();
    alarmPlayer?.seekTo(0);
  } catch {
    // ignore
  }
}

let attentionTimer: ReturnType<typeof setInterval> | null = null;

export function stopAttentionLoop(): void {
  if (attentionTimer) {
    clearInterval(attentionTimer);
    attentionTimer = null;
  }
  try {
    Vibration.cancel();
  } catch {
    // ignore
  }
  stopAlarmSound();
}

export function startAttentionLoop(): void {
  stopAttentionLoop();
  void playAlarmSound();
  try {
    Vibration.vibrate([0, 500, 250, 500, 250, 500], true);
  } catch {
    // ignore
  }
  void haptics.alarmTick();
  let ticks = 1;
  const maxTicks = 30; // 60s at 2s cadence
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
// Navigation to full-screen in-app Alarm screen
// ---------------------------------------------------------------------------

export function openFullScreenAlarm(instanceId: string): void {
  if (!instanceId) return;
  if (activeAlarmInstanceId === instanceId) return;
  activeAlarmInstanceId = instanceId;
  try {
    router.push({
      pathname: '/alarm',
      params: { instanceId },
    });
  } catch (e) {
    console.warn('[checkoff] could not open /alarm screen', e);
  }
}

async function handleTaskAlarmTriggered(
  db: SQLiteDatabase,
  instanceId: string,
  openScreen: boolean
): Promise<void> {
  const instance = await getInstance(db, instanceId);
  if (!instance || instance.status !== 'pending' || instance.deleted) return;

  const sessionKey = `${instance.id}@${instance.date}T${instance.alarmTime ?? 'snooze'}`;
  const firstFireForSlot = !firedThisSession.has(sessionKey);
  if (firstFireForSlot) {
    firedThisSession.add(sessionKey);
    await logEvent(db, {
      eventType: 'alarm_fired',
      actor: 'alarm',
      taskInstanceId: instance.id,
      templateId: instance.templateId,
      payload: {
        kind: 'task-alarm',
        alarmTime: instance.alarmTime,
        date: instance.date,
      },
    }).catch(() => {});
  }

  startAttentionLoop();
  if (openScreen) {
    openFullScreenAlarm(instance.id);
  }
}

// ---------------------------------------------------------------------------
// Foreground watcher: catches exact-minute alarms while app is open
// ---------------------------------------------------------------------------

function startForegroundAlarmWatcher(): void {
  if (foregroundWatcherTimer) return;
  foregroundWatcherTimer = setInterval(() => {
    const db = notificationsDb;
    if (!db) return;
    void (async () => {
      try {
        const now = new Date();
        const today = localDateString(now);
        const rows = await db.getAllAsync<Record<string, unknown>>(
          `SELECT * FROM task_instances
           WHERE date = ? AND alarm_time IS NOT NULL AND status = 'pending' AND deleted = 0`,
          today
        );
        for (const r of rows) {
          const inst = rowToInstance(r);
          const fireAt = alarmFireDate(inst);
          if (!fireAt) continue;
          const diffMs = now.getTime() - fireAt.getTime();
          const sessionKey = `${inst.id}@${inst.date}T${inst.alarmTime ?? ''}`;
          // If fireAt arrived within the last 60 seconds and hasn't fired yet
          if (diffMs >= 0 && diffMs < 60_000 && !firedThisSession.has(sessionKey)) {
            await handleTaskAlarmTriggered(db, inst.id, true);
            break;
          }
        }
      } catch {
        // ignore background query errors
      }
    })();
  }, 3000);
}

// ---------------------------------------------------------------------------
// Permissions & Setup
// ---------------------------------------------------------------------------

function checkExactAlarmPermission(): void {
  try {
    if (Platform.OS !== 'android') return;
    const apiLevel =
      typeof Platform.Version === 'number'
        ? Platform.Version
        : parseInt(String(Platform.Version), 10);
    if (Number.isNaN(apiLevel) || apiLevel < 31) return;
  } catch {
    // ignore
  }
}

export async function setupNotifications(): Promise<void> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
  } catch (e) {
    console.warn('[checkoff] notification permission request failed', e);
  }

  checkExactAlarmPermission();

  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch (e) {
    console.warn('[checkoff] setAudioModeAsync failed', e);
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    }),
  });

  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
        name: 'Task Alarms (High Priority)',
        importance: Notifications.AndroidImportance.MAX,
        bypassDnd: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
        vibrationPattern: [0, 500, 250, 500, 250, 500],
        sound: ALARM_SOUND,
      });
    } catch (e) {
      console.warn('[checkoff] could not create alarm channel', e);
    }
    try {
      await Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
        name: 'Focus Timer',
        importance: Notifications.AndroidImportance.HIGH,
        enableVibrate: true,
        sound: ALARM_SOUND,
      });
    } catch (e) {
      console.warn('[checkoff] could not create timer channel', e);
    }
  }

  try {
    await Notifications.setNotificationCategoryAsync(TASK_ALARM_CATEGORY, [
      {
        identifier: 'done',
        buttonTitle: 'Done',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'snooze',
        buttonTitle: 'Snooze',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'skip',
        buttonTitle: 'Skip',
        options: { isDestructive: true, opensAppToForeground: false },
      },
    ]);
    await Notifications.setNotificationCategoryAsync(TIMER_END_CATEGORY, [
      {
        identifier: 'done',
        buttonTitle: 'Done',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'dismiss',
        buttonTitle: 'Dismiss',
        options: { opensAppToForeground: false },
      },
    ]);
  } catch (e) {
    console.warn('[checkoff] could not register notification categories', e);
  }

  startForegroundAlarmWatcher();

  if (!listenersRegistered) {
    listenersRegistered = true;

    Notifications.addNotificationReceivedListener((notification) => {
      const data = getNotificationData(notification);
      if (data?.kind !== 'task-alarm' && data?.kind !== 'timer-end') return;
      const db = notificationsDb;
      if (!db) {
        startAttentionLoop();
        return;
      }
      if (data.kind === 'task-alarm' && data.instanceId) {
        void handleTaskAlarmTriggered(db, data.instanceId, true);
      } else if (data.kind === 'timer-end' && data.timerSessionId) {
        startAttentionLoop();
        void logEvent(db, {
          eventType: 'alarm_fired',
          actor: 'alarm',
          timerSessionId: data.timerSessionId,
          payload: { kind: 'timer-end' },
        }).catch(() => {});
      }
    });

    Notifications.addNotificationResponseReceivedListener((response) => {
      const db = notificationsDb;
      if (!db) return;
      const data = getNotificationData(response.notification);
      const actionId = response.actionIdentifier;
      if (data?.kind === 'task-alarm' && data.instanceId) {
        if (actionId === 'done' || actionId === 'snooze' || actionId === 'skip') {
          stopAttentionLoop();
          void applyAlarmAction(db, data.instanceId, actionId).catch(() => {});
        } else {
          // User tapped the notification banner/lockscreen card -> open full-screen Alarm UI
          void handleTaskAlarmTriggered(db, data.instanceId, true);
        }
      } else {
        stopAttentionLoop();
      }
    });

    // Cold-start launch from tapping a notification
    void Notifications.getLastNotificationResponseAsync()
      .then((lastResponse) => {
        if (!lastResponse || !notificationsDb) return;
        const data = getNotificationData(lastResponse.notification);
        const actionId = lastResponse.actionIdentifier;
        if (data?.kind === 'task-alarm' && data.instanceId) {
          if (actionId === 'done' || actionId === 'snooze' || actionId === 'skip') {
            void applyAlarmAction(notificationsDb, data.instanceId, actionId);
          } else {
            void handleTaskAlarmTriggered(notificationsDb, data.instanceId, true);
          }
        }
      })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// scheduled_alarms ledger
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

export function alarmFireDate(
  instance: Pick<TaskInstance, 'date' | 'alarmTime'>
): Date | null {
  if (!instance.alarmTime) return null;
  const [h, m] = instance.alarmTime.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const [y, mo, d] = instance.date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

export async function scheduleTaskAlarm(
  db: SQLiteDatabase,
  instance: TaskInstance
): Promise<void> {
  await ensureScheduledAlarmsTable(db);
  const fireAt = alarmFireDate(instance);
  if (!fireAt || fireAt.getTime() <= Date.now()) return;

  const targetUtc = nowUtcIso(fireAt);
  const existingRow = await db
    .getFirstAsync<{ fire_at_utc: string }>(
      'SELECT fire_at_utc FROM scheduled_alarms WHERE instance_id = ?',
      instance.id
    )
    .catch(() => null);

  try {
    await cancelTaskAlarm(db, instance.id);
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `ALARM · ${instance.title}`,
        body: `Scheduled for ${instance.alarmTime} · Tap to open or choose Done / Snooze / Skip`,
        categoryIdentifier: TASK_ALARM_CATEGORY,
        sound: ALARM_SOUND,
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 500, 250, 500, 250, 500],
        sticky: true,
        data: {
          instanceId: instance.id,
          kind: 'task-alarm',
        } satisfies AlarmData,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: ALARM_CHANNEL_ID,
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
      targetUtc
    );

    // Log 'scheduled' when this alarm time is newly scheduled or changed
    if (!existingRow || existingRow.fire_at_utc !== targetUtc) {
      await logEvent(db, {
        eventType: 'scheduled',
        actor: 'user',
        taskInstanceId: instance.id,
        templateId: instance.templateId,
        payload: {
          alarmTime: instance.alarmTime,
          date: instance.date,
          fireAtUtc: targetUtc,
        },
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[checkoff] scheduleTaskAlarm failed', e);
  }
}

export async function cancelTaskAlarm(
  first: SQLiteDatabase | string,
  second?: string
): Promise<void> {
  const db = (typeof first === 'object' && first !== null ? first : notificationsDb) as SQLiteDatabase | null;
  const instanceId = typeof first === 'string' ? first : second;
  if (!db || !instanceId) return;

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
        // ignore stale id
      }
    }
    await db.runAsync(
      'DELETE FROM scheduled_alarms WHERE instance_id = ?',
      instanceId
    );
  } catch {
    // never throws
  }
}

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
    priority: (row.priority as TaskInstance['priority']) ?? 'medium',
    status: row.status as InstanceStatus,
    deleted: (row.deleted as number) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getInstance(
  db: SQLiteDatabase,
  id: string
): Promise<TaskInstance | null> {
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
  await db.runAsync(
    'UPDATE task_instances SET status = ?, updated_at = ? WHERE id = ?',
    status,
    nowUtcIso(),
    id
  );
}

export async function rescheduleAllAlarms(db: SQLiteDatabase): Promise<void> {
  await ensureScheduledAlarmsTable(db);
  const previousMap = new Map<string, string>();
  try {
    const rows = await db.getAllAsync<{
      instance_id: string;
      notification_id: string;
      fire_at_utc: string;
    }>('SELECT instance_id, notification_id, fire_at_utc FROM scheduled_alarms');
    for (const row of rows) {
      previousMap.set(row.instance_id, row.fire_at_utc);
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
       WHERE date IN (?, ?) AND alarm_time IS NOT NULL AND status = 'pending' AND deleted = 0`,
      today,
      tomorrow
    );
    for (const row of rows) {
      const instance = rowToInstance(row);
      const fireAt = alarmFireDate(instance);
      if (!fireAt || fireAt.getTime() <= Date.now()) continue;
      const targetUtc = nowUtcIso(fireAt);
      // Pre-seed previous fire_at_utc if unchanged so we don't duplicate 'scheduled' log
      if (previousMap.get(instance.id) === targetUtc) {
        await db.runAsync(
          `INSERT OR REPLACE INTO scheduled_alarms (instance_id, notification_id, fire_at_utc)
           VALUES (?, '', ?)`,
          instance.id,
          targetUtc
        );
      }
      await scheduleTaskAlarm(db, instance);
    }
  } catch (e) {
    console.warn('[checkoff] rescheduleAllAlarms schedule phase failed', e);
  }
}

export async function processMissedAlarms(
  db: SQLiteDatabase,
  now: Date
): Promise<void> {
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
       WHERE date <= ? AND alarm_time IS NOT NULL AND status = 'pending' AND deleted = 0`,
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
          templateId: instance.templateId,
          payload: { autoMissed: true, reason: 'no-response-after-grace' },
        });
      }
    }
  } catch (e) {
    console.warn('[checkoff] processMissedAlarms failed', e);
  }
}

export async function applyAlarmAction(
  db: SQLiteDatabase,
  instanceId: string,
  action: AlarmAction
): Promise<void> {
  stopAttentionLoop();
  clearActiveAlarmInstanceId();

  const instance = await getInstance(db, instanceId);
  if (!instance) return;
  if (instance.status !== 'pending') return;

  if (action === 'done') {
    await setInstanceStatus(db, instanceId, 'done');
    await cancelTaskAlarm(db, instanceId);
    await logEvent(db, {
      eventType: 'completed',
      actor: 'alarm',
      taskInstanceId: instanceId,
      templateId: instance.templateId,
      payload: { via: 'alarm-action', alarmTime: instance.alarmTime },
    });
  } else if (action === 'skip') {
    await setInstanceStatus(db, instanceId, 'skipped');
    await cancelTaskAlarm(db, instanceId);
    await logEvent(db, {
      eventType: 'skipped',
      actor: 'alarm',
      taskInstanceId: instanceId,
      templateId: instance.templateId,
      payload: { via: 'alarm-action', alarmTime: instance.alarmTime },
    });
  } else {
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
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `ALARM · ${instance.title}`,
          body: `Snoozed · ${snoozeMin} min`,
          categoryIdentifier: TASK_ALARM_CATEGORY,
          sound: ALARM_SOUND,
          priority: Notifications.AndroidNotificationPriority.MAX,
          vibrate: [0, 500, 250, 500, 250, 500],
          sticky: true,
          data: {
            instanceId: instance.id,
            kind: 'task-alarm',
          } satisfies AlarmData,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: snoozeMin * 60,
          channelId: ALARM_CHANNEL_ID,
        },
      });
      const snoozeFireAt = new Date(Date.now() + snoozeMin * 60_000);
      await db.runAsync(
        `INSERT INTO scheduled_alarms (instance_id, notification_id, fire_at_utc)
         VALUES (?, ?, ?)
         ON CONFLICT(instance_id) DO UPDATE SET
           notification_id = excluded.notification_id,
           fire_at_utc = excluded.fire_at_utc`,
        instance.id,
        notificationId,
        nowUtcIso(snoozeFireAt)
      );
    } catch (e) {
      console.warn('[checkoff] snooze schedule failed', e);
    }
    await logEvent(db, {
      eventType: 'scheduled',
      actor: 'alarm',
      taskInstanceId: instanceId,
      templateId: instance.templateId,
      payload: { snoozed: true, minutes: snoozeMin },
    });
  }
}
