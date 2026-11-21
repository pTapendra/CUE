import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import type { Course, Item, StudyBlock } from '../api/types';
import { dayLabel, sameDay, timeLabel, weekdayLabel } from '../dates';
import { courseColorFor } from '../ui/courseColors';
import { radius, space, type, useTokens, type CourseColor } from '../ui/tokens';
import {
  deadlinesFor,
  HOUR_HEIGHT,
  placeInDay,
  timedEventsFor,
  type GridRange,
  type Placed,
  type TimedEvent,
} from '../viewmodels/grid';

/**
 * Days side by side (any number): a lane of deadlines along the top, then study blocks and timed
 * events at their hours, and a red line at the current time on today.
 */
export function TimeGrid({
  days,
  range,
  blocks,
  items,
  courses,
  onBlock,
  onItem,
  refreshControl,
}: {
  days: Date[];
  range: GridRange;
  blocks: StudyBlock[];
  items: Item[];
  /** For course colours, by course name. */
  courses: Course[];
  onBlock: (block: StudyBlock) => void;
  onItem: (item: Item) => void;
  refreshControl?: ScrollViewProps['refreshControl'];
}) {
  const { colors, courses: palette, unknown } = useTokens();
  const now = useNow();
  const colorOf = (courseName: string | null) => courseColorFor(courseName, courses, palette, unknown);
  // Week view: narrow columns, so deadlines show their title only.
  const compact = days.length > 3;
  const hours = Array.from({ length: range.endHour - range.startHour }, (_, i) => range.startHour + i);
  const lanes = days.map((day) => deadlinesFor(day, items));

  return (
    <View style={styles.grid}>
      <View style={[styles.row, styles.border, { borderColor: colors.line }]}>
        <View style={styles.gutter} />
        {days.map((day) => (
          <DayHeader key={day.toISOString()} day={day} today={sameDay(day, now)} />
        ))}
      </View>

      {lanes.some((lane) => lane.length > 0) ? (
        <View style={[styles.row, styles.border, { borderColor: colors.line }]}>
          <View style={styles.gutter} />
          {days.map((day, i) => (
            <View key={day.toISOString()} style={styles.lane}>
              {lanes[i].map((item) => (
                <Deadline
                  key={item.id}
                  item={item}
                  color={colorOf(item.courseName)}
                  compact={compact}
                  onPress={() => onItem(item)}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}

      <ScrollView refreshControl={refreshControl}>
        <View style={styles.row}>
          <View style={styles.gutter}>
            {hours.map((h) => (
              <Text key={h} style={[type.meta, styles.hour, { color: colors.text3 }]}>
                {`${String(h).padStart(2, '0')}:00`}
              </Text>
            ))}
          </View>
          {days.map((day) => (
            <View key={day.toISOString()} style={[styles.column, { borderColor: colors.line }]}>
              {hours.map((h) => (
                <View key={h} style={[styles.slot, { borderColor: colors.line }]} />
              ))}
              {placeInDay(day, timedEventsFor(day, items), range).map((placed) => (
                <EventBox
                  key={placed.value.item.id}
                  placed={placed}
                  color={colorOf(placed.value.item.courseName)}
                  onPress={() => onItem(placed.value.item)}
                />
              ))}
              {placeInDay(day, blocks, range).map((placed) => (
                <BlockBox
                  key={placed.value.id}
                  placed={placed}
                  color={colorOf(placed.value.courseName)}
                  onPress={() => onBlock(placed.value)}
                />
              ))}
              {sameDay(day, now) ? <NowLine now={now} range={range} /> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** The time, again each minute, for the `now` line. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function DayHeader({ day, today }: { day: Date; today: boolean }) {
  const { colors } = useTokens();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={today ? `${dayLabel(day)}, today` : dayLabel(day)}
      style={styles.dayHeader}
    >
      <Text style={[type.meta, { color: today ? colors.accent : colors.text3 }]}>{weekdayLabel(day)}</Text>
      <View style={[styles.date, today ? { backgroundColor: colors.accent } : null]}>
        <Text style={[type.bodyStrong, { color: today ? colors.onAccent : colors.text }]}>{String(day.getDate())}</Text>
      </View>
    </View>
  );
}

function Deadline({
  item,
  color,
  compact,
  onPress,
}: {
  item: Item;
  color: CourseColor;
  compact: boolean;
  onPress: () => void;
}) {
  const time = item.dueAt && !item.allDay ? timeLabel(new Date(item.dueAt)) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={deadlineLabel(item, time)}
      onPress={onPress}
      style={[styles.deadline, { backgroundColor: color.tint }]}
    >
      <Text
        numberOfLines={compact ? 1 : 2}
        style={[styles.entryTitle, { color: color.text }, item.status === 'done' ? styles.done : null]}
      >
        {item.kind === 'exam' ? 'Exam: ' : ''}
        {item.title}
      </Text>
      {time && !compact ? <Text style={[type.meta, { color: color.text }]}>{time}</Text> : null}
    </Pressable>
  );
}

/** Accepted: the course tint with a course-colour edge. Suggested: a dashed course-colour border. */
function BlockBox({
  placed: { value: block, top, height },
  color,
  onPress,
}: {
  placed: Placed<StudyBlock>;
  color: CourseColor;
  onPress: () => void;
}) {
  const { colors } = useTokens();
  const proposed = block.state === 'proposed';
  const clash = !proposed && block.clash !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={blockLabel(block)}
      onPress={onPress}
      style={[
        styles.entry,
        frame(top, height),
        proposed
          ? [styles.proposed, { borderColor: color.mark, backgroundColor: colors.bg }]
          : [styles.accepted, { backgroundColor: color.tint, borderLeftColor: color.mark }],
        clash ? [styles.clash, { borderColor: colors.danger }] : null,
      ]}
    >
      <Text numberOfLines={2} style={[styles.entryTitle, { color: color.text }]}>
        {block.itemTitle}
      </Text>
      <Text style={[type.meta, { color: color.text }]}>{`${block.index} of ${block.total}`}</Text>
    </Pressable>
  );
}

function EventBox({
  placed: { value: event, top, height },
  color,
  onPress,
}: {
  placed: Placed<TimedEvent>;
  color: CourseColor;
  onPress: () => void;
}) {
  const time = `${timeLabel(new Date(event.startsAt))}–${timeLabel(new Date(event.endsAt))}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.item.title}, ${time}`}
      onPress={onPress}
      style={[styles.entry, frame(top, height), { backgroundColor: color.tint }]}
    >
      <Text numberOfLines={2} style={[styles.entryTitle, { color: color.text }]}>
        {event.item.title}
      </Text>
    </Pressable>
  );
}

/** The current time across today's column, when it falls within the grid's hours. */
function NowLine({ now, range }: { now: Date; range: GridRange }) {
  const { colors } = useTokens();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < range.startHour * 60 || minutes > range.endHour * 60) return null;
  const top = ((minutes - range.startHour * 60) / 60) * HOUR_HEIGHT;
  return (
    <View
      testID="now"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.now, { top, backgroundColor: colors.now }]}
    >
      <View style={[styles.nowDot, { backgroundColor: colors.now }]} />
    </View>
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

/** What a screen reader says for a deadline, which may be cut short on screen. */
function deadlineLabel(item: Item, time: string | null): string {
  return [
    `${item.kind === 'exam' ? 'Exam: ' : ''}${item.title}`,
    item.courseName,
    time ? `due ${time}` : null,
    item.status === 'done' ? 'done' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

const GUTTER = 44;
const NOW_DOT = 8;

const styles = StyleSheet.create({
  grid: { flex: 1 },
  row: { flexDirection: 'row' },
  border: { borderBottomWidth: StyleSheet.hairlineWidth },
  gutter: { width: GUTTER },
  column: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth },
  dayHeader: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.xs },
  date: {
    minWidth: 28,
    minHeight: 28,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lane: { flex: 1, gap: space.xs, padding: 2, paddingBottom: space.xs },
  deadline: { minHeight: 44, justifyContent: 'center', borderRadius: radius.sm - 2, paddingHorizontal: space.xs, paddingVertical: 2 },
  hour: { height: HOUR_HEIGHT, textAlign: 'right', paddingRight: space.xs },
  slot: { height: HOUR_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth },
  entry: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderRadius: radius.sm - 2,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  accepted: { borderLeftWidth: 3 },
  proposed: { borderWidth: 1.5, borderStyle: 'dashed' },
  clash: { borderWidth: 2, borderLeftWidth: 3 },
  entryTitle: { fontSize: 11.5, fontWeight: '600' },
  done: { textDecorationLine: 'line-through' },
  now: { position: 'absolute', left: 0, right: 0, height: 2, pointerEvents: 'none' },
  nowDot: {
    position: 'absolute',
    left: -NOW_DOT / 2,
    top: 1 - NOW_DOT / 2,
    width: NOW_DOT,
    height: NOW_DOT,
    borderRadius: NOW_DOT / 2,
  },
});
