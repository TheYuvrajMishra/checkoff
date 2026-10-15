# CheckOff Phase 3 — implementation notes

Alarms, timers, haptics, settings + timer screens, boot plugin, alarm sound.
All Expo APIs verified against the v57 versioned docs and the installed
package sources (expo-notifications 57.0.23, expo-haptics 57.0.3,
expo-audio 57.0.5) — never from training memory.

## 1. Notification architecture

- **Task alarms**: `scheduleNotificationAsync` with a **DATE trigger**
  (`{ type: SchedulableTriggerInputTypes.DATE, date }`). On Android the native
  scheduler calls `AlarmManagerCompat.setExactAndAllowWhileIdle` when the app
  can schedule exact alarms (API < 31, or API 31+ with SCHEDULE_EXACT_ALARM
  granted), otherwise it degrades to `setAndAllowWhileIdle` — an inexact
  window. Verified in `ExpoSchedulingDelegate.kt`. Nothing crashes either way.
- **Snooze**: TIME_INTERVAL trigger (`{ type: TIME_INTERVAL, seconds }`).
- **Timer end**: DATE trigger with `channelId: 'checkoff-timer'` in the
  trigger input (v57 `DateTriggerInput.channelId`).
- **Timer ongoing anchor**: `ChannelAwareTriggerInput` (`{ channelId }`,
  immediate delivery) + `sticky: true` (v57-supported, maps to Android
  `isOngoing`) + `sound: false` + `autoDismiss: false` on the LOW-importance
  `checkoff-timer` channel.
- **Channels** (Android): `checkoff-alarms` ("Task alarms", importance MAX,
  vibrate, custom sound `alarm.wav`), `checkoff-timer` ("Timer", LOW, silent).
  Channel sound is a raw-resource filename resolved via `SoundResolver`
  (basename of the wav); wired through the expo-notifications config plugin
  `sounds` array (`assets/sounds/alarm.wav` -> `res/raw/alarm.wav`).
- **Categories**: `task-alarm` with actions `done` / `snooze` / `skip`
  (skip is destructive); `timer-end` with `done` / `dismiss`. Actions carry
  `opensAppToForeground` flags; alarm actions do NOT force-foreground the app —
  they apply silently via `applyAlarmAction`. Note: v57 docs warn against `-`
  in category identifiers, but Android's `ExpoNotificationBuilder` reads
  `categoryIdentifier` verbatim (verified native), so the contracted ids are
  kept. iOS is not a target for this build.
- **Foreground receipt**: `setNotificationHandler` shows banner + list but
  `shouldPlaySound: false` (we play our own looped `alarm.wav` via expo-audio,
  avoiding double audio). The received listener then starts a haptic tick loop
  (`haptics.alarmTick()` every 2s, max 30s), plays the looped sound, and logs
  `alarm_fired` (actor `alarm`). Any notification response stops the loop.
- **Ledger**: `scheduled_alarms(instance_id PK, notification_id, fire_at_utc)`
  mirrors what the OS holds, so JS can cancel/reconcile. `rescheduleAllAlarms`
  cancels everything known, then schedules today + tomorrow's pending
  alarmed instances. `processMissedAlarms` flips pending instances past
  `alarm_time + graceMin` to `missed` (actor `auto`, event `missed`).
- **Exact-alarm permission**: v57 exposes NO JS API for the grant state, so
  `setupNotifications` warns (never throws) on Android API 31+ with the exact
  settings path (`Settings > Apps > CheckOff > Alarms & reminders`).

## 2. Background timer design + honest limits

Timers are **time-derived, not process-derived**. The DB row
(`started_at_utc`) is the clock; the UI derives elapsed/remaining from it.
Consequences:

- A countdown's end is delivered by the OS notification even if the app was
  killed — no JS runs. On next launch, `reconcileTimers()` finalizes
  countdowns past their planned end and stopwatches older than 12h
  (actor `auto`, payload `{reconciled: true[, capped: true]}`).
- Pause is honest: it cancels the end notification, and resume shifts
  `started_at_utc` forward by the paused duration (`shiftTimerStart`) then
  re-schedules the end (`scheduleTimerEndNotification`). A pause-then-kill
  still reconciles correctly because the row is the truth.
- The sticky "Timer running" notification is a visible anchor, NOT a
  keep-alive — no foreground service is claimed (see §3).
- One active timer at a time; a new `startTimer` finalizes the previous as
  `superseded` (actor `auto`, `completed: false`).

## 3. Battery optimization

- **SCHEDULE_EXACT_ALARM** (Android 12+): declared in app.json; it is a
  user-grantable special permission ("Alarms & reminders"), not a runtime
  prompt the app can fire. `setupNotifications` logs the settings path on
  API 31+. Do not auto-request — there is no request API; the OS settings page
  is the only route.
- **REQUEST_IGNORE_BATTERY_OPTIMIZATIONS**: deliberately NOT requested and
  NOT auto-fired (Play policy discourages it). If alarms are delayed on
  aggressive OEM skins, the user-facing guidance is: *Settings > Apps >
  CheckOff > Battery > Unrestricted*. Document this in user-facing help, do
  not code a prompt.
- **Foreground-service types**: `FOREGROUND_SERVICE` +
  `FOREGROUND_SERVICE_DATA_SYNC` are declared in app.json (from the project
  template), but Phase 3 starts no foreground service — the declarations are
  inert. If a future phase adds one, it must call `startForeground` with a
  matching `foregroundServiceType` or the OS will kill it.

