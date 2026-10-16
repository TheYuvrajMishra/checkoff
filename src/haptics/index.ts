/**
 * CheckOff — haptic vocabulary.
 *
 * One module owns every vibration in the app so the feel stays consistent.
 * Sibling screens import `{ haptics }` and call `configureHaptics()` once
 * (wired by the coordinator at bootstrap from the settings store).
 *
 * Verified against expo-haptics v57 docs:
 * - Haptics.impactAsync(ImpactFeedbackStyle.Light|Medium|Heavy|Rigid|Soft)
 *   — Soft EXISTS in v57, no emulation needed.
 * - Haptics.notificationAsync(NotificationFeedbackType.Success|Warning|Error)
 *
 * Design rules:
 * - check = a single Light tick (acknowledgement: press feedback, long-press,
 *   swipe threshold, ritual step).
 * - complete = Success notification (a task was finished — celebration).
 * - finalRitual = Light, then Success after 90ms (a two-beat "sealed" feel).
 * - uncheck = Soft (the gentlest reversal; taking something back is quiet).
 * - skip = Warning (distinct from success — a deliberate pass, not a win).
 * - timerStart = Medium; timerEnd = Heavy, 140ms gap, Heavy (a firm stop).
 * - alarmTick = one Medium (the caller repeats it on a 2s cadence).
 * - milestone escalates with level: 1 = Medium; 2 = Medium then Heavy;
 *   3 = Heavy x3 with 160ms gaps (rare, so it may be loud).
 *
 * Intensity scaling: 'light' downgrades Heavy -> Medium (gentler device),
 * 'strong' keeps everything as authored. Every function is try/catch-guarded
 * and no-ops when disabled — haptics must NEVER throw.
 */
import * as Haptics from 'expo-haptics';

export type HapticIntensity = 'light' | 'medium' | 'strong';

interface HapticConfig {
  enabled: boolean;
  intensity: HapticIntensity;
}

const config: HapticConfig = { enabled: true, intensity: 'medium' };

/** Called by the coordinator/settings screen when settings change. */
export function configureHaptics(opts: { enabled: boolean; intensity: HapticIntensity }): void {
  config.enabled = opts.enabled;
  config.intensity = opts.intensity;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function impact(style: Haptics.ImpactFeedbackStyle): Promise<void> {
  if (!config.enabled) return;
  let mapped = style;
  if (config.intensity === 'light') {
    if (style === Haptics.ImpactFeedbackStyle.Heavy) mapped = Haptics.ImpactFeedbackStyle.Medium;
    else if (style === Haptics.ImpactFeedbackStyle.Medium) mapped = Haptics.ImpactFeedbackStyle.Light;
    else if (style === Haptics.ImpactFeedbackStyle.Light) mapped = Haptics.ImpactFeedbackStyle.Soft;
  } else if (config.intensity === 'strong') {
    if (style === Haptics.ImpactFeedbackStyle.Soft) mapped = Haptics.ImpactFeedbackStyle.Light;
    else if (style === Haptics.ImpactFeedbackStyle.Light) mapped = Haptics.ImpactFeedbackStyle.Medium;
  }
  await Haptics.impactAsync(mapped);
}

async function notify(type: Haptics.NotificationFeedbackType): Promise<void> {
  if (!config.enabled) return;
  await Haptics.notificationAsync(type);
}

async function safe(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Haptics are decorative; never let them break app flow.
  }
}

export const haptics = {
  /** Crisp selection detent tick — used at every slider detent step. */
  selection(): Promise<void> {
    return safe(async () => {
      if (!config.enabled) return;
      await Haptics.selectionAsync();
    });
  },

  /** Single light tick — acknowledgement (press feedback, long-press, swipe threshold, slider release). */
  check(): Promise<void> {
    return safe(() => impact(Haptics.ImpactFeedbackStyle.Light));
  },

  /** Task completed — Success notification. */
  complete(): Promise<void> {
    return safe(() => notify(Haptics.NotificationFeedbackType.Success));
  },

  /** Two-beat "sealed" pattern for the final-ritual completion. */
  finalRitual(): Promise<void> {
    return safe(async () => {
      await impact(Haptics.ImpactFeedbackStyle.Light);
      await sleep(90);
      await notify(Haptics.NotificationFeedbackType.Success);
    });
  },

  /** Gentle reversal — unchecking is quiet. */
  uncheck(): Promise<void> {
    return safe(() => impact(Haptics.ImpactFeedbackStyle.Soft));
  },

  /** Deliberate pass — distinct Warning buzz, not a success. */
  skip(): Promise<void> {
    return safe(() => notify(Haptics.NotificationFeedbackType.Warning));
  },

  /** Timer started. */
  timerStart(): Promise<void> {
    return safe(() => impact(Haptics.ImpactFeedbackStyle.Medium));
  },

  /** Timer ended — firm double Heavy with a 140ms gap. */
  timerEnd(): Promise<void> {
    return safe(async () => {
      await impact(Haptics.ImpactFeedbackStyle.Heavy);
      await sleep(140);
      await impact(Haptics.ImpactFeedbackStyle.Heavy);
    });
  },

  /**
   * One Medium tick. The alarm foreground handler repeats this on a 2s
   * cadence (max 30s); this function only ever fires once.
   */
  alarmTick(): Promise<void> {
    return safe(() => impact(Haptics.ImpactFeedbackStyle.Medium));
  },

  /** Escalating celebration for streak milestones. */
  milestone(level: 1 | 2 | 3): Promise<void> {
    return safe(async () => {
      if (level === 1) {
        await impact(Haptics.ImpactFeedbackStyle.Medium);
      } else if (level === 2) {
        await impact(Haptics.ImpactFeedbackStyle.Medium);
        await sleep(140);
        await impact(Haptics.ImpactFeedbackStyle.Heavy);
      } else {
        for (let i = 0; i < 3; i++) {
          await impact(Haptics.ImpactFeedbackStyle.Heavy);
          if (i < 2) await sleep(160);
        }
      }
    });
  },
  /** Basic light impact. */
  light(): Promise<void> {
    return safe(() => impact(Haptics.ImpactFeedbackStyle.Light));
  },

  /** Basic medium impact. */
  medium(): Promise<void> {
    return safe(() => impact(Haptics.ImpactFeedbackStyle.Medium));
  },

  /** Basic heavy impact. */
  heavy(): Promise<void> {
    return safe(() => impact(Haptics.ImpactFeedbackStyle.Heavy));
  },

  /** Notification success. */
  success(): Promise<void> {
    return safe(() => notify(Haptics.NotificationFeedbackType.Success));
  },

  /** Notification warning. */
  warning(): Promise<void> {
    return safe(() => notify(Haptics.NotificationFeedbackType.Warning));
  },

  /** Notification error. */
  error(): Promise<void> {
    return safe(() => notify(Haptics.NotificationFeedbackType.Error));
  },

  /** Tick feedback. */
  tick(): Promise<void> {
    return safe(() => impact(Haptics.ImpactFeedbackStyle.Light));
  },
};

export const hapticSelection = () => haptics.selection();
export const hapticSuccess = () => haptics.success();
export const hapticLight = () => haptics.light();
export const hapticMedium = () => haptics.medium();
export const hapticHeavy = () => haptics.heavy();
export const hapticWarning = () => haptics.warning();
export const hapticError = () => haptics.error();
export const hapticTick = () => haptics.tick();
