# CheckOff

A daily discipline system for one user. Serious instrument, not a game.
Fully offline. No accounts. No backend. No seeded content.

## Stack

Expo SDK 57 · TypeScript · Expo Router · expo-sqlite · Zustand (UI state only)
· expo-notifications (exact alarms) · expo-audio (alarm tone)
· expo-haptics · react-native-svg + react-native-reanimated (charts/motion)
· expo-sharing + expo-file-system (log export)

Notifications need a development/production build — they do not work in Expo Go.

## Project layout

```
src/
  app/                  Expo Router screens (every file here is a route)
    _layout.tsx         Root: SQLiteProvider + migrations + bootstrap
                        (settings hydration, instance generation, alarm
                        rescheduling, timer reconciliation, onboarding redirect,
                        foreground + restore-alarms deep-link handlers)
    (tabs)/_layout.tsx  Bottom tabs: Today / Calendar / Log / Stats
    (tabs)/index.tsx    Today's Focus
    (tabs)/calendar.tsx Month heatmap + day detail link
    (tabs)/log.tsx      Append-only log trail + JSON/CSV export
    (tabs)/stats.tsx    Streaks, rates, charts, weekly review
    day/[date].tsx      Single-day detail (tasks, timers, logs)
    onboarding.tsx      First-run setup (ships empty — user creates everything)
    add-task.tsx        Quick-add modal
    settings.tsx        Theme, haptics, grace/snooze windows, about
    timer.tsx           Focus timer (countdown / stopwatch)
  db/
    types.ts            Domain types mirroring the tables
    schema.ts           Versioned DDL (never edit a released migration)
    migrations.ts       Migration runner (PRAGMA user_version, WAL, FK on)
    log.ts              THE append-only log engine — insert + read only
    time.ts             UTC + device-offset time helpers (DST/travel safe)
    ids.ts              Local ID generation
    useDb.ts            Typed DB handle hook
    repos/              Per-entity write paths (categories, skills, templates,
                        instances, meta) — every write logs an event
  tasks/
    recurrence.ts       Template → instance generation, auto-miss sweep
    rotation.ts         Creative-skill rotation slot
  state/
    tasks.ts            Zustand: selected day + instances (DB is the truth)
    ui.ts               Zustand: theme, haptics, grace/snooze settings
  notifications/        Exact alarms, actions (Done/Snooze/Skip),
                        missed-after-grace sweep, boot restore
  timers/               Focus timer sessions, end-time alarms, reconciliation
  haptics/              Designed haptic vocabulary (not sprinkled)
  stats/queries.ts      Raw-SQL read helpers for calendar/analytics
  theme/tokens.ts       Dark-first palette, type scale, 8pt grid
  components/TaskForm.tsx  Shared task editor (onboarding + quick-add)
plugins/with-alarm-boot/  Config plugin: BOOT_COMPLETED receiver →
                          tap-to-restore-alarms notification
docs/NOTES.md           Notification/timer/battery/boot implementation notes
```

## Design decisions

1. **DB is the source of truth; Zustand is UI state only.** Stores never
   persist domain data — they read from SQLite and write through it.
2. **Append-only log.** Every action writes a `log_events` row with a precise
   timestamp: `created, edited, scheduled, alarm_fired, started, paused,
   completed, unchecked, skipped, missed, override, exported,
   streak_milestone…` Nothing is overwritten or deleted. The log module
   exposes no update/delete API by construction. If it isn't in the log,
   it didn't happen.
3. **Timestamps: UTC + offset.** Each event stores `ts_utc` (ISO-8601) and
   `ts_offset_min` (device offset at event time). History stays correct
   across timezone travel and DST changes; day-filters in SQL re-apply the
   *event-time* offset, not today's.
4. **Statuses flip, rows stay.** Task instances move pending → done / skipped
   / missed via updates + a log row; templates are disabled, never deleted
   by the UI.
5. **Versioned migrations, forward-only.** `migrateDb` runs on every launch
   via `SQLiteProvider onInit`, applies pending migrations in order, bumps
   `PRAGMA user_version`. Never edit a released migration.
6. **Recurrence is generated, never re-typed.** Enabled templates produce
   today's instances at app open/foreground (`INSERT OR IGNORE` on
   `UNIQUE(template_id, date)`); past-due pending instances become `missed`
   (actor `auto`).
7. **Streak rule (shown in the UI):** a day counts when it has at least one
   ritual and every ritual is done. Milestones 7/30/100 are logged once each.
8. **Alarms are exact and ledger-backed.** Each scheduled alarm is recorded
   in `scheduled_alarms`; `rescheduleAllAlarms` reconciles the OS schedule
   against the ledger on boot-tap, foreground, and timezone change.
   No response within the grace window (default 15 min) → `missed`.
9. **Timers are honest about app kill.** Elapsed time derives from
   `started_at_utc`; a scheduled end notification fires even if the app was
   killed, and `reconcileTimers` finalizes the session on next launch.
   See `docs/NOTES.md` for the full notes (battery optimization, boot,
   exact-alarm permission flow).
10. **Haptics are designed, not sprinkled.** One vocabulary module; every
    trigger mapped deliberately (check, final-ritual, uncheck, skip,
    timer start/end, alarm tick, escalating milestones) with intensity
    setting + global off.
11. **Native config via app.json + config plugins only.** No hand-edited
    `android/` or `ios/` (Continuous Native Generation).

## Development

```sh
npx expo install          # install deps (SDK-compatible versions)
npx tsc --noEmit          # typecheck — must be clean
npx expo-doctor           # diagnose config/deps
npx expo start            # dev server (use a dev build on device; Expo Go
                          # lacks notifications/haptics)
```

## Build the APK

Prerequisite: an Expo account for the EAS route (`npx eas-cli@latest login`).

**EAS (cloud, recommended):**
```sh
npx eas-cli@latest build --platform android --profile preview
```
The `preview` profile sets `android.buildType: apk` (see `eas.json`).
EAS returns a download URL — install on the phone directly (allow
"install unknown apps" once for the browser/package installer).

**Local (no Expo account):**
```sh
npx expo prebuild                    # generate android/
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```
Needs JDK 17 + Android SDK (platform + build-tools 35). Sign the APK
before distributing beyond your own device.

## Install on your phone

1. Transfer the APK to the phone (download link, USB, or messaging app).
2. Open it — Android asks to allow "Install unknown apps" for that source;
   allow once.
3. Open **CheckOff**, complete the 4-step onboarding (categories → tasks),
   grant notification + exact-alarm permission when asked.
4. Optional but recommended: Settings → Apps → CheckOff → Battery →
   "Unrestricted", so alarms and timers survive Doze. Details in
   `docs/NOTES.md`.
