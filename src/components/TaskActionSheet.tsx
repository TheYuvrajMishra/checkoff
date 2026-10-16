/**
 * CheckOff — long-press task action sheet.
 * Uses our velocity-aware drag-to-dismiss Sheet component.
 * Actions: Start Focus Timer, Edit, Duplicate, Reschedule (quick day chips + picker), Delete (two-tap confirm).
 */
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { CalendarDays, Copy, Pencil, Play, Trash2 } from 'lucide-react-native';
import { useTasksStore } from '../state/tasks';
import { HIT_SLOP, radius, space, TAP, type, useTheme, type ThemePalette } from '../theme/tokens';
import type { TaskInstance } from '../db/types';
import { addDays, localDateString } from '../db/time';
import { PressableScale } from './PressableScale';
import { Sheet } from './Sheet';
import { Button } from './Button';

interface Props {
  instance: TaskInstance | null;
  initialView?: 'menu' | 'reschedule';
  onClose: () => void;
  onEdit: (instance: TaskInstance) => void;
}

type SheetView = 'menu' | 'reschedule';

export function TaskActionSheet({ instance, initialView = 'menu', onClose, onEdit }: Props) {
  const theme = useTheme();
  const duplicateTask = useTasksStore((s) => s.duplicateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const rescheduleTask = useTasksStore((s) => s.rescheduleTask);

  const [view, setView] = useState<SheetView>(initialView);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickDate, setPickDate] = useState(false);

  useEffect(() => {
    if (!instance) return;
    setView(initialView);
    setConfirmDelete(false);
    setPickDate(false);
  }, [instance, initialView]);

  if (!instance) return null;

  const today = localDateString();
  const quickDates = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: '+2 Days', date: addDays(today, 2) },
    { label: 'Next Week', date: addDays(today, 7) },
  ];

  const handleDuplicate = async () => {
    await duplicateTask(instance.id);
    onClose();
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteTask(instance.id);
    onClose();
  };

  const handleMoveToDate = async (targetDate: string) => {
    await rescheduleTask(instance.id, targetDate);
    onClose();
  };

  const handleDatePicked = async (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickDate(false);
    if (event.type === 'set' && selected) {
      const y = selected.getFullYear();
      const m = String(selected.getMonth() + 1).padStart(2, '0');
      const d = String(selected.getDate()).padStart(2, '0');
      const target = `${y}-${m}-${d}`;
      if (target >= today) {
        await handleMoveToDate(target);
      }
    }
  };

  const dateValue = (() => {
    const [y, m, d] = instance.date.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  })();

  const subtitle = `${instance.date}${instance.alarmTime ? ` · ${instance.alarmTime}` : ''} · ${instance.durationMin}m`;

  return (
    <Sheet
      visible={!!instance}
      onClose={onClose}
      title={instance.title}
      subtitle={subtitle}
    >
      {view === 'menu' ? (
        <View style={styles.actions}>
          {instance.status === 'pending' && (
            <MenuRow
              theme={theme}
              icon={<Play color={theme.text} size={18} strokeWidth={2} />}
              label="Start Focus Timer"
              hint={`Run a ${instance.durationMin} min session`}
              onPress={() => {
                onClose();
                router.push({ pathname: '/timer', params: { instanceId: instance.id } });
              }}
            />
          )}
          <MenuRow
            theme={theme}
            icon={<Pencil color={theme.text} size={18} strokeWidth={2} />}
            label="Edit Task"
            hint="Modify title, schedule, duration, or priority"
            onPress={() => onEdit(instance)}
          />
          <MenuRow
            theme={theme}
            icon={<CalendarDays color={theme.text} size={18} strokeWidth={2} />}
            label="Move to Another Day"
            hint="Reschedule this instance"
            onPress={() => setView('reschedule')}
          />
          <MenuRow
            theme={theme}
            icon={<Copy color={theme.text} size={18} strokeWidth={2} />}
            label="Duplicate"
            hint="Create a copy on the same day"
            onPress={() => void handleDuplicate()}
          />
          <MenuRow
            theme={theme}
            icon={<Trash2 color={confirmDelete ? theme.bg : theme.textDim} size={18} strokeWidth={2} />}
            label={confirmDelete ? 'Tap again to confirm removal' : 'Remove Task'}
            hint={confirmDelete ? 'Disables template and logs removal' : 'Soft remove — logged in history'}
            active={confirmDelete}
            onPress={() => void handleDelete()}
          />
        </View>
      ) : (
        <View style={styles.rescheduleWrap}>
          <Text style={[styles.sectionCaption, { color: theme.textFaint }]}>QUICK MOVE</Text>
          <View style={styles.quickGrid}>
            {quickDates.map((q) => {
              const isCurrent = q.date === instance.date;
              return (
                <PressableScale
                  key={q.date}
                  hitSlop={HIT_SLOP}
                  onPress={() => void handleMoveToDate(q.date)}
                  style={styles.quickCell}
                  innerStyle={[
                    styles.quickCellInner,
                    {
                      backgroundColor: isCurrent ? theme.text : theme.surface2,
                      borderColor: isCurrent ? theme.text : theme.border,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.quickLabel,
                      { color: isCurrent ? theme.bg : theme.text },
                    ]}
                  >
                    {q.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.quickDate,
                      { color: isCurrent ? theme.bg : theme.textFaint },
                    ]}
                  >
                    {q.date}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          <Button
            label="Pick Custom Date"
            variant="secondary"
            fullWidth
            icon={<CalendarDays color={theme.text} size={18} strokeWidth={2} />}
            onPress={() => setPickDate(true)}
          />

          {pickDate && (
            <DateTimePicker
              value={dateValue}
              mode="date"
              minimumDate={new Date()}
              display={Platform.OS === 'android' ? 'default' : 'spinner'}
              onChange={(e, d) => void handleDatePicked(e, d)}
            />
          )}

          <Button
            label="Back to Actions"
            variant="ghost"
            fullWidth
            onPress={() => setView('menu')}
          />
        </View>
      )}
    </Sheet>
  );
}

function MenuRow({
  theme,
  icon,
  label,
  hint,
  onPress,
  active = false,
}: {
  theme: ThemePalette;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={HIT_SLOP}
      style={styles.menuRowWrap}
      innerStyle={[
        styles.menuRowInner,
        {
          backgroundColor: active ? theme.text : theme.surface2,
          borderColor: active ? theme.text : theme.border,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.iconBox,
          {
            backgroundColor: active ? theme.bg : theme.surface3,
            borderColor: theme.border,
          },
        ]}
      >
        {active ? <Trash2 color={theme.text} size={18} strokeWidth={2} /> : icon}
      </View>
      <View style={styles.menuText}>
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color: active ? theme.bg : theme.text },
          ]}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            styles.hint,
            { color: active ? theme.bg : theme.textDim, opacity: active ? 0.8 : 1 },
          ]}
        >
          {hint}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  actions: {
    paddingBottom: space(1),
    gap: space(1),
  },
  menuRowWrap: {
    width: '100%',
  },
  menuRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    paddingHorizontal: space(1.5),
    paddingVertical: space(1.25),
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: TAP + 8,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...type.h3,
  },
  hint: {
    ...type.small,
  },
  rescheduleWrap: {
    paddingBottom: space(1),
    gap: space(1.5),
  },
  sectionCaption: {
    ...type.caption,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(1),
  },
  quickCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  quickCellInner: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space(1.5),
    paddingHorizontal: space(1.5),
    minHeight: TAP + 8,
    justifyContent: 'center',
    gap: 2,
  },
  quickLabel: {
    ...type.h3,
  },
  quickDate: {
    ...type.mono,
    fontSize: 12,
  },
});
