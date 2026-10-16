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
import { Calendar, ChevronDown, Clock, Plus } from 'lucide-react-native';
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
  /** Called when user wants to create a new custom category. */
  onCreateCategory?: (name: string) => Promise<Category | null>;
}

const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const RECURRENCES: { key: Recurrence; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekdays', label: 'Weekdays' },
  { key: 'custom', label: 'Custom' },
  { key: 'once', label: 'One-off' },
];

const PRIORITY_OPTIONS: { key: TaskPriority; label: string }[] = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
];

/** Preloaded categories seeded on first run. */
export const DEFAULT_CATEGORIES: { name: string; colorToken: string }[] = [
  { name: 'Work', colorToken: 'slate' },
  { name: 'Health', colorToken: 'rose' },
  { name: 'Learning', colorToken: 'violet' },
  { name: 'Personal', colorToken: 'amber' },
  { name: 'Fitness', colorToken: 'teal' },
];

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * Streamlined task creation — minimal friction UX:
 *
 * CORE (always visible): Title → Category chips → Priority → Create.
 * Smart defaults: today, medium priority, one-off, 30min, alarm 9:00.
 * One-tap create: type a title and hit the button.
 *
 * MORE OPTIONS (collapsed): recurrence, date, duration, alarm, ritual, notes.
 */
