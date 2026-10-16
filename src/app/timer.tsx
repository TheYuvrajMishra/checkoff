/**
 * CheckOff — focus timer screen (route: "timer").
 *
 * Params (useLocalSearchParams): { instanceId?: string; skillId?: string }.
 *
 * Uses Slider with detents for duration selection, MetallicText for the
 * tabular clock display, and supports starting from either a task instance
 * or a standalone skill slot.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Check, Pause, Play, Square, X } from 'lucide-react-native';
import { useDb } from '../db/useDb';
import { logEvent } from '../db/log';
import { localDateString, nowUtcIso } from '../db/time';
import { createTemplate } from '../db/repos/templates';
import { createInstance } from '../db/repos/instances';
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
import { cancelTaskAlarm } from '../notifications';
import { useUiStore } from '../state/ui';
import { dark, light, radius, space, TAP, type } from '../theme/tokens';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { MetallicText } from '../components/MetallicText';
import { PressableScale } from '../components/PressableScale';
import { Slider } from '../components/Slider';

const DURATIONS = [5, 15, 25, 30, 45, 60, 90];

interface SkillChip {
  id: string;
  name: string;
  categoryId: string | null;
}

interface InstanceInfo {
  id: string;
  title: string;
  categoryId: string | null;
  status: string;
  durationMin: number;
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
  const themeName = useUiStore((s) => s.theme);
  const palette = themeName === 'light' ? light : dark;

  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<TimerSession | null>(null);
  const [instance, setInstance] = useState<InstanceInfo | null>(null);
  const [mode, setMode] = useState<TimerMode>('countdown');
  const [durationMin, setDurationMin] = useState(25);
  const [skills, setSkills] = useState<SkillChip[]>([]);
  const [skillId, setSkillId] = useState<string | null>(
    params.skillId && params.skillId.length > 0 ? params.skillId : null
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [finishedSession, setFinishedSession] = useState<TimerSession | null>(null);
  const [markedDone, setMarkedDone] = useState(false);

  const pauseStartRef = useRef<number | null>(null);
  const autoStoppedRef = useRef(false);

  const loadInstance = useCallback(
    async (id: string): Promise<InstanceInfo | null> => {
      if (!id) return null;
      const row = await db.getFirstAsync<Record<string, unknown>>(
        'SELECT id, title, category_id, status, duration_min FROM task_instances WHERE id = ?',
        id
      );
      if (!row) return null;
      return {
        id: row.id as string,
        title: row.title as string,
        categoryId: (row.category_id as string) ?? null,
        status: row.status as string,
        durationMin: Number(row.duration_min ?? 25),
      };
    },
    [db]
  );

  const loadSkills = useCallback(
    async (categoryId: string | null) => {
      const rows = categoryId
        ? await db.getAllAsync<Record<string, unknown>>(
            'SELECT id, name, category_id FROM skills WHERE category_id = ? ORDER BY name ASC',
            categoryId
          )
        : await db.getAllAsync<Record<string, unknown>>(
            'SELECT id, name, category_id FROM skills ORDER BY name ASC'
          );
      setSkills(
        rows.map((r) => ({
          id: r.id as string,
          name: r.name as string,
          categoryId: (r.category_id as string) ?? null,
        }))
      );
    },
    [db]
  );

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
          await loadSkills(info?.categoryId ?? null);
          setPhase('running');
          return;
        }
        if (params.instanceId) {
          const info = await loadInstance(params.instanceId);
          if (cancelled) return;
          if (info) {
            setInstance(info);
            setDurationMin(Math.max(5, Math.min(180, info.durationMin || 25)));
            await loadSkills(info.categoryId);
          } else {
            await loadSkills(null);
          }
        } else {
          await loadSkills(null);
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
    await haptics.timerStart();
    try {
      let targetInstance = instance;
      if (!targetInstance) {
        // Create a focus session task instance on today's schedule if launched from skill slot
        const chosenSkill = skills.find((s) => s.id === skillId);
        const sessionTitle = chosenSkill ? `Focus · ${chosenSkill.name}` : 'Focus Session';
        const today = localDateString();
        const tpl = await createTemplate(db, {
          title: sessionTitle,
          categoryId: chosenSkill?.categoryId ?? null,
          durationMin,
          recurrence: 'once',
          customDays: [],
          targetDate: today,
          alarmTime: null,
          isRitual: false,
          priority: 'medium',
        });
        const created = await createInstance(db, {
          templateId: tpl.id,
          date: today,
          title: sessionTitle,
          categoryId: chosenSkill?.categoryId ?? null,
          durationMin,
          alarmTime: null,
          isRitual: false,
          priority: 'medium',
        });
        targetInstance = {
          id: created.id,
          title: created.title,
          categoryId: created.categoryId,
          status: created.status,
          durationMin: created.durationMin,
        };
        setInstance(targetInstance);
      }

      const s = await startTimer(db, {
        taskInstanceId: targetInstance.id,
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
  }, [db, instance, skills, skillId, durationMin, mode]);

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

  useEffect(() => {
    if (
      phase === 'running' &&
      session?.mode === 'countdown' &&
      remainingMs <= 0 &&
      !autoStoppedRef.current
    ) {
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
      await db.runAsync(
        `UPDATE task_instances SET status = 'done', updated_at = ? WHERE id = ?`,
        nowUtcIso(),
        instance.id
      );
      await logEvent(db, {
        eventType: 'completed',
        actor: 'user',
        taskInstanceId: instance.id,
        payload: { via: 'timer-screen' },
      });
      await cancelTaskAlarm(instance.id).catch(() => {});
      await haptics.complete();
      setMarkedDone(true);
      setInstance({ ...instance, status: 'done' });
    } catch (e) {
      console.warn('[checkoff] mark-done failed', e);
    }
  }, [db, instance, markedDone]);

  const displayMs = session?.mode === 'countdown' ? remainingMs : elapsedMs;
  const activeSkillName = skills.find((s) => s.id === skillId)?.name;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.bg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Top bar */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.caption, { color: palette.textFaint }]}>FOCUS INSTRUMENT</Text>
            <MetallicText style={styles.title} numberOfLines={1}>
              {instance?.title ?? activeSkillName ?? 'Focus Timer'}
            </MetallicText>
          </View>
          <PressableScale
            onPress={() => router.back()}
            style={styles.closeBtn}
            innerStyle={[
              styles.closeInner,
              { borderColor: palette.border, backgroundColor: palette.surface },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close timer"
          >
            <X color={palette.textDim} size={18} strokeWidth={2} />
          </PressableScale>
        </View>

        {phase === 'loading' && (
          <Card padding={3}>
            <Text style={[styles.dim, { color: palette.textDim }]}>Loading session…</Text>
          </Card>
        )}

        {phase === 'setup' && (
          <View style={{ gap: space(2) }}>
            <Card padding={2}>
              <Text style={[styles.caption, { color: palette.textFaint, marginBottom: space(1) }]}>
                MODE
              </Text>
              <View
                style={[
                  styles.segment,
                  { backgroundColor: palette.surface2, borderColor: palette.border },
                ]}
              >
                {(['countdown', 'stopwatch'] as TimerMode[]).map((m) => {
                  const active = mode === m;
                  return (
                    <PressableScale
                      key={m}
                      accessibilityRole="button"
                      onPress={() => setMode(m)}
                      style={styles.segmentCell}
                      innerStyle={[
                        styles.segmentBtn,
                        active && { backgroundColor: palette.accent },
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          { color: active ? palette.onAccent : palette.textDim },
                        ]}
                      >
                        {m === 'countdown' ? 'Countdown' : 'Stopwatch'}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </Card>

            {mode === 'countdown' && (
              <Card padding={2}>
                <Slider
                  label="Duration"
                  value={durationMin}
                  min={5}
                  max={180}
                  step={5}
                  suffix="m"
                  presets={DURATIONS}
                  onChange={setDurationMin}
                />
              </Card>
            )}

            {skills.length > 0 && (
              <Card padding={2}>
                <Text
                  style={[
                    styles.caption,
                    { color: palette.textFaint, marginBottom: space(1) },
                  ]}
                >
                  ATTRIBUTE PRACTICE SKILL
                </Text>
                <View style={styles.chipRow}>
                  {skills.map((s) => {
                    const active = skillId === s.id;
                    return (
                      <PressableScale
                        key={s.id}
                        accessibilityRole="button"
                        onPress={() => setSkillId(active ? null : s.id)}
                        innerStyle={[
                          styles.chip,
                          {
                            backgroundColor: active ? palette.accent : palette.surface2,
                            borderColor: active ? palette.accent : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: active ? palette.onAccent : palette.textDim },
                          ]}
                        >
                          {s.name}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
              </Card>
            )}

            <Button
              label="Start Focus Session"
              variant="primary"
              size="lg"
              fullWidth
              icon={<Play color={palette.onAccent} size={18} strokeWidth={2.5} />}
              onPress={handleStart}
            />
          </View>
        )}

        {(phase === 'running' || phase === 'paused') && session && (
          <View style={{ gap: space(2.5), marginTop: space(2) }}>
            <Card padding={3} elevated style={styles.clockCard}>
              <Text style={[styles.caption, { color: palette.textFaint }]}>
                {session.mode === 'countdown'
                  ? phase === 'paused'
                    ? 'PAUSED · COUNTDOWN'
                    : 'REMAINING'
                  : phase === 'paused'
                  ? 'PAUSED · STOPWATCH'
                  : 'ELAPSED'}
              </Text>
              <MetallicText
                style={styles.clock}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatClock(phase === 'paused' ? elapsedMs : displayMs)}
              </MetallicText>
              {activeSkillName && (
                <Text style={[styles.small, { color: palette.textDim }]}>
                  Skill · {activeSkillName}
                </Text>
              )}
            </Card>

            <View style={styles.btnRow}>
              <View style={{ flex: 1 }}>
                {phase === 'running' ? (
                  <Button
                    label="Pause"
                    variant="secondary"
                    size="lg"
                    fullWidth
                    icon={<Pause color={palette.text} size={16} strokeWidth={2.2} />}
                    onPress={handlePause}
                  />
                ) : (
                  <Button
                    label="Resume"
                    variant="primary"
                    size="lg"
                    fullWidth
                    icon={<Play color={palette.onAccent} size={16} strokeWidth={2.5} />}
                    onPress={handleResume}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Finish"
                  variant="secondary"
                  size="lg"
                  fullWidth
                  icon={<Square color={palette.text} size={15} strokeWidth={2.2} />}
                  onPress={() => handleStop(true)}
                />
              </View>
            </View>
          </View>
        )}

        {phase === 'finished' && finishedSession && (
          <View style={{ gap: space(2), marginTop: space(2) }}>
            <Card padding={3} elevated style={styles.clockCard}>
              <Text style={[styles.caption, { color: palette.textFaint }]}>
                SESSION COMPLETE
              </Text>
              <MetallicText style={styles.clock} numberOfLines={1} adjustsFontSizeToFit>
                {formatClock(
                  new Date(
                    finishedSession.endedAtUtc ?? finishedSession.startedAtUtc
                  ).getTime() - new Date(finishedSession.startedAtUtc).getTime()
                )}
              </MetallicText>
              <Text style={[styles.small, { color: palette.textDim }]}>
                Logged to append-only ledger
              </Text>
            </Card>

            {instance && instance.status !== 'done' && !markedDone && (
              <Button
                label="Mark Task Done"
                variant="primary"
                size="lg"
                fullWidth
                icon={<Check color={palette.onAccent} size={18} strokeWidth={2.5} />}
                onPress={handleMarkDone}
              />
            )}
            {markedDone && (
              <Card padding={2}>
                <Text style={[styles.dim, { color: palette.text, textAlign: 'center' }]}>
                  Task marked complete.
                </Text>
              </Card>
            )}
            <Button
              label="Return"
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => router.back()}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space(2), gap: space(2), paddingBottom: space(6) },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
  },
  title: { ...type.h1, marginTop: 2 },
  caption: { ...type.caption, textTransform: 'uppercase' },
  dim: { ...type.body },
  small: { ...type.small },
  closeBtn: {
    width: TAP,
    height: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeInner: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  segmentCell: {
    flex: 1,
  },
  segmentBtn: {
    minHeight: TAP,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { ...type.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  chip: {
    minHeight: TAP,
    paddingHorizontal: space(2),
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { ...type.small, fontWeight: '600' },
  clockCard: {
    alignItems: 'center',
    gap: space(1),
  },
  clock: {
    ...type.clock,
    fontSize: 56,
    lineHeight: 64,
    marginVertical: space(1),
  },
  btnRow: { flexDirection: 'row', gap: space(1.5) },
});
