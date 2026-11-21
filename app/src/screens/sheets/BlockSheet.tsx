import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StudyBlock } from '../../api/types';
import { dayLabel, timeLabel } from '../../dates';
import { Button, DateTimeField, ErrorBanner, Stepper, Tag } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';

const MAX_HOURS = 40;

/**
 * What you can do with one study block: accept it, move it, ask for another slot, or change the study time.
 * `startMoving` opens it with the time picker for moving already shown (Today's Move).
 */
export function BlockSheet({
  block,
  studyHours,
  error,
  startMoving = false,
  onAccept,
  onReject,
  onMove,
  onStudyHours,
  onClose,
}: {
  block: StudyBlock;
  studyHours: number;
  error?: string | null;
  startMoving?: boolean;
  onAccept: () => Promise<boolean>;
  onReject: () => Promise<boolean>;
  onMove: (startsAtIso: string) => Promise<boolean>;
  onStudyHours: (hours: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const { colors } = useTokens();
  const [moving, setMoving] = useState(startMoving);
  const [newStart, setNewStart] = useState<string | null>(null);
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
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.bg, borderColor: colors.line }]}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.grab, { backgroundColor: colors.line }]} />
          {error ? <ErrorBanner message={error} /> : null}
          <Text style={[type.title, { color: colors.text }]}>{`Study: ${block.itemTitle}`}</Text>
          {block.courseName ? <Text style={[type.bodyStrong, { color: colors.text2 }]}>{block.courseName}</Text> : null}
          <Text style={[type.body, { color: colors.text2 }]}>
            {`${dayLabel(start)} · ${timeLabel(start)}–${timeLabel(end)}`}
          </Text>
          <Tag label={block.state === 'proposed' ? 'Suggested' : 'Accepted'} tone={block.state === 'proposed' ? 'warn' : 'ok'} />
          {due ? (
            <Text style={[type.body, { color: colors.text2 }]}>
              {`Block ${block.index} of ${block.total} before the ${exam ? 'exam' : 'deadline'} on ${dayLabel(due)}, ${timeLabel(due)}.`}
            </Text>
          ) : null}
          {block.clash ? (
            <Text style={[type.bodyStrong, { color: colors.danger }]}>
              {`Clashes with ${block.clash.title} ${timeLabel(new Date(block.clash.startsAt))}–${timeLabel(new Date(block.clash.endsAt))}.`}
            </Text>
          ) : null}

          {block.state === 'proposed' ? <Button title="Accept" busy={busy} onPress={() => run(onAccept)} /> : null}
          <Button title="Move" variant="secondary" onPress={() => setMoving((m) => !m)} />
          {moving ? (
            <View style={styles.move}>
              <DateTimeField label="New start" mode="datetime" value={newStart} clearLabel="Pick a time" onChange={setNewStart} />
              <Button
                title="Move here"
                busy={busy}
                disabled={!newStart}
                onPress={() => newStart && run(() => onMove(newStart))}
              />
            </View>
          ) : null}
          <Button title="Not this time" variant="secondary" busy={busy} onPress={() => run(onReject)} />

          <View style={[styles.hoursRow, { borderColor: colors.line }]}>
            <Text style={[type.body, styles.hoursLabel, { color: colors.text }]}>
              {`This needs ${studyHours} ${studyHours === 1 ? 'hour' : 'hours'} of study`}
            </Text>
            <Stepper
              label="Study time"
              value={`${studyHours} h`}
              onMinus={() => step(-1)}
              onPlus={() => step(1)}
              minusDisabled={studyHours <= 0}
              plusDisabled={studyHours >= MAX_HOURS}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '75%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: 1 },
  body: { padding: space.lg, gap: space.sm },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space.xs },
  move: { gap: space.sm },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderTopWidth: 1,
    paddingTop: space.md,
    marginTop: space.xs,
  },
  hoursLabel: { flex: 1 },
});