export function TaskForm({
  categories,
  showInstanceDate,
  initialDate,
  initialValues,
  submitLabel,
  onSubmit,
  onCreateCategory,
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
  const [showMore, setShowMore] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const toggleDay = (d: number) =>
    setCustomDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const submit = () => {
    if (!title.trim()) {
      setError('Give your task a title.');
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

  const handleAddCategory = async () => {
    const name = newCatName.trim();
    if (!name || !onCreateCategory) return;
    // Cycle through color tokens for new categories
    const token = CATEGORY_TOKENS[categories.length % CATEGORY_TOKENS.length];
    const created = await onCreateCategory(name);
    if (created) {
      setCategoryId(created.id);
      setNewCatName('');
      setAddingCategory(false);
    }
  };

  const selectedCategory = categories.find((c) => c.id === categoryId);

  return (
    <View style={styles.form}>
      {/* ── CORE: Title ── */}
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="What do you want to accomplish?"
        placeholderTextColor={theme.textFaint}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        style={[
          styles.titleInput,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.surface,
          },
        ]}
      />

      {/* ── CORE: Category chips ── */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.caption, { color: theme.textFaint }]}>CATEGORY</Text>
        <View style={styles.chips}>
          {categories.map((c) => (
            <Chip
              key={c.id}
              theme={theme}
              label={c.name}
              dot={categoryColor(c.colorToken, theme.name)}
              selected={categoryId === c.id}
              onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
            />
          ))}
          {onCreateCategory && !addingCategory && (
            <PressableScale
              onPress={() => setAddingCategory(true)}
              hitSlop={4}
              innerStyle={[
                styles.chip,
                styles.addChip,
                { borderColor: theme.border, backgroundColor: 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add custom category"
            >
              <Plus size={14} color={theme.textDim} strokeWidth={2.5} />
              <Text style={[styles.chipText, { color: theme.textDim }]}>New</Text>
            </PressableScale>
          )}
        </View>
        {addingCategory && (
          <View style={styles.addCatRow}>
            <TextInput
              value={newCatName}
              onChangeText={setNewCatName}
              placeholder="Category name…"
              placeholderTextColor={theme.textFaint}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddCategory}
              style={[
                styles.addCatInput,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.surface2,
                },
              ]}
            />
            <PressableScale
              onPress={handleAddCategory}
              disabled={!newCatName.trim()}
              innerStyle={[
                styles.addCatBtn,
                {
                  backgroundColor: newCatName.trim() ? theme.accent : theme.surface2,
                  opacity: newCatName.trim() ? 1 : 0.5,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save category"
            >
              <Text
                style={[
                  styles.addCatBtnText,
                  { color: newCatName.trim() ? theme.onAccent : theme.textDim },
                ]}
              >
                Add
              </Text>
            </PressableScale>
            <PressableScale
              onPress={() => {
                setAddingCategory(false);
                setNewCatName('');
              }}
              innerStyle={styles.addCatCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.small, { color: theme.textDim }]}>Cancel</Text>
            </PressableScale>
          </View>
        )}
      </View>

      {/* ── CORE: Priority ── */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.caption, { color: theme.textFaint }]}>PRIORITY</Text>
        <View style={styles.equalRow}>
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
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${p.label} priority`}
              >
                <Text
                  style={[
                    styles.equalChipText,
                    { color: active ? theme.onAccent : theme.textDim },
                  ]}
                  numberOfLines={1}
                >
                  {p.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </View>

      {/* ── CORE: Create button ── */}
      {error && (
        <Text style={[styles.small, { color: theme.text, textAlign: 'center' }]}>{error}</Text>
      )}
      <Button
        label={submitLabel}
        variant="primary"
        size="lg"
        fullWidth
        onPress={submit}
      />
      {selectedCategory == null && (
        <Text style={[styles.hint, { color: theme.textFaint }]}>
          No category — you can pick one above or add your own.
        </Text>
      )}

      {/* ── MORE OPTIONS (progressive disclosure) ── */}
      <PressableScale
        onPress={() => setShowMore((v) => !v)}
        innerStyle={[
          styles.moreToggle,
          { borderColor: theme.border, backgroundColor: theme.surface },
        ]}
        accessibilityRole="button"
        accessibilityLabel={showMore ? 'Hide more options' : 'Show more options'}
      >
        <Text style={[styles.moreToggleText, { color: theme.textDim }]}>
          {showMore ? 'Fewer options' : 'More options'}
        </Text>
        <ChevronDown
          size={16}
          color={theme.textDim}
          strokeWidth={2}
          style={{ transform: [{ rotate: showMore ? '180deg' : '0deg' }] }}
        />
      </PressableScale>

      {showMore && (
        <View style={styles.moreBody}>
          {/* Recurrence */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.caption, { color: theme.textFaint }]}>REPEAT</Text>
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

          {/* Date */}
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

          {/* Duration */}
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

          {/* Alarm */}
          <Card padding={2}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1, flexShrink: 1, gap: 2 }}>
                <Text
                  style={[styles.bodyMedium, { color: theme.text }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  Scheduled Alarm
                </Text>
                <Text
                  style={[styles.small, { color: theme.textDim }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  Alert with sound at scheduled time
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
              </View>
            )}
          </Card>

          {/* Ritual */}
          <Card padding={2}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1, flexShrink: 1, gap: 2 }}>
                <Text
                  style={[styles.bodyMedium, { color: theme.text }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  Morning Ritual
                </Text>
                <Text
                  style={[styles.small, { color: theme.textDim }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  Pinned to the top of your day
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
              placeholder="Optional context…"
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
        </View>
      )}
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
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
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
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/** Simplified duration/alarm pickers kept for API compat. */
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
        accessibilityRole="button"
        accessibilityLabel={`Alarm time ${pad2(hour)}:${pad2(minute)}`}
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
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.datePillText,
                  { color: active ? theme.onAccent : theme.textDim },
                ]}
                numberOfLines={1}
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
          accessibilityRole="button"
          accessibilityLabel="Pick a date"
        >
          <Calendar color={theme.text} size={14} strokeWidth={2} />
          <Text style={[styles.datePillText, { color: theme.text }]} numberOfLines={1}>
            Pick date
          </Text>
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
                backgroundColor: categoryColor(t, theme.name),
                borderColor: active ? theme.accent : theme.border,
                borderWidth: active ? 2.5 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
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
  hint: {
    ...type.caption,
    textAlign: 'center',
    marginTop: -space(1),
  },
  titleInput: {
    ...type.h2,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
    minHeight: 64,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space(2),
    minHeight: TAP,
    justifyContent: 'center',
    flexShrink: 0,
  },
  addChip: {
    borderStyle: 'dashed',
  },
  chipDot: { width: 7, height: 7, borderRadius: 3.5 },
  chipText: {
    ...type.small,
    fontWeight: '600',
  },
  addCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    marginTop: space(1),
  },
  addCatInput: {
    ...type.body,
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: TAP,
  },
  addCatBtn: {
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCatBtnText: {
    ...type.small,
    fontWeight: '700',
  },
  addCatCancel: {
    paddingHorizontal: space(1),
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  equalRow: {
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
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space(1.5),
  },
  moreToggleText: {
    ...type.small,
    fontWeight: '600',
  },
  moreBody: {
    gap: space(2),
  },
  notesInput: {
    ...type.body,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
    minHeight: 84,
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
    minHeight: TAP,
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
    minHeight: TAP,
    justifyContent: 'center',
    flexShrink: 0,
  },
  datePillText: {
    ...type.small,
    fontWeight: '600',
  },
});
