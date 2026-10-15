import type { SQLiteDatabase } from 'expo-sqlite';
import type { Category, Skill } from '../db/types';
import { logEvent } from '../db/log';
import { getMeta, setMeta } from '../db/repos/meta';
import { listCategories } from '../db/repos/categories';
import { lastPracticedAt, listSkills } from '../db/repos/skills';

export interface SkillSlot {
  skill: Skill | null;
  category: Category | null;
  overridden: boolean;
}

/**
 * Extra meta key managed locally by this module (META_KEYS itself is
 * coordinator-owned and intentionally not extended).
 */
const ROTATION_OVERRIDDEN_KEY = 'rotation_overridden';

export async function todaysSkillSlot(
  db: SQLiteDatabase,
  date: string
): Promise<SkillSlot> {
  const storedDate = await getMeta(db, 'rotation_date');
  const storedSkillId = await getMeta(db, 'rotation_skill_id');

  // Same-day: return the persisted slot (stable across app restarts).
  if (storedDate === date && storedSkillId) {
    const skills = await listSkills(db);
    const skill = skills.find((s) => s.id === storedSkillId) ?? null;
    let category: Category | null = null;
    if (skill) {
      const cats = await listCategories(db);
      category = cats.find((c) => c.id === skill.categoryId) ?? null;
    }
    const overridden = (await getMeta(db, ROTATION_OVERRIDDEN_KEY)) === '1';
    return { skill, category, overridden };
  }

  // Fresh pick for the date.
  const categories = await listCategories(db);
  const rotationPool = categories.filter((c) => c.rotationEnabled);
  const category = rotationPool[0] ?? null; // earliest created
  if (!category) return { skill: null, category: null, overridden: false };

  const skills = await listSkills(db, category.id);
  if (skills.length === 0) return { skill: null, category, overridden: false };

  // Oldest practice first; never-practiced sorts before practiced.
  const withLast = await Promise.all(
    skills.map(async (s) => ({ s, last: await lastPracticedAt(db, s.id) }))
  );
  withLast.sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''));

  // Avoid back-to-back repetition when the pool has more than one skill.
  let pick = withLast[0];
  if (withLast.length > 1 && storedSkillId && pick.s.id === storedSkillId) {
    pick = withLast[1];
  }

  await setMeta(db, 'rotation_date', date);
  await setMeta(db, 'rotation_skill_id', pick.s.id);
  await setMeta(db, ROTATION_OVERRIDDEN_KEY, '0');
  return { skill: pick.s, category, overridden: false };
}

export async function overrideSkillSlot(
  db: SQLiteDatabase,
  date: string,
  skillId: string
): Promise<void> {
  const skills = await listSkills(db);
  const skill = skills.find((s) => s.id === skillId);
  if (!skill) throw new Error(`Skill "${skillId}" not found.`);

  await setMeta(db, 'rotation_date', date);
  await setMeta(db, 'rotation_skill_id', skillId);
  await setMeta(db, ROTATION_OVERRIDDEN_KEY, '1');
  await logEvent(db, {
    eventType: 'override',
    actor: 'user',
    payload: { skillId, date },
  });
}
