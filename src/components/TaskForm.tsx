import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { Category, Recurrence, TaskPriority } from '../db/types';
import { CATEGORY_TOKENS, categoryColor, dark, light, radius, space, TAP, type, type ThemePalette } from '../theme/tokens';
import { addDays, localDateString } from '../db/time';
import { useUiStore } from '../state/ui';

export interface TaskFormValues {
  title: string;
  categoryId: string | null;
  recurrence: Recurrence;
  customDays: number[];
  /** YYYY-MM-DD. Used as targetDate for 'once' templates. */
  date: string;
  alarmEnabled: boolean;
  hour: number;
  minute: number;
  durationMin: number;
  isRitual: boolean;
  priority: TaskPriority;
}

interface Props {
  categories: Category[];
  /** Show the free "instance date" stepper (add-task). Hidden in onboarding. */
  showInstanceDate: boolean;
  initialDate?: string;
  /** Prefill for edit mode. */
  initialValues?: Partial<TaskFormValues>;
  submitLabel: string;
  onSubmit: (v: TaskFormValues) => void;
}

const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const RECURRENCES: Array<{ key: Recurrence; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekdays', label: 'Weekdays' },
  { key: 'custom', label: 'Custom' },
  { key: 'once', label: 'One-off' },
];

const PRIORITY_OPTIONS: Array<{ key: TaskPriority; label: string }> = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
];

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export function TaskForm({ categories, showInstanceDate, initialDate, initialValues, submitLabel, onSubmit }: Props) {
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initialValues?.categoryId ?? null);
  const [recurrence, setRecurrence] = useState<Recurrence>(initialValues?.recurrence ?? 'daily');
  const [customDays, setCustomDays] = useState<number[]>(initialValues?.customDays ?? []);
  const [date, setDate] = useState(initialValues?.date ?? initialDate ?? localDateString());
  const [alarmEnabled, setAlarmEnabled] = useState(initialValues?.alarmEnabled ?? true);
  const [hour, setHour] = useState(initialValues?.hour ?? 7);
  const [minute, setMinute] = useState(initialValues?.minute ?? 0);
  const [durationMin, setDurationMin] = useState(initialValues?.durationMin ?? 30);
  const [isRitual, setIsRitual] = useState(initialValues?.isRitual ?? false);
  const [priority, setPriority] = useState<TaskPriority>(initialValues?.priority ?? 'medium');
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) =>
    setCustomDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const submit = () => {
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }
    if (recurrence === 'custom' && customDays.length === 0) {
      setError('Pick at least one day for a custom schedule.');
      return;
    }
    setError(null);
    onSubmit({
      title: title.trim(),
      categoryId,
      recurrence,
      customDays,
      date,
      alarmEnabled,
      hour,
      minute,
      durationMin,
      isRitual,
      priority,
    });
  };

  return (
    <View style={styles.form}>
      <Text style={[styles.caption, { color: theme.textFaint }]}>TITLE</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="What needs doing"
        placeholderTextColor={theme.textFaint}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface2 }]}
      />

      <Text style={[styles.caption, { color: theme.textFaint }]}>CATEGORY</Text>
      <View style={styles.chips}>
        <Chip theme={theme} label="None" selected={categoryId === null} onPress={() => setCategoryId(null)} />
        {categories.map((c) => (
          <Chip
            key={c.id}
            theme={theme}
            label={c.name}
            dot={categoryColor(c.colorToken)}
            selected={categoryId === c.id}
            onPress={() => setCategoryId(c.id)}
          />
        ))}
      </View>

      <Text style={[styles.caption, { color: theme.textFaint }]}>REPEATS</Text>
      <View style={styles.chips}>
        {RECURRENCES.map((r) => (
          <Chip
            key={r.key}
            theme={theme}
            label={r.label}
            selected={recurrence === r.key}
            onPress={() => setRecurrence(r.key)}
          />
        ))}
      </View>

      {recurrence === 'custom' && (
        <View style={styles.chips}>
          {DOW_LABELS.map((label, i) => (
            <Chip
              key={i}
              theme={theme}
              label={label}
              selected={customDays.includes(i)}
              onPress={() => toggleDay(i)}
            />
          ))}
        </View>
      )}

      {(recurrence === 'once' || showInstanceDate) && (
        <>
          <Text style={[styles.caption, { color: theme.textFaint }]}>DATE</Text>
          <DateStepper theme={theme} date={date} minDate={localDateString()} onChange={setDate} />
        </>
      )}

      <View style={styles.toggleRow}>
        <Text style={[styles.body, { color: theme.text }]}>Alarm</Text>
        <Switch
          value={alarmEnabled}
          onValueChange={setAlarmEnabled}
          trackColor={{ true: theme.accent, false: theme.border }}
          thumbColor={theme.onAccent}
        />
      </View>

      {alarmEnabled && (
        <View style={styles.timePickerRow}>
          <Text style={[styles.small, { color: theme.textDim }]}>Alarm time</Text>
          <NativeTimeButton theme={theme} hour={hour} minute={minute} onChange={(h, m) => { setHour(h); setMinute(m); }} />
        </View>
      )}

      <Text style={[styles.caption, { color: theme.textFaint }]}>PRIORITY</Text>
      <View style={styles.chips}>
        {PRIORITY_OPTIONS.map((p) => (
          <Chip
            key={p.key}
            theme={theme}
            label={p.label}
            selected={priority === p.key}
            onPress={() => setPriority(p.key)}
          />
        ))}
      </View>

      <View style={styles.stepperRow}>
        <NumStepper theme={theme} label="Duration" value={durationMin} min={5} max={480} step={5} onChange={setDurationMin} suffix=" min" />
      </View>

      <View style={styles.toggleRow}>
        <View>
          <Text style={[styles.body, { color: theme.text }]}>Ritual</Text>
          <Text style={[styles.small, { color: theme.textDim }]}>
            A non-negotiable daily anchor, shown first.
          </Text>
        </View>
        <Switch
          value={isRitual}
          onValueChange={setIsRitual}
          trackColor={{ true: theme.accent, false: theme.border }}
          thumbColor={theme.onAccent}
        />
      </View>

      {error && (
        <Text style={[styles.small, { color: theme.danger }]}>{error}</Text>
      )}

      <Pressable onPress={submit} style={[styles.submit, { backgroundColor: theme.accent }]}>
        <Text style={[styles.submitText, { color: theme.onAccent }]}>{submitLabel}</Text>
      </Pressable>
    </View>
  );
}

