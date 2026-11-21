import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, dayLabel, sameDay, startOfWeek } from '../../dates';
import { radius, type, useTokens } from '../tokens';

type Props = {
  weekOf: Date;
  today: Date;
  /** YYYY-MM-DD (local) to the colour of that day's dot. */
  marks: Record<string, string>;
  onDay: (day: Date) => void;
};

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function key(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function DayStrip({ weekOf, today, marks, onDay }: Props) {
  const { colors } = useTokens();
  const monday = startOfWeek(weekOf);
  return (
    <View style={styles.row}>
      {LETTERS.map((letter, i) => {
        const day = addDays(monday, i);
        const k = key(day);
        const isToday = sameDay(day, today);
        return (
          <Pressable
            key={k}
            testID={`day-${k}`}
            accessibilityRole="button"
            accessibilityLabel={dayLabel(day)}
            accessibilityState={{ selected: isToday }}
            onPress={() => onDay(day)}
            style={styles.day}
          >
            <Text style={[type.meta, { color: colors.text3 }]}>{letter}</Text>
            <View style={[styles.num, isToday && { backgroundColor: colors.accent }]}>
              <Text style={[type.bodyStrong, { color: isToday ? colors.onAccent : colors.text }]}>
                {String(day.getDate())}
              </Text>
            </View>
            <View style={styles.dotSlot}>
              {marks[k] ? <View testID={`dot-${k}`} style={[styles.dot, { backgroundColor: marks[k] }]} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  day: { flex: 1, minHeight: 44, alignItems: 'center', paddingVertical: 4, gap: 2 },
  num: { minWidth: 32, minHeight: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dotSlot: { height: 6, justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
