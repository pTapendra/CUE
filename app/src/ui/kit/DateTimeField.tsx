import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { dayLabel, timeLabel } from '../../dates';
import { radius, space, type, useTokens } from '../tokens';

type Mode = 'datetime' | 'date' | 'time';
type Props = {
  label: string;
  value: string | null;
  mode: Mode;
  onChange: (iso: string | null) => void;
  allowClear?: boolean;
  /** What the field reads while it has no value. */
  clearLabel?: string;
  /** The text and screen-reader label of the button that clears the value (with `allowClear`). */
  clearButtonLabel?: string;
};

function format(d: Date, mode: Mode): string {
  if (mode === 'date') return dayLabel(d);
  if (mode === 'time') return timeLabel(d);
  return `${dayLabel(d)} · ${timeLabel(d)}`;
}

export function DateTimeField({
  label,
  value,
  mode,
  onChange,
  allowClear = false,
  clearLabel = 'No date',
  clearButtonLabel = 'Clear',
}: Props) {
  const { colors } = useTokens();
  // 'closed', or the picker currently showing (Android shows date, then time).
  const [open, setOpen] = useState<'closed' | 'date' | 'time' | 'datetime'>('closed');
  const [pending, setPending] = useState<Date | null>(null);
  const current = value ? new Date(value) : null;
  const shown = pending ?? current ?? new Date();

  const start = () => {
    setPending(null);
    setOpen(Platform.OS === 'android' && mode === 'datetime' ? 'date' : mode);
  };

  const onIos = (_e: DateTimePickerEvent, date?: Date) => {
    if (!date) return;
    setPending(date);
    onChange(date.toISOString());
  };
  const doneIos = () => {
    if (!current && !pending) onChange(shown.toISOString());
    setOpen('closed');
  };

  const onAndroid = (e: DateTimePickerEvent, date?: Date) => {
    if (e.type !== 'set' || !date) {
      setOpen('closed');
      return;
    }
    if (open === 'date' && mode === 'datetime') {
      setPending(date);
      setOpen('time');
      return;
    }
    setOpen('closed');
    onChange(date.toISOString());
  };

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current ? format(current, mode) : clearLabel }}
        onPress={start}
        style={[styles.field, { backgroundColor: colors.bg2 }]}
      >
        <Text style={[type.bodyStrong, { color: current ? colors.text : colors.text2 }]}>
          {current ? format(current, mode) : clearLabel}
        </Text>
      </Pressable>
      {allowClear && current ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearButtonLabel}
          onPress={() => onChange(null)}
          style={styles.clear}
        >
          <Text style={[type.bodyStrong, { color: colors.accent }]}>{clearButtonLabel}</Text>
        </Pressable>
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open !== 'closed'} transparent animationType="slide" onRequestClose={doneIos}>
          <View style={styles.backdrop}>
            <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={doneIos} style={styles.done}>
                <Text style={[type.bodyStrong, { color: colors.accent }]}>Done</Text>
              </Pressable>
              {open !== 'closed' ? (
                <DateTimePicker value={shown} mode={mode} display="spinner" onChange={onIos} />
              ) : null}
            </View>
          </View>
        </Modal>
      ) : open !== 'closed' ? (
        <DateTimePicker value={shown} mode={open === 'time' ? 'time' : 'date'} onChange={onAndroid} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  field: { minHeight: 44, borderRadius: radius.md, paddingHorizontal: space.lg, justifyContent: 'center' },
  clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl },
  done: { minHeight: 44, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: space.lg },
});
