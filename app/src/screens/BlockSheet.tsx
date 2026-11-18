import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StudyBlock } from '../api/types';
import { dayLabel, timeLabel } from '../dates';
import { Button, ErrorBanner, Field } from '../ui/components';
import { useTheme } from '../ui/theme';

const MAX_HOURS = 40;

/** What you can do with one study block: accept it, move it, ask for another slot, or change the study time. */
export function BlockSheet({
  block,
  studyHours,
  error,
  onAccept,
  onReject,
  onMove,
  onStudyHours,
  onClose,
}: {
  block: StudyBlock;
  studyHours: number;
  error?: string | null;
  onAccept: () => Promise<boolean>;
  onReject: () => Promise<boolean>;
  onMove: (text: string) => Promise<boolean>;
  onStudyHours: (hours: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTheme();
  const [moving, setMoving] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const start = new Date(block.startsAt);
  const end = new Date(block.endsAt);
  const due = block.itemDueAt ? new Date(block.itemDueAt) : null;
  const exam = block.itemKind === 'exam';

  /** Closes the sheet when the action worked; otherwise it stays open so the message is visible. */
  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    const ok = await action();
    setBusy(false);
    if (ok) onClose();
  }

  function step(delta: number) {
    const next = Math.min(MAX_HOURS, Math.max(0, studyHours + delta));
    if (next !== studyHours) onStudyHours(next);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.background, borderColor: t.border }]}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.grab, { backgroundColor: t.border }]} />
          <ErrorBanner message={error ?? null} />
          <Text style={[styles.title, { color: t.text }]}>{`Study: ${block.itemTitle}`}</Text>
          <Text style={[styles.detail, { color: t.muted }]}>
            {`${dayLabel(start)} · ${timeLabel(start)}–${timeLabel(end)}`}
          </Text>
          {due ? (
            <Text style={[styles.detail, { color: t.muted }]}>
              {`Block ${block.index} of ${block.total} before the ${exam ? 'exam' : 'deadline'} on ${dayLabel(due)}, ${timeLabel(due)}.`}
            </Text>
          ) : null}
          {block.clash ? (
            <Text style={[styles.detail, { color: t.danger }]}>
              {`Clashes with ${block.clash.title} ${timeLabel(new Date(block.clash.startsAt))}–${timeLabel(new Date(block.clash.endsAt))}.`}
            </Text>
          ) : null}

          {block.state === 'proposed' ? <Button title="Accept" busy={busy} onPress={() => run(onAccept)} /> : null}
          <Button title="Move to another time" variant="secondary" onPress={() => setMoving((m) => !m)} />
          {moving ? (
            <View style={styles.move}>
              <Field
                label="New start"
                value={text}
                onChangeText={setText}
                placeholder="YYYY-MM-DD HH:mm"
                autoCapitalize="none"
              />
              <Button title="Move here" busy={busy} onPress={() => run(() => onMove(text.trim()))} />
            </View>
          ) : null}
          <Button title="Not this time" variant="secondary" busy={busy} onPress={() => run(onReject)} />

          <View style={[styles.stepperRow, { borderColor: t.border }]}>
            <Text style={[styles.stepperLabel, { color: t.text }]}>
              {`Study time for this ${exam ? 'exam' : 'assignment'}`}
            </Text>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="Less study time" hitSlop={8} onPress={() => step(-1)}>
                <Text style={[styles.stepButton, { color: t.primary }]}>–</Text>
              </Pressable>
              <Text style={{ color: t.text }}>{`${studyHours} h`}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="More study time" hitSlop={8} onPress={() => step(1)}>
                <Text style={[styles.stepButton, { color: t.primary }]}>+</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '75%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1 },
  body: { padding: 20, gap: 10 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '700' },
  detail: { fontSize: 13 },
  move: { gap: 10 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
  },
  stepperLabel: { fontSize: 14, flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepButton: { fontSize: 24, paddingHorizontal: 8 },
});
