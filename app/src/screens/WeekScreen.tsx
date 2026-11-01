import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Item } from '../api/types';
import { dayLabel, sameDay, timeLabel, weekLabel } from '../dates';
import { Button, ErrorBanner } from '../ui/components';
import { useTheme } from '../ui/theme';
import { useWeek } from '../viewmodels/useWeek';
import { ItemEditor, STATUSES } from './ItemEditor';

export function WeekScreen({ onSync, onCanvasSettings }: { onSync: () => void; onCanvasSettings: () => void }) {
  const t = useTheme();
  const vm = useWeek();
  const [editing, setEditing] = useState<Item | null | 'new'>(null);
  const today = new Date();

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.header, { borderColor: t.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={vm.previousWeek} hitSlop={12}>
          <Text style={[styles.arrow, { color: t.primary }]}>‹</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityHint="Go to this week" onPress={vm.thisWeek}>
          <Text style={[styles.week, { color: t.text }]}>{weekLabel(vm.from)}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={vm.nextWeek} hitSlop={12}>
          <Text style={[styles.arrow, { color: t.primary }]}>›</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={vm.loading} onRefresh={vm.reload} />}>
        <ErrorBanner message={vm.error} />

        {vm.undated.length > 0 ? (
          <View style={[styles.day, { backgroundColor: t.examTint }]}>
            <Text style={[styles.dayTitle, { color: t.exam }]}>Needs a date</Text>
            {vm.undated.map((item) => (
              <ItemRow key={item.id} item={item} onPress={() => setEditing(item)} />
            ))}
          </View>
        ) : null}

        {vm.days.map((day) => (
          <View key={day.date.toISOString()} style={[styles.day, { backgroundColor: t.surface }]}>
            <Text style={[styles.dayTitle, { color: sameDay(day.date, today) ? t.primary : t.text }]}>
              {dayLabel(day.date)}
              {sameDay(day.date, today) ? ' · Today' : ''}
            </Text>
            {day.items.length === 0 ? (
              <Text style={{ color: t.muted, fontSize: 13 }}>Nothing due</Text>
            ) : (
              day.items.map((item) => <ItemRow key={item.id} item={item} onPress={() => setEditing(item)} />)
            )}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { borderColor: t.border, backgroundColor: t.background }]}>
        <View style={{ flex: 1 }}>
          <Button title="Add" onPress={() => setEditing('new')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Sync Canvas" variant="secondary" onPress={onSync} />
        </View>
        <Button title="⚙" variant="secondary" onPress={onCanvasSettings} />
      </View>

      {editing !== null ? (
        <ItemEditor
          key={editing === 'new' ? 'new' : editing.id}
          visible
          item={editing === 'new' ? null : editing}
          courses={vm.courses}
          onClose={() => setEditing(null)}
          onSave={(input) => vm.saveItem(editing === 'new' ? null : editing.id, input)}
          onStatus={(status) => (editing === 'new' ? Promise.resolve(false) : vm.setStatus(editing.id, status))}
          onDelete={() => (editing === 'new' ? Promise.resolve(false) : vm.deleteItem(editing.id))}
        />
      ) : null}
    </View>
  );
}

function ItemRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const t = useTheme();
  const due = item.dueAt ? new Date(item.dueAt) : null;
  const done = item.status === 'done';
  const status = STATUSES.find((s) => s.value === item.status)?.label;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.item, { borderColor: item.kind === 'exam' ? t.exam : t.border, opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontWeight: '600', textDecorationLine: done ? 'line-through' : 'none' }}>
          {item.kind === 'exam' ? 'Exam: ' : ''}
          {item.title}
        </Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {[item.courseName, due ? timeLabel(due) : null, item.status !== 'not_started' ? status : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {done ? <Text style={{ color: t.done, fontWeight: '700' }}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  arrow: { fontSize: 30, paddingHorizontal: 8 },
  week: { fontSize: 18, fontWeight: '700' },
  body: { padding: 16, gap: 12 },
  day: { borderRadius: 12, padding: 12, gap: 8 },
  dayTitle: { fontSize: 15, fontWeight: '700' },
  item: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 4, borderWidth: 1, borderRadius: 8, padding: 10 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1 },
});