export function Chip({
  theme,
  label,
  selected,
  onPress,
  dot,
}: {
  theme: ThemePalette;
  label: string;
  selected: boolean;
  onPress: () => void;
  dot?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.accentDim : 'transparent',
        },
      ]}
    >
      {dot && <View style={[styles.chipDot, { backgroundColor: dot }]} />}
      <Text style={[styles.small, { color: selected ? theme.text : theme.textDim }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function NumStepper({
  theme,
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  theme: ThemePalette;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <View style={styles.numStepper}>
      <Text style={[styles.caption, { color: theme.textFaint }]}>{label.toUpperCase()}</Text>
      <View style={styles.numRow}>
        <Pressable
          onPress={() => onChange(clamp(value - step))}
          style={[styles.numBtn, { borderColor: theme.border }]}
          hitSlop={6}
        >
          <Text style={[styles.numBtnText, { color: theme.text }]}>-</Text>
        </Pressable>
        <Text style={[styles.body, styles.numValue, { color: theme.text, fontVariant: ['tabular-nums'] }]}>
          {value}{suffix}
        </Text>
        <Pressable
          onPress={() => onChange(clamp(value + step))}
          style={[styles.numBtn, { borderColor: theme.border }]}
          hitSlop={6}
        >
          <Text style={[styles.numBtnText, { color: theme.text }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function NativeTimeButton({
  theme,
  hour,
  minute,
  onChange,
}: {
  theme: ThemePalette;
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  const [show, setShow] = useState(false);
  const value = new Date();
  value.setHours(hour, minute, 0, 0);

  const onPick = (event: DateTimePickerEvent, selected?: Date) => {
    // Android: dismiss on cancel; keep picker open on iOS.
    if (Platform.OS === 'android') setShow(false);
    if (event.type === 'set' && selected) {
      onChange(selected.getHours(), selected.getMinutes());
    }
  };

  return (
    <View>
      <Pressable
        onPress={() => setShow(true)}
        style={[styles.timeButton, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
      >
        <Text style={[styles.timeButtonText, { color: theme.text, fontVariant: ['tabular-nums'] }]}>
          {pad2(hour)}:{pad2(minute)}
        </Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={value}
          mode="time"
          is24Hour={false}
          display={Platform.OS === 'android' ? 'default' : 'spinner'}
          onChange={onPick}
        />
      )}
    </View>
  );
}

export function DateStepper({
  theme,
  date,
  minDate,
  onChange,
}: {
  theme: ThemePalette;
  date: string;
  minDate: string;
  onChange: (d: string) => void;
}) {
  const label =
    date === localDateString()
      ? 'Today'
      : date === addDays(localDateString(), 1)
        ? 'Tomorrow'
        : new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          });
  return (
    <View style={styles.numRow}>
      <Pressable
        onPress={() => {
          const prev = addDays(date, -1);
          if (prev >= minDate) onChange(prev);
        }}
        style={[styles.numBtn, { borderColor: theme.border }]}
        hitSlop={6}
      >
        <Text style={[styles.numBtnText, { color: theme.text }]}>-</Text>
      </Pressable>
      <Text style={[styles.body, styles.numValue, { color: theme.text }]}>{label}</Text>
      <Pressable
        onPress={() => onChange(addDays(date, 1))}
        style={[styles.numBtn, { borderColor: theme.border }]}
        hitSlop={6}
      >
        <Text style={[styles.numBtnText, { color: theme.text }]}>+</Text>
      </Pressable>
    </View>
  );
}

export function ColorTokenPicker({
  theme,
  selected,
  onSelect,
}: {
  theme: ThemePalette;
  selected: string;
  onSelect: (t: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {CATEGORY_TOKENS.map((t) => (
        <Pressable
          key={t}
          onPress={() => onSelect(t)}
          style={[
            styles.swatch,
            {
              backgroundColor: categoryColor(t),
              borderColor: selected === t ? theme.text : 'transparent',
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space(1.5) },
  caption: { ...type.caption, textTransform: 'uppercase' },
  body: { ...type.body },
  small: { ...type.small },
  input: {
    ...type.body,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: TAP,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space(1.5),
    minHeight: TAP,
    justifyContent: 'center',
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  swatch: { width: TAP, height: TAP, borderRadius: TAP / 2, borderWidth: 2 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TAP,
  },
  timeButton: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    minHeight: TAP,
    justifyContent: 'center',
  },
  timeButtonText: { ...type.h2, fontVariant: ['tabular-nums'] },
  numStepper: { gap: space(0.5) },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  numBtn: {
    width: TAP,
    height: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBtnText: { fontSize: 20, fontWeight: '600' },
  numValue: { minWidth: 64, textAlign: 'center' },
  timePreview: { ...type.h2, fontVariant: ['tabular-nums'], marginLeft: space(1) },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TAP,
    gap: space(2),
  },
  submit: {
    borderRadius: radius.md,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space(1),
  },
  submitText: { fontSize: 16, fontWeight: '600' },
});
