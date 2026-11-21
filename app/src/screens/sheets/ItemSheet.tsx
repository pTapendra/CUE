import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Course, Item, ItemInput, ItemKind, ItemStatus } from '../../api/types';
import { Button, DateTimeField, SegmentedControl, Stepper } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';

const KINDS: { value: ItemKind; label: string }[] = [
  { value: 'assignment', label: 'Assignment' },
  { value: 'exam', label: 'Exam' },
  { value: 'event', label: 'Event' },
];

export const STATUSES: { value: ItemStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'postponed', label: 'Postponed' },
];

const MAX_STUDY_HOURS = 40;

/** Hours a new exam or assignment starts with. */
function defaultHours(kind: ItemKind): number {
  return kind === 'exam' ? 6 : 2;
}

/** Add or edit one schedule item. `item` is null when adding. */
export function ItemSheet({
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
  const { colors } = useTokens();
  const [title, setTitle] = useState(item?.title ?? '');
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? 'assignment');
  const [due, setDue] = useState<string | null>(item?.dueAt ?? null);
  const [ends, setEnds] = useState<string | null>(item?.endsAt ?? null);
  const [courseId, setCourseId] = useState<string | null>(item?.courseId ?? null);
  // null until the student touches the stepper, so the default follows the type.
  const [pickedHours, setPickedHours] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const needsStudy = kind === 'exam' || kind === 'assignment';
  // The item's own amount while it keeps its type; after a switch, the new type's default.
  const initialHours = item?.studyMinutes != null && kind === item.kind ? item.studyMinutes / 60 : defaultHours(kind);
  const hours = pickedHours ?? initialHours;

  const endsError =
    kind === 'event' && due && ends && Date.parse(ends) <= Date.parse(due) ? 'Ends must be after the start' : undefined;
  const canSave = title.trim().length > 0 && !endsError && !busy;

  function save() {
    const input: ItemInput = { title: title.trim(), kind, dueAt: due, courseId };
    if (kind === 'event') input.endsAt = ends;
    if (needsStudy && pickedHours !== null && pickedHours !== initialHours) input.studyMinutes = pickedHours * 60;
    return run(() => onSave(input));
  }

  function step(delta: number) {
    setPickedHours(Math.min(MAX_STUDY_HOURS, Math.max(0, hours + delta)));
  }

  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    const ok = await action();
    setBusy(false);
    if (ok) onClose();
  }

  function confirmDelete() {
    Alert.alert('Delete this item?', 'This removes it from your schedule.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(onDelete) },
    ]);
  }

  const label = (text: string) => <Text style={[type.bodyStrong, { color: colors.text }]}>{text}</Text>;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[type.title, { color: colors.text }]}>{item ? 'Edit item' : 'Add item'}</Text>
          {item?.source === 'canvas' ? (
            <Text style={[type.body, { color: colors.text2 }]}>
              From Canvas. Your changes stay in Cue; the next sync may update the title and date.
            </Text>
          ) : null}

          <View style={styles.group}>
            {label('Title')}
            <TextInput
              accessibilityLabel="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Statistics midterm"
              placeholderTextColor={colors.text3}
              style={[type.body, styles.input, { color: colors.text, backgroundColor: colors.bg2 }]}
            />
          </View>

          <View style={styles.group}>
            {label('Type')}
            <SegmentedControl options={KINDS} value={kind} onChange={setKind} />
          </View>

          <View style={styles.group}>
            {label('Due or exam date')}
            <DateTimeField label="Due or exam date" mode="datetime" value={due} onChange={setDue} allowClear />
          </View>

          {kind === 'event' ? (
            <View style={styles.group}>
              {label('Ends')}
              <DateTimeField label="Ends" mode="datetime" value={ends} onChange={setEnds} allowClear clearLabel="No end" />
              {endsError ? <Text style={[type.bodyStrong, { color: colors.danger }]}>{endsError}</Text> : null}
            </View>
          ) : null}

          {needsStudy ? (
            <View style={styles.row}>
              {label('Study time')}
              <Stepper
                label="Study time"
                value={`${hours} h`}
                onMinus={() => step(-1)}
                onPlus={() => step(1)}
                minusDisabled={hours <= 0}
                plusDisabled={hours >= MAX_STUDY_HOURS}
              />
            </View>
          ) : null}

          {courses.length > 0 ? (
            <View style={styles.group}>
              {label('Course')}
              <View style={styles.chips}>
                <CourseChoice label="None" selected={courseId === null} onPress={() => setCourseId(null)} />
                {courses.map((c) => (
                  <CourseChoice
                    key={c.id}
                    label={c.code ?? c.name}
                    selected={courseId === c.id}
                    onPress={() => setCourseId(c.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {item ? (
            <View style={styles.group}>
              {label('Status')}
              <SegmentedControl options={STATUSES} value={item.status} onChange={(s) => run(() => onStatus(s))} />
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button title="Save" busy={busy} disabled={!canSave} onPress={save} />
            <Button title="Cancel" variant="secondary" onPress={onClose} />
            {item ? <Button title="Delete" variant="danger" onPress={confirmDelete} /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CourseChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? colors.accentTint : colors.bg2 }]}>
      <Text style={[type.bodyStrong, { color: selected ? colors.accent : colors.text2 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: space.lg, gap: space.lg },
  group: { gap: space.sm },
  input: { minHeight: 44, borderRadius: radius.md, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 44, borderRadius: radius.pill, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: space.sm, marginTop: space.sm },
});
