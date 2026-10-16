import { useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Calendar, Clock } from 'lucide-react-native';
import type { Category, Recurrence, TaskPriority } from '../db/types';
import {
  CATEGORY_TOKENS,
  categoryColor,
  dark,
  light,
  radius,
  space,
  TAP,
  type,
  type ThemePalette,
} from '../theme/tokens';
import { addDays, localDateString } from '../db/time';
import { useUiStore } from '../state/ui';
import { Button } from './Button';
import { Card } from './Card';
import { PressableScale } from './PressableScale';
import { Slider } from './Slider';
import { Switch } from './Switch';

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
  notes?: string;
}

interface Props {
  categories: Category[];
  /** Show the free "instance date" picker (add-task). Hidden in onboarding. */
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

export function TaskForm({
  categories,
  showInstanceDate,
  initialDate,
  initialValues,
  submitLabel,
  onSubmit,
}: Props) {
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initialValues?.categoryId ?? null);
  const [recurrence, setRecurrence] = useState<Recurrence>(initialValues?.recurrence ?? 'once');
  const [customDays, setCustomDays] = useState<number[]>(initialValues?.customDays ?? []);
  const [date, setDate] = useState(initialValues?.date ?? initialDate ?? localDateString());
  const [alarmEnabled, setAlarmEnabled] = useState(initialValues?.alarmEnabled ?? true);
  const [hour, setHour] = useState(initialValues?.hour ?? 9);
  const [minute, setMinute] = useState(initialValues?.minute ?? 0);
  const [durationMin, setDurationMin] = useState(initialValues?.durationMin ?? 30);
  const [isRitual, setIsRitual] = useState(initialValues?.isRitual ?? false);
  const [priority, setPriority] = useState<TaskPriority>(initialValues?.priority ?? 'medium');
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) =>
    setCustomDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const submit = () => {
    if (!title.trim()) {
      setError('Enter a task title.');
      return;
    }
    if (recurrence === 'custom' && customDays.length === 0) {
      setError('Select at least one day for a custom schedule.');
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
      notes: notes.trim(),
    });
  };

  return (
    <View style={styles.form}>
      {/* Title */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.caption, { color: theme.textFaint }]}>TITLE</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What needs to be done?"
          placeholderTextColor={theme.textFaint}
          style={[
            styles.input,
            {
              color: theme.text,
              borderColor: theme.border,
              backgroundColor: theme.surface2,
            },
          ]}
        />
      </View>

      {/* Category */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.caption, { color: theme.textFaint }]}>CATEGORY</Text>
        <View style={styles.chips}>
          <Chip
            theme={theme}
            label="None"
            selected={categoryId === null}
            onPress={() => setCategoryId(null)}
          />
          {categories.map((c) => (
            <Chip
              key={c.id}
              theme={theme}
              label={c.name}
              dot={categoryColor(c.colorToken, theme)}
              selected={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </View>
      </View>

      {/* Priority */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.caption, { color: theme.textFaint }]}>PRIORITY</Text>
        <View style={styles.EqualRow}>
          {PRIORITY_OPTIONS.map((p) => {
            const active = priority === p.key;
            return (
              <PressableScale
                key={p.key}
                onPress={() => setPriority(p.key)}
                style={styles.equalCell}
                innerStyle={[
                  styles.equalChip,
                  {
                    backgroundColor: active ? theme.accent : theme.surface2,
                    borderColor: active ? theme.accent : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.equalChipText,
                    { color: active ? theme.onAccent : theme.textDim },
                  ]}
                >
                  {p.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </View>

      {/* Recurrence */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.caption, { color: theme.textFaint }]}>RECURRENCE</Text>
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
          <View style={[styles.chips, { marginTop: space(1) }]}>
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
      </View>

      {/* Date Picker Strip */}
      {(recurrence === 'once' || showInstanceDate) && (
        <View style={styles.fieldGroup}>
          <Text style={[styles.caption, { color: theme.textFaint }]}>DATE</Text>
          <DateStepper
            theme={theme}
            date={date}
            minDate={localDateString()}
            onChange={setDate}
          />
        </View>
      )}

      {/* Duration Slider */}
      <Card padding={2}>
        <Slider
          label="Duration"
          value={durationMin}
          min={5}
          max={240}
          step={5}
          suffix="m"
          presets={[15, 30, 45, 60, 90, 120]}
          onChange={setDurationMin}
        />
      </Card>

      {/* Alarm Switch + Time Sliders */}
      <Card padding={2}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.bodyMedium, { color: theme.text }]}>Scheduled Alarm</Text>
            <Text style={[styles.small, { color: theme.textDim }]}>
              Alert with sound and full-screen prompt at scheduled time
            </Text>
          </View>
          <Switch
            value={alarmEnabled}
            onValueChange={setAlarmEnabled}
            accessibilityLabel="Toggle alarm"
          />
        </View>

        {alarmEnabled && (
          <View style={styles.alarmBody}>
            <View style={styles.timePickerHeader}>
              <Text style={[styles.caption, { color: theme.textFaint }]}>ALARM TIME</Text>
              <NativeTimeButton
                theme={theme}
                hour={hour}
                minute={minute}
                onChange={(h, m) => {
                  setHour(h);
                  setMinute(m);
                }}
              />
            </View>
            <Slider
              label="Hour (24h)"
              value={hour}
              min={0}
              max={23}
              step={1}
              formatValue={(v) => `${pad2(v)}:00`}
              presets={[6, 9, 12, 15, 18, 21]}
              onChange={setHour}
            />
            <Slider
              label="Minute"
              value={minute}
              min={0}
              max={55}
              step={5}
              formatValue={(v) => `:${pad2(v)}`}
              presets={[0, 15, 30, 45]}
              onChange={setMinute}
            />
          </View>
        )}
      </Card>

      {/* Ritual Switch */}
      <Card padding={2}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.bodyMedium, { color: theme.text }]}>Morning Ritual</Text>
            <Text style={[styles.small, { color: theme.textDim }]}>
              Anchor task pinned to the top of your day
            </Text>
          </View>
          <Switch
            value={isRitual}
            onValueChange={setIsRitual}
            accessibilityLabel="Toggle ritual"
          />
        </View>
      </Card>

      {/* Notes */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.caption, { color: theme.textFaint }]}>NOTES</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional context, checklist, or constraints…"
          placeholderTextColor={theme.textFaint}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          style={[
            styles.notesInput,
            {
              color: theme.text,
              borderColor: theme.border,
              backgroundColor: theme.surface2,
            },
          ]}
        />
      </View>

      {error && (
        <Text style={[styles.small, { color: theme.text }]}>{error}</Text>
      )}

      <View style={{ marginTop: space(1) }}>
        <Button
          label={submitLabel}
          variant="primary"
          size="lg"
          fullWidth
          onPress={submit}
        />
      </View>
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
    <PressableScale
      onPress={onPress}
      hitSlop={4}
      innerStyle={[
        styles.chip,
        {
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.accent : theme.surface2,
        },
      ]}
    >
      {dot && (
        <View
          style={[
            styles.chipDot,
            { backgroundColor: selected ? theme.onAccent : dot },
          ]}
        />
      )}
      <Text
        style={[
          styles.chipText,
          { color: selected ? theme.onAccent : theme.textDim },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * Replaces the legacy +/- stepper with our tactile detent Slider.
 */
export function NumStepper({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  theme?: ThemePalette;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <Slider
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      suffix={suffix}
      onChange={onChange}
    />
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
    if (Platform.OS === 'android') setShow(false);
    if (event.type === 'set' && selected) {
      onChange(selected.getHours(), selected.getMinutes());
    }
  };

  return (
    <View>
      <PressableScale
        onPress={() => setShow(true)}
        innerStyle={[
          styles.timeButton,
          { borderColor: theme.borderStrong, backgroundColor: theme.surface2 },
        ]}
      >
        <Clock color={theme.textDim} size={15} strokeWidth={2} />
        <Text style={[styles.timeButtonText, { color: theme.text }]}>
          {pad2(hour)}:{pad2(minute)}
        </Text>
      </PressableScale>
      {show && (
        <DateTimePicker
          value={value}
          mode="time"
          is24Hour
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
  const [showPicker, setShowPicker] = useState(false);
  const today = localDateString();
  const baseDate = minDate > today ? minDate : today;

  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDays(baseDate, i)),
    [baseDate]
  );

  const formatDayChip = (d: string) => {
    if (d === today) return 'Today';
    if (d === addDays(today, 1)) return 'Tomorrow';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  const pickerVal = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
  }, [date]);

  const onPickDate = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'set' && selected) {
      onChange(localDateString(selected));
    }
  };

  return (
    <View style={{ gap: space(1) }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dateScroll}
      >
        {days.map((d) => {
          const active = d === date;
          return (
            <PressableScale
              key={d}
              onPress={() => onChange(d)}
              hitSlop={4}
              innerStyle={[
                styles.datePill,
                {
                  backgroundColor: active ? theme.accent : theme.surface2,
                  borderColor: active ? theme.accent : theme.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.datePillText,
                  { color: active ? theme.onAccent : theme.textDim },
                ]}
              >
                {formatDayChip(d)}
              </Text>
            </PressableScale>
          );
        })}
        <PressableScale
          onPress={() => setShowPicker(true)}
          hitSlop={4}
          innerStyle={[
            styles.datePill,
            { backgroundColor: theme.surface2, borderColor: theme.borderStrong },
          ]}
        >
          <Calendar color={theme.text} size={14} strokeWidth={2} />
          <Text style={[styles.datePillText, { color: theme.text }]}>Pick date</Text>
        </PressableScale>
      </ScrollView>
      {showPicker && (
        <DateTimePicker
          value={pickerVal}
          mode="date"
          display={Platform.OS === 'android' ? 'default' : 'spinner'}
          onChange={onPickDate}
        />
      )}
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
      {CATEGORY_TOKENS.map((t) => {
        const active = selected === t;
        return (
          <PressableScale
            key={t}
            onPress={() => onSelect(t)}
            innerStyle={[
              styles.swatch,
              {
                backgroundColor: categoryColor(t, theme),
                borderColor: active ? theme.accent : theme.border,
                borderWidth: active ? 2.5 : 1,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space(2) },
  fieldGroup: { gap: space(1) },
  caption: { ...type.caption, textTransform: 'uppercase' },
  bodyMedium: { ...type.bodyMedium },
  small: { ...type.small },
  input: {
    ...type.body,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: TAP,
  },
  notesInput: {
    ...type.body,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
    minHeight: 84,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space(2),
    minHeight: 42,
    justifyContent: 'center',
  },
  chipDot: { width: 7, height: 7, borderRadius: 3.5 },
  chipText: {
    ...type.small,
    fontWeight: '600',
  },
  EqualRow: {
    flexDirection: 'row',
    gap: space(1),
  },
  equalCell: {
    flex: 1,
  },
  equalChip: {
    minHeight: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  equalChipText: {
    ...type.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  swatch: {
    width: TAP,
    height: TAP,
    borderRadius: TAP / 2,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TAP,
    gap: space(2),
  },
  alarmBody: {
    marginTop: space(2),
    paddingTop: space(2),
    gap: space(2),
  },
  timePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: 42,
    justifyContent: 'center',
  },
  timeButtonText: {
    ...type.mono,
    fontSize: 16,
    fontWeight: '700',
  },
  dateScroll: {
    gap: space(1),
    paddingVertical: 2,
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: 44,
    justifyContent: 'center',
  },
  datePillText: {
    ...type.small,
    fontWeight: '600',
  },
});
