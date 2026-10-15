/**
 * CheckOff — timer screen (route: "timer").
 *
 * Params (useLocalSearchParams): { instanceId?: string; skillId?: string }.
 *
 * Timer state lives in the DB (timer_sessions), not in this component, so the
 * screen survives navigation: reopening it re-attaches to the active session.
 * Displayed time is always derived from started_at_utc. Pause compensates by
 * shifting started_at_utc forward and re-scheduling the end notification, so
 * a paused-then-killed session still reconciles honestly on next launch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useDb } from '../db/useDb';
import { logEvent } from '../db/log';
import { nowUtcIso } from '../db/time';
import type { TimerMode, TimerSession } from '../db/types';
import {
  getActiveTimer,
  scheduleTimerEndNotification,
  shiftTimerStart,
  startTimer,
  stopTimer,
  timerNotificationIds,
} from '../timers';
import { haptics } from '../haptics';
import { useUiStore } from '../state/ui';
import { dark, light, space, TAP, type as type } from '../theme/tokens';

const DURATIONS = [5, 15, 25, 30, 45, 60, 90];

interface SkillChip {
  id: string;
  name: string;
}

interface InstanceInfo {
  id: string;
  title: string;
  categoryId: string | null;
  status: string;
}

type Phase = 'loading' | 'setup' | 'running' | 'paused' | 'finished';

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function TimerScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ instanceId?: string; skillId?: string }>();
  const theme = useUiStore((s) => s.theme);
  const palette = theme === 'dark' ? dark : light;

  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<TimerSession | null>(null);
  const [instance, setInstance] = useState<InstanceInfo | null>(null);
  const [mode, setMode] = useState<TimerMode>('countdown');
  const [durationMin, setDurationMin] = useState(25);
  const [skills, setSkills] = useState<SkillChip[]>([]);
  const [skillId, setSkillId] = useState<string | null>(params.skillId ?? null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [finishedSession, setFinishedSession] = useState<TimerSession | null>(null);
  const [markedDone, setMarkedDone] = useState(false);

  const pauseStartRef = useRef<number | null>(null);
  const autoStoppedRef = useRef(false);

  const loadInstance = useCallback(
    async (id: string): Promise<InstanceInfo | null> => {
      const row = await db.getFirstAsync<Record<string, unknown>>(
        'SELECT id, title, category_id, status FROM task_instances WHERE id = ?',
        id
      );
      if (!row) return null;
      return {
        id: row.id as string,
        title: row.title as string,
        categoryId: (row.category_id as string) ?? null,
        status: row.status as string,
      };
    },
    [db]
  );

  const loadSkills = useCallback(
    async (categoryId: string | null) => {
      if (!categoryId) {
        setSkills([]);
        return;
      }
      const rows = await db.getAllAsync<Record<string, unknown>>(
        'SELECT id, name FROM skills WHERE category_id = ? ORDER BY name ASC',
        categoryId
      );
      setSkills(rows.map((r) => ({ id: r.id as string, name: r.name as string })));
    },
    [db]
  );

  // Bootstrap: re-attach to any active session, else set up for the instance.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const active = await getActiveTimer(db);
        if (cancelled) return;
        if (active) {
          const info = active.taskInstanceId ? await loadInstance(active.taskInstanceId) : null;
          if (cancelled) return;
          setSession(active);
          setInstance(info);
          setMode(active.mode);
          if (info?.categoryId) await loadSkills(info.categoryId);
          setPhase('running');
          return;
        }
        if (params.instanceId) {
          const info = await loadInstance(params.instanceId);
          if (cancelled) return;
          if (info) {
            setInstance(info);
            await loadSkills(info.categoryId);
          }
        }
        setPhase('setup');
      } catch {
        if (!cancelled) setPhase('setup');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, loadInstance, loadSkills, params.instanceId]);

  // 500ms tick; derived from DB start time.
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [phase]);

  const startedMs = session ? new Date(session.startedAtUtc).getTime() : 0;
  const elapsedMs = phase === 'running' || phase === 'paused' ? nowMs - startedMs : 0;
  const remainingMs =
    session?.mode === 'countdown' && session.plannedMin
      ? session.plannedMin * 60_000 - elapsedMs
      : 0;

  const handleStart = useCallback(async () => {
    if (!instance) return;
    await haptics.timerStart();
    try {
      const s = await startTimer(db, {
        taskInstanceId: instance.id,
        mode,
        plannedMin: mode === 'countdown' ? durationMin : undefined,
        skillId,
      });
      autoStoppedRef.current = false;
      setSession(s);
      setNowMs(Date.now());
      setPhase('running');
    } catch (e) {
      console.warn('[checkoff] startTimer failed', e);
    }
  }, [db, instance, mode, durationMin, skillId]);

  const handleStop = useCallback(
    async (completed: boolean) => {
      if (!session) return;
      try {
        const s = await stopTimer(db, session.id, { completed, skillId });
        await haptics.timerEnd();
        setFinishedSession(s);
        setSession(null);
        setPhase('finished');
      } catch (e) {
        console.warn('[checkoff] stopTimer failed', e);
      }
    },
    [db, session, skillId]
  );

  // Auto-stop a countdown that hits zero while the screen is open.
  useEffect(() => {
    if (phase === 'running' && session?.mode === 'countdown' && remainingMs <= 0 && !autoStoppedRef.current) {
      autoStoppedRef.current = true;
      void handleStop(true);
    }
  }, [phase, session, remainingMs, handleStop]);

  const handlePause = useCallback(async () => {
    if (!session || phase !== 'running') return;
    pauseStartRef.current = Date.now();
    try {
      await Notifications.cancelScheduledNotificationAsync(timerNotificationIds(session.id).end);
    } catch {
      // ignore
    }
    await logEvent(db, {
      eventType: 'paused',
      actor: 'user',
      taskInstanceId: session.taskInstanceId,
      timerSessionId: session.id,
      payload: { mode: session.mode },
    }).catch(() => {});
    setPhase('paused');
  }, [db, session, phase]);

  const handleResume = useCallback(async () => {
    if (!session || phase !== 'paused' || pauseStartRef.current == null) return;
    const pausedMs = Date.now() - pauseStartRef.current;
    pauseStartRef.current = null;
    try {
      const shifted = await shiftTimerStart(db, session.id, pausedMs);
      await scheduleTimerEndNotification(db, session.id);
      await logEvent(db, {
        eventType: 'resumed',
        actor: 'user',
        taskInstanceId: session.taskInstanceId,
        timerSessionId: session.id,
        payload: { mode: session.mode, pausedMs },
      }).catch(() => {});
      setSession(shifted);
      setNowMs(Date.now());
      setPhase('running');
    } catch (e) {
      console.warn('[checkoff] resume failed', e);
    }
  }, [db, session, phase]);

  const handleMarkDone = useCallback(async () => {
    if (!instance || markedDone) return;
    try {
      await db.runAsync(`UPDATE task_instances SET status = 'done', updated_at = ? WHERE id = ?`, nowUtcIso(), instance.id);
      await logEvent(db, {
        eventType: 'completed',
        actor: 'user',
        taskInstanceId: instance.id,
        payload: { via: 'timer-screen' },
      });
      setMarkedDone(true);
      setInstance({ ...instance, status: 'done' });
    } catch (e) {
      console.warn('[checkoff] mark-done failed', e);
    }
  }, [db, instance, markedDone]);

  const styles = makeStyles(palette);
  const displayMs = session?.mode === 'countdown' ? remainingMs : elapsedMs;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Timer</Text>
      {instance && <Text style={styles.instanceTitle}>{instance.title}</Text>}

      {phase === 'loading' && <Text style={styles.dim}>Loading…</Text>}

      {phase === 'setup' && (
        <>
          {!instance && <Text style={styles.dim}>No task selected.</Text>}
          <Text style={styles.label}>Mode</Text>
          <View style={styles.segment}>
            {(['countdown', 'stopwatch'] as TimerMode[]).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="button"
                onPress={() => setMode(m)}
                style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                  {m === 'countdown' ? 'Countdown' : 'Stopwatch'}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === 'countdown' && (
            <>
              <Text style={styles.label}>Duration</Text>
              <View style={styles.chipRow}>
                {DURATIONS.map((d) => (
                  <Pressable
                    key={d}
                    accessibilityRole="button"
                    onPress={() => setDurationMin(d)}
                    style={[styles.chip, durationMin === d && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, durationMin === d && styles.chipTextActive]}>
                      {d}m
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {skills.length > 0 && (
            <>
              <Text style={styles.label}>Attribute practice</Text>
              <View style={styles.chipRow}>
                {skills.map((s) => (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    onPress={() => setSkillId(skillId === s.id ? null : s.id)}
                    style={[styles.chip, skillId === s.id && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, skillId === s.id && styles.chipTextActive]}>
                      {s.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={handleStart}
            disabled={!instance}
            style={[styles.primaryBtn, !instance && styles.btnDisabled]}
          >
            <Text style={styles.primaryBtnText}>Start</Text>
          </Pressable>
        </>
      )}

      {(phase === 'running' || phase === 'paused') && session && (
        <>
          <Text style={[styles.clock, styles.tabular]}>
            {formatClock(phase === 'paused' ? elapsedMs : displayMs)}
          </Text>
          <Text style={styles.dim}>
            {session.mode === 'countdown'
              ? phase === 'paused'
                ? 'Paused'
                : 'Remaining'
              : phase === 'paused'
                ? 'Paused'
                : 'Elapsed'}
          </Text>
          <View style={styles.btnRow}>
            {phase === 'running' ? (
              <Pressable accessibilityRole="button" onPress={handlePause} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Pause</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={handleResume} style={styles.primaryBtnFlex}>
                <Text style={styles.primaryBtnText}>Resume</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" onPress={() => handleStop(true)} style={styles.dangerBtn}>
              <Text style={styles.dangerBtnText}>Stop</Text>
            </Pressable>
          </View>
        </>
      )}

      {phase === 'finished' && finishedSession && (
        <>
          <Text style={styles.clock}>Done</Text>
          <Text style={styles.dim}>
            {formatClock(
              (new Date(finishedSession.endedAtUtc ?? Date.now()).getTime() -
                new Date(finishedSession.startedAtUtc).getTime())
            )}{' '}
            focused
          </Text>
          {instance && instance.status !== 'done' && !markedDone && (
            <Pressable accessibilityRole="button" onPress={handleMarkDone} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Mark task done</Text>
            </Pressable>
          )}
          {markedDone && <Text style={styles.success}>Task marked done.</Text>}
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(p: typeof dark) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: p.bg },
    content: { padding: space(2), paddingBottom: space(6) },
    title: { ...type.h1, color: p.text, marginBottom: space(1) },
    instanceTitle: { ...type.h2, color: p.textDim, marginBottom: space(3) },
    label: { ...type.caption, color: p.textFaint, textTransform: 'uppercase', marginTop: space(2), marginBottom: space(1) },
    dim: { ...type.body, color: p.textDim, marginTop: space(1) },
    success: { ...type.body, color: p.success, marginTop: space(2) },
    clock: { ...type.clock, color: p.text, textAlign: 'center', marginTop: space(4) },
    tabular: { fontVariant: ['tabular-nums'] },
    segment: { flexDirection: 'row', backgroundColor: p.surface2, borderRadius: 10, padding: 4 },
    segmentBtn: {
      flex: 1,
      minHeight: TAP,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBtnActive: { backgroundColor: p.accent },
    segmentText: { ...type.body, color: p.textDim, fontWeight: '600' },
    segmentTextActive: { color: p.onAccent },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
    chip: {
      minHeight: TAP,
      paddingHorizontal: space(2),
      borderRadius: 20,
      borderWidth: 1,
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: p.accentDim, borderColor: p.accent },
    chipText: { ...type.body, color: p.textDim, fontWeight: '600' },
    chipTextActive: { color: p.accent },
    primaryBtn: {
      minHeight: TAP,
      backgroundColor: p.accent,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space(4),
    },
    primaryBtnFlex: {
      flex: 1,
      minHeight: TAP,
      backgroundColor: p.accent,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: { ...type.body, color: p.onAccent, fontWeight: '700' },
    btnDisabled: { opacity: 0.4 },
    secondaryBtn: {
      flex: 1,
      minHeight: TAP,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryBtnText: { ...type.body, color: p.text, fontWeight: '600' },
    dangerBtn: {
      flex: 1,
      minHeight: TAP,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dangerBtnText: { ...type.body, color: p.danger, fontWeight: '600' },
    btnRow: { flexDirection: 'row', gap: space(2), marginTop: space(4) },
  });
}