## 4. Boot rescheduling

- expo-notifications **natively** re-arms scheduled notifications on
  `BOOT_COMPLETED` (`NotificationsService` listens for BOOT_COMPLETED /
  REBOOT / QUICKBOOT_POWERON / MY_PACKAGE_REPLACED and calls
  `onSetupScheduledNotifications` — verified in the v57 native source). So the
  common case needs no app code at all.
- `plugins/with-alarm-boot` adds a belt-and-braces `AlarmBootReceiver`
  (manifest-registered, Kotlin file injected via `withDangerousMod`) that posts
  a high-priority "Device restarted — tap to restore your task alarms"
  notification. Tap opens `checkoff://restore-alarms`; bootstrap then runs
  `rescheduleAllAlarms()` + `processMissedAlarms()` against the
  `scheduled_alarms` ledger.
- Deliberately no headless JS on boot: Android 12+ will not reliably run the
  JS engine from a background receiver, so receiver -> notification -> tap ->
  full bootstrap is the honest pattern. One notification per reboot is the
  only UX cost.

## 5. DST / timezone

- Alarms are scheduled from local `date + alarm_time` interpreted on the
  device at schedule time (`new Date(y, mo, d, h, m)` — device-local). The
  ledger stores `fire_at_utc` for forensics; history rows keep
  `ts_offset_min` at event time (Phase 1), so travel/DST never rewrites the
  past.
- If the timezone changes, already-scheduled OS alarms keep their absolute
  instant (correct for "9:00 alarm" semantics only after a reschedule).
  `rescheduleAllAlarms` runs on every foreground/bootstrap, which covers the
  common travel case. A dedicated `ACTION_TIMEZONE_CHANGED` hook is a future
  improvement, not wired in Phase 3.

## 6. Haptic design

| Trigger | Pattern | Rationale |
|---|---|---|
| Check a task | `impact Light` ×1 | Acknowledgement, not celebration |
| Final ritual complete | `impact Light`, 90ms, `notification Success` | Two-beat "sealed" feel |
| Uncheck | `impact Soft` ×1 | Reversal is quiet (Soft exists in v57 — verified) |
| Skip | `notification Warning` ×1 | Deliberate pass; distinct from success |
| Timer start | `impact Medium` ×1 | Firm commitment |
| Timer end | `impact Heavy`, 140ms, `impact Heavy` | Unmissable stop |
| Alarm tick | `impact Medium` ×1 (caller repeats 2s × ≤30s) | Insistent but not alarming |
| Milestone L1 | `impact Medium` ×1 | Small win |
| Milestone L2 | `impact Medium`, 140ms, `impact Heavy` | Escalation |
| Milestone L3 | `impact Heavy` ×3, 160ms gaps | Rare; allowed to be loud |

Intensity `light` downgrades Heavy → Medium; `strong` keeps authored values.
`configureHaptics({enabled, intensity})` sets module state. Every haptic call
is try/catch-guarded and no-ops when disabled — haptics never throw.

## Coordinator bootstrap wiring (Phase 3 exports)

Call in this order on launch (and on `checkoff://restore-alarms` deep link):

1. `setNotificationsDb(db)` — from `src/notifications/index.ts`
2. `await setupNotifications()`
3. `await rescheduleAllAlarms(db)`
4. `await processMissedAlarms(db, new Date())`
5. `await reconcileTimers(db)` — from `src/timers/index.ts`
6. `configureHaptics({ enabled: ui.hapticsEnabled, intensity: ui.hapticIntensity })` —
   from `src/haptics/index.ts` (after hydrating the UI store from meta)

Other exports the coordinator may need:
- `src/notifications`: `scheduleTaskAlarm`, `cancelTaskAlarm`,
  `applyAlarmAction`, `alarmFireDate`, `ALARM_CHANNEL_ID`,
  `TIMER_CHANNEL_ID`, `TASK_ALARM_CATEGORY`, `TIMER_END_CATEGORY`
- `src/timers`: `startTimer`, `stopTimer`, `getActiveTimer`,
  `reconcileTimers`, `shiftTimerStart`, `scheduleTimerEndNotification`,
  `timerNotificationIds`, `StartTimerInput`
- `src/haptics`: `haptics`, `configureHaptics`, `HapticIntensity`

## Files written (Phase 3)

- `src/notifications/index.ts` — setup, channels, categories, listeners,
  schedule/cancel/reschedule, missed sweep, alarm actions
- `src/timers/index.ts` — start/stop/active/reconcile + pause/resume helpers
- `src/haptics/index.ts` — haptic vocabulary + intensity config
- `src/app/settings.tsx` — theme, haptics, grace, snooze, about
- `src/app/timer.tsx` — countdown/stopwatch screen (route `timer`)
- `plugins/with-alarm-boot/index.js` — manifest receiver + Kotlin source injection
- `assets/sounds/alarm.wav` — 2.4s, 44.1kHz mono 16-bit, 211KB
- `docs/NOTES.md` — this file
- `app.json` — added `expo-notifications` plugin (`sounds`) +
  `./plugins/with-alarm-boot` to the plugins array (permissions untouched)

## Verification

- `npx tsc --noEmit` — clean (see final report)
- `npx expo-doctor` — reported below; no new issues from Phase 3 files
- Runtime behavior (exact alarm fire, boot restore, channel sound) needs a
  device build (`eas build --profile preview`); the VM cannot run Android.
