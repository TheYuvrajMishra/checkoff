/**
 * CheckOff — domain types.
 * The SQLite DB is the source of truth; these mirror the tables 1:1.
 * Dates: `date` fields are local calendar days ("YYYY-MM-DD").
 * Timestamps: stored as UTC ISO strings + the device offset (minutes) at write time.
 */

export type Recurrence = 'daily' | 'weekdays' | 'custom' | 'once';
export type InstanceStatus = 'pending' | 'done' | 'skipped' | 'missed';
export type TaskPriority = 'low' | 'medium' | 'high';
export type EventActor = 'user' | 'alarm' | 'auto' | 'system';
export type TimerMode = 'countdown' | 'stopwatch';

export type LogEventType =
  | 'created'
  | 'edited'
  | 'scheduled'
  | 'alarm_fired'
  | 'started'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'unchecked'
  | 'skipped'
  | 'missed'
  | 'deleted'
  | 'override'
  | 'exported'
  | 'streak_milestone'
  | 'timer_session_started'
  | 'timer_session_ended';

export interface Category {
  id: string;
  name: string;
  /** Desaturated color token, e.g. "slate", "amber", "teal". Resolved in theme. */
  colorToken: string;
  /** If true, its skills form a rotation pool for the daily creative slot. */
  rotationEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  categoryId: string;
  name: string;
  createdAt: string;
}

export interface TaskTemplate {
  id: string;
  title: string;
  categoryId: string | null;
  durationMin: number;
  recurrence: Recurrence;
  /** JSON array of 0..6 (Sun..Sat). Only when recurrence === 'custom'. */
  customDays: number[] | null;
  /** YYYY-MM-DD. Only when recurrence === 'once'. */
  targetDate: string | null;
  /** Local alarm time "HH:MM" (24h). Null = no alarm. */
  alarmTime: string | null;
  isRitual: boolean;
  /** Task priority. Defaults to 'medium'. */
  priority: TaskPriority;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInstance {
  id: string;
  templateId: string | null;
  /** Local calendar day this instance belongs to, YYYY-MM-DD. */
  date: string;
  title: string;
  categoryId: string | null;
  durationMin: number;
  alarmTime: string | null;
  isRitual: boolean;
  /** Task priority. Defaults to 'medium'. */
  priority: TaskPriority;
  status: InstanceStatus;
  /** Soft delete — deleted rows stay in the DB and are excluded from reads. */
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LogEvent {
  id: number;
  /** UTC ISO-8601 timestamp of the event. */
  tsUtc: string;
  /** Device UTC offset in minutes at the moment of the event (DST-safe history). */
  tsOffsetMin: number;
  eventType: LogEventType;
  taskInstanceId: string | null;
  templateId: string | null;
  timerSessionId: string | null;
  actor: EventActor;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface TimerSession {
  id: string;
  taskInstanceId: string | null;
  mode: TimerMode;
  plannedMin: number | null;
  startedAtUtc: string;
  endedAtUtc: string | null;
  createdAt: string;
}
