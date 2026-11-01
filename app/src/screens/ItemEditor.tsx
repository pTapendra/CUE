import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Course, Item, ItemInput, ItemKind, ItemStatus } from '../api/types';
import { fromInput, toInput } from '../dates';
import { Button, Chip, Field } from '../ui/components';
import { useTheme } from '../ui/theme';

const KINDS: { value: ItemKind; label: string }[] = [
  { value: 'assignment', label: 'Assignment' },
  { value: 'exam', label: 'Exam' },
  { value: 'event', label: 'Other' },
];

export const STATUSES: { value: ItemStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'postponed', label: 'Postponed' },
];

/** Add or edit one schedule item. `item` is null when adding. */
export function ItemEditor({
  visible,
  item,
  courses,
  onSave,
  onStatus,
  onDelete,
  onClose,
}: {
  visible: boolean;
  item: Item | null;
  courses: Course[];
  onSave: (input: ItemInput) => Promise<boolean>;
  onStatus: (status: ItemStatus) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTheme();
  const [title, setTitle] = useState(item?.title ?? '');
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? 'assignment');
  const [due, setDue] = useState(toInput(item?.dueAt ?? null));
  const [courseId, setCourseId] = useState<string | null>(item?.courseId ?? null);
  const [busy, setBusy] = useState(false);

  const parsedDue = fromInput(due);
  const dueError = parsedDue === undefined ? 'Use the form 2026-11-06 or 2026-11-06 14:00' : undefined;
  const canSave = title.trim().length > 0 && parsedDue !== undefined && !busy;

  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    const ok = await action();
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: t.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: t.text }]}>{item ? 'Edit item' : 'Add item'}</Text>
          {item?.source === 'canvas' ? (
            <Text style={{ color: t.muted, fontSize: 13 }}>
              From Canvas. Your changes stay in Cue; the next sync may update the title and date.
            </Text>
          ) : null}

          <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Statistics midterm" />

          <View style={styles.group}>
            <Text style={[styles.label, { color: t.text }]}>Type</Text>
            <View style={styles.chips}>
              {KINDS.map((k) => (
                <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />
              ))}
            </View>
          </View>

          <Field
            label="Due or exam date"
            value={due}
            onChangeText={setDue}
            placeholder="YYYY-MM-DD HH:mm"
            autoCapitalize="none"
            hint="Leave empty if you don't know it yet. A date without a time means 23:59."
            error={dueError}
          />

          {courses.length > 0 ? (
            <View style={styles.group}>
              <Text style={[styles.label, { color: t.text }]}>Course</Text>
              <View style={styles.chips}>
                <Chip label="None" selected={courseId === null} onPress={() => setCourseId(null)} />
                {courses.map((c) => (
                  <Chip key={c.id} label={c.code ?? c.name} selected={courseId === c.id} onPress={() => setCourseId(c.id)} />
                ))}
              </View>
            </View>
          ) : null}

          {item ? (
            <View style={styles.group}>
              <Text style={[styles.label, { color: t.text }]}>Status</Text>
              <View style={styles.chips}>
                {STATUSES.map((s) => (
                  <Chip
                    key={s.value}
                    label={s.label}
                    selected={item.status === s.value}
                    onPress={() => run(() => onStatus(s.value))}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              title="Save"
              busy={busy}
              disabled={!canSave}
              onPress={() => run(() => onSave({ title: title.trim(), kind, dueAt: parsedDue ?? null, courseId }))}
            />
            <Button title="Cancel" variant="secondary" onPress={onClose} />
            {item ? <Button title="Delete" variant="danger" onPress={() => run(onDelete)} /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { gap: 10, marginTop: 8 },
});
