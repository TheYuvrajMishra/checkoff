import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { TaskInstance } from '../db/types';
import { useDb } from '../db/useDb';
import {
  instancesForDate,
  setInstanceStatus,
  createInstance,
} from '../db/repos/instances';
import { cancelTaskAlarm } from '../notifications';
import type { NewInstance, TaskInstanceEx } from '../db/repos/instances';
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
      await setInstanceStatus(
        requireDb(),
        id,
        current.status === 'done' ? 'pending' : 'done',
        'user'
      );
      // A completed/unchecked task no longer needs its alarm.
      void cancelTaskAlarm(requireDb(), id).catch(() => {});
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
      await createInstance(requireDb(), input);
      await get().refresh(input.date ?? get().date);
    } catch (e) {
      console.error('[tasks] addManual failed', e);
    }
  },
}));
