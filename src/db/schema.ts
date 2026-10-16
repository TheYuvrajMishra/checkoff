/**
 * CheckOff — versioned schema.
 *
 * Rules:
 * - Never edit a released migration. Add a new one.
 * - Nothing is ever deleted by the app: statuses flip, rows stay.
 *   `log_events` is append-only by convention (the log engine exposes
 *   no update/delete API at all).
 */

export const SCHEMA_VERSION = 3;

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

const V1 = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color_token TEXT NOT NULL,
  rotation_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category_id);

CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  recurrence TEXT NOT NULL DEFAULT 'daily'
    CHECK (recurrence IN ('daily','weekdays','custom','once')),
  custom_days TEXT,
  target_date TEXT,
  alarm_time TEXT,
  is_ritual INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_recurrence ON task_templates(recurrence, enabled);

CREATE TABLE IF NOT EXISTS task_instances (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES task_templates(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  alarm_time TEXT,
  is_ritual INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','done','skipped','missed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(template_id, date)
);
CREATE INDEX IF NOT EXISTS idx_instances_date ON task_instances(date, status);
CREATE INDEX IF NOT EXISTS idx_instances_template ON task_instances(template_id);

-- APPEND-ONLY. No UPDATE/DELETE statements against this table exist in the codebase.
CREATE TABLE IF NOT EXISTS log_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc TEXT NOT NULL,
  ts_offset_min INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  task_instance_id TEXT REFERENCES task_instances(id),
  template_id TEXT REFERENCES task_templates(id),
  timer_session_id TEXT REFERENCES timer_sessions(id),
  actor TEXT NOT NULL DEFAULT 'user'
    CHECK (actor IN ('user','alarm','auto','system')),
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_log_ts ON log_events(ts_utc);
CREATE INDEX IF NOT EXISTS idx_log_instance ON log_events(task_instance_id, ts_utc);
CREATE INDEX IF NOT EXISTS idx_log_type ON log_events(event_type, ts_utc);

CREATE TABLE IF NOT EXISTS timer_sessions (
  id TEXT PRIMARY KEY,
  task_instance_id TEXT REFERENCES task_instances(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('countdown','stopwatch')),
  planned_min INTEGER,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_instance ON timer_sessions(task_instance_id);
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, description: 'Initial schema: categories, skills, templates, instances, append-only log, timer sessions', sql: V1 },
  {
    version: 2,
    description: 'Link task instances to the practiced skill for rotation analytics',
    sql: `
ALTER TABLE task_instances ADD COLUMN skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_instances_skill ON task_instances(skill_id);
`,
  },
  {
    version: 3,
    description: 'Task priorities on templates and instances; soft-delete flag on instances',
    sql: `
ALTER TABLE task_templates ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low','medium','high'));
ALTER TABLE task_instances ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low','medium','high'));
ALTER TABLE task_instances ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_instances_deleted ON task_instances(date, deleted);
`,
  },
];
