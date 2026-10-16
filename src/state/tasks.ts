import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { TaskInstance } from '../db/types';
import { useDb } from '../db/useDb';
import {
  instancesForDate,
  setInstanceStatus,
  createInstance,
  updateInstance,
  duplicateInstance,
  softDeleteInstance,
  rescheduleInstance,
  type InstancePatch,
  type NewInstance,
  type TaskInstanceEx,
} from '../db/repos/instances';
import { cancelTaskAlarm, scheduleTaskAlarm } from '../notifications';
import { localDateString } from '../db/time';

let db: SQLiteDatabase | null = null;

/**
 * Called once by the coordinator at bootstrap (after SQLiteProvider is ready),
 * or lazily by screens via useTasksDb() below.
 * The store keeps its own reference so screens never thread `db` through props.
 */
export function setDb(next: SQLiteDatabase): void {
  db = next;
}

function requireDb(): SQLiteDatabase {
  if (!db) throw new Error('Tasks store not initialized: setDb() not called.');
  return db;
}

/**
 * Screen-level wiring: returns the DB and registers it with the store once.
 * Safe to call from multiple screens; the first call wins.
 */
export function useTasksDb(): SQLiteDatabase {
  const next = useDb();
  const wired = useRef(false);
  useEffect(() => {
    if (!wired.current) {
      setDb(next);
      wired.current = true;
    }
  }, [next]);
  return next;
}

interface TasksState {
  date: string;
  instances: TaskInstance[];
  loading: boolean;
  refresh: (date?: string) => Promise<void>;
  setDate: (d: string) => void;
  toggleDone: (id: string) => Promise<void>;
  skipTask: (id: string) => Promise<void>;
  addManual: (input: NewInstance) => Promise<void>;
  updateTask: (id: string, patch: InstancePatch) => Promise<void>;
  duplicateTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  rescheduleTask: (id: string, date: string) => Promise<void>;
}

export const useTasksStore = create<TasksState>()((set, get) => ({
  date: localDateString(),
  instances: [],
  loading: false,

  refresh: async (date?: string) => {
    const target = date ?? get().date;
    set({ date: target, loading: true });
    try {
      const rows: TaskInstanceEx[] = await instancesForDate(requireDb(), target);
      set({ instances: rows, loading: false });
    } catch (e) {
      console.error('[tasks] refresh failed', e);
      set({ loading: false });
    }
  },

  setDate: (d: string) => {
    set({ date: d });
    void get().refresh(d);
  },

  toggleDone: async (id: string) => {
    try {
      const current = get().instances.find((i) => i.id === id);
      if (!current) return;
      const nextStatus = current.status === 'done' ? 'pending' : 'done';
      await setInstanceStatus(requireDb(), id, nextStatus, 'user');
      if (nextStatus === 'pending' && current.alarmTime) {
        void scheduleTaskAlarm(requireDb(), {
          ...current,
          status: 'pending',
        }).catch(() => {});
      } else {
        void cancelTaskAlarm(requireDb(), id).catch(() => {});
      }
      await get().refresh();
    } catch (e) {
      console.error('[tasks] toggleDone failed', e);
    }
  },

  skipTask: async (id: string) => {
    try {
      await setInstanceStatus(requireDb(), id, 'skipped', 'user');
      void cancelTaskAlarm(requireDb(), id).catch(() => {});
      await get().refresh();
    } catch (e) {
      console.error('[tasks] skipTask failed', e);
    }
  },

  addManual: async (input: NewInstance) => {
    try {
      const created = await createInstance(requireDb(), input);
      if (created.alarmTime) {
        await scheduleTaskAlarm(requireDb(), created).catch(() => {});
      }
      await get().refresh(input.date ?? get().date);
    } catch (e) {
      console.error('[tasks] addManual failed', e);
    }
  },

  updateTask: async (id: string, patch: InstancePatch) => {
    try {
      const updated = await updateInstance(requireDb(), id, patch);
      if (updated.status === 'pending' && updated.alarmTime && !updated.deleted) {
        await scheduleTaskAlarm(requireDb(), updated).catch(() => {});
      } else {
        await cancelTaskAlarm(requireDb(), id).catch(() => {});
      }
      await get().refresh();
    } catch (e) {
      console.error('[tasks] updateTask failed', e);
    }
  },

  duplicateTask: async (id: string) => {
    try {
      const copy = await duplicateInstance(requireDb(), id);
      if (copy.alarmTime) {
        await scheduleTaskAlarm(requireDb(), copy).catch(() => {});
      }
      await get().refresh();
    } catch (e) {
      console.error('[tasks] duplicateTask failed', e);
    }
  },

  deleteTask: async (id: string) => {
    try {
      await softDeleteInstance(requireDb(), id);
      void cancelTaskAlarm(requireDb(), id).catch(() => {});
      await get().refresh();
    } catch (e) {
      console.error('[tasks] deleteTask failed', e);
    }
  },

  rescheduleTask: async (id: string, date: string) => {
    try {
      const moved = await rescheduleInstance(requireDb(), id, date);
      if (moved.status === 'pending' && moved.alarmTime && !moved.deleted) {
        await scheduleTaskAlarm(requireDb(), moved).catch(() => {});
      } else {
        await cancelTaskAlarm(requireDb(), id).catch(() => {});
      }
      await get().refresh();
    } catch (e) {
      console.error('[tasks] rescheduleTask failed', e);
    }
  },
}));
