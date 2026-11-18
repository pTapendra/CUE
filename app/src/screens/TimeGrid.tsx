import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import type { Item, StudyBlock } from '../api/types';
import { dayLabel, sameDay, timeLabel } from '../dates';
import { useTheme } from '../ui/theme';
import {
  deadlinesFor,
  HOUR_HEIGHT,
  placeInDay,
  timedEventsFor,
  type GridRange,
  type Placed,
  type TimedEvent,
} from '../viewmodels/grid';

/** Days side by side: deadlines along the top, then study blocks and timed events at their hours. */
export function TimeGrid({
  days,
  range,
  blocks,
  items,
  onBlock,
  onItem,
  refreshControl,
}: {
  days: Date[];
  range: GridRange;
  blocks: StudyBlock[];
  items: Item[];
  onBlock: (block: StudyBlock) => void;
  onItem: (item: Item) => void;
  refreshControl?: ScrollViewProps['refreshControl'];
}) {
  const t = useTheme();
  const today = new Date();
  const hours = Array.from({ length: range.endHour - range.startHour }, (_, i) => range.startHour + i);

  return (
    <View style={[styles.grid, { backgroundColor: t.surface }]}>
      <View style={styles.row}>
        <View style={styles.gutter} />
        {days.map((day) => (
          <Text key={day.toISOString()} style={[styles.dayLabel, { color: sameDay(day, today) ? t.primary : t.text }]}>
            {dayLabel(day)}
          </Text>
        ))}
      </View>

      <View style={[styles.row, styles.deadlineRow]}>
        <View style={styles.gutter} />
        {days.map((day) => (
          <View key={day.toISOString()} style={styles.deadlines}>
            {deadlinesFor(day, items).map((item) => (
              <Deadline key={item.id} item={item} onPress={() => onItem(item)} />
            ))}
          </View>
        ))}
      </View>

      <ScrollView refreshControl={refreshControl}>
        <View style={styles.row}>
          <View style={styles.gutter}>
            {hours.map((h) => (
              <Text key={h} style={[styles.hour, { color: t.muted }]}>
                {`${String(h).padStart(2, '0')}:00`}
              </Text>
            ))}
          </View>
          {days.map((day) => (
            <View key={day.toISOString()} style={styles.column}>
              {hours.map((h) => (
                <View key={h} style={[styles.slot, { borderColor: t.border }]} />
              ))}
              {placeInDay(day, timedEventsFor(day, items), range).map((placed) => (
                <EventBox key={placed.value.item.id} placed={placed} onPress={() => onItem(placed.value.item)} />
              ))}
              {placeInDay(day, blocks, range).map((placed) => (
                <BlockBox key={placed.value.id} placed={placed} onPress={() => onBlock(placed.value)} />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Deadline({ item, onPress }: { item: Item; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.deadline, { borderColor: item.kind === 'exam' ? t.exam : t.border, backgroundColor: t.background }]}>
      <Text numberOfLines={2} style={[styles.entryTitle, { color: t.text }, item.status === 'done' ? styles.done : null]}>
        {item.kind === 'exam' ? 'Exam: ' : ''}
        {item.title}
      </Text>
      {item.dueAt && !item.allDay ? (
        <Text style={[styles.small, { color: t.muted }]}>{timeLabel(new Date(item.dueAt))}</Text>
      ) : null}
    </Pressable>
  );
}

function BlockBox({ placed: { value: block, top, height }, onPress }: { placed: Placed<StudyBlock>; onPress: () => void }) {
  const t = useTheme();
  const proposed = block.state === 'proposed';
  const clash = !proposed && block.clash !== null;
  const color = proposed ? t.primary : t.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={blockLabel(block)}
      onPress={onPress}
      style={[
        styles.entry,
        frame(top, height),
        { borderColor: t.primary },
        proposed ? [styles.proposed, { backgroundColor: t.surface }] : { backgroundColor: t.primary },
        clash ? [styles.clash, { borderColor: t.danger }] : null,
      ]}>
      <Text numberOfLines={2} style={[styles.entryTitle, { color }]}>
        {block.itemTitle}
      </Text>
      <Text style={[styles.small, { color }]}>{`${block.index} of ${block.total}`}</Text>
    </Pressable>
  );
}

function EventBox({ placed: { value: event, top, height }, onPress }: { placed: Placed<TimedEvent>; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.entry, frame(top, height), { borderColor: t.border, backgroundColor: t.border }]}>
      <Text numberOfLines={2} style={[styles.entryTitle, { color: t.text }]}>
        {event.item.title}
      </Text>
    </Pressable>
  );
}

/** Where an entry sits in its column, 1 px in from its hour lines so back-to-back entries stay apart. */
function frame(top: number, height: number) {
  return { top: top + 1, height: Math.max(height - 2, 1) };
}

/** What a screen reader says for a block, since its state is shown only by its border and fill. */
function blockLabel(block: StudyBlock): string {
  const time = `${timeLabel(new Date(block.startsAt))}–${timeLabel(new Date(block.endsAt))}`;
  const state = block.state === 'proposed' ? 'suggested' : 'accepted';
  const clash = block.clash ? `, clashes with ${block.clash.title}` : '';
  return `Study: ${block.itemTitle}, ${block.index} of ${block.total}, ${time}, ${state}${clash}`;
}

const GUTTER = 40;

const styles = StyleSheet.create({
  grid: { flex: 1, borderRadius: 12, padding: 8 },
  row: { flexDirection: 'row', gap: 4 },
  gutter: { width: GUTTER },
  column: { flex: 1 },
  deadlines: { flex: 1, gap: 4 },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700' },
  deadlineRow: { marginTop: 4, marginBottom: 6 },
  deadline: { borderWidth: 1, borderLeftWidth: 3, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 2 },
  hour: { height: HOUR_HEIGHT, fontSize: 10, textAlign: 'right', paddingRight: 4 },
  slot: { height: HOUR_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth },
  entry: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  proposed: { borderStyle: 'dashed' },
  clash: { borderWidth: 2.5 },
  entryTitle: { fontSize: 11, fontWeight: '600' },
  small: { fontSize: 10 },
  done: { textDecorationLine: 'line-through' },
});
