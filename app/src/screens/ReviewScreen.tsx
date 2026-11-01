import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ProposedItem } from '../api/types';
import { dayLabel, timeLabel } from '../dates';
import { Button, ErrorBanner } from '../ui/components';
import { useTheme } from '../ui/theme';
import { useSyncReview } from '../viewmodels/useSyncReview';

export function ReviewScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useTheme();
  const vm = useSyncReview();

  if (vm.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.primary} />
        <Text style={{ color: t.muted, marginTop: 12 }}>Reading Canvas…</Text>
      </View>
    );
  }

  const items = vm.preview?.items ?? [];

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 8 }}>
            <Text style={[styles.title, { color: t.text }]}>Check what Cue found</Text>
            <Text style={{ color: t.muted }}>
              Untick anything you don't want. Exams without a date need one from you.
            </Text>
            <ErrorBanner message={vm.error} />
          </View>
        }
        ListEmptyComponent={
          vm.error ? undefined : <Text style={{ color: t.muted }}>Nothing upcoming in Canvas right now.</Text>
        }
        renderItem={({ item }) => (
          <Row
            item={item}
            checked={vm.selected.has(item.key)}
            onToggle={() => vm.toggle(item.key)}
            dateText={vm.dateText[item.key] ?? ''}
            onDate={(text) => vm.setDate(item.key, text)}
            invalid={vm.invalidDates.includes(item.key)}
          />
        )}
      />
      <View style={[styles.footer, { borderColor: t.border, backgroundColor: t.background }]}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} />
        {vm.preview ? (
          <View style={{ flex: 1 }}>
            <Button
              title={`Save ${vm.selected.size} item${vm.selected.size === 1 ? '' : 's'}`}
              busy={vm.saving}
              disabled={vm.invalidDates.length > 0}
              onPress={async () => {
                if ((await vm.confirm()) !== null) onDone();
              }}
            />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <Button title="Try again" onPress={vm.reload} />
          </View>
        )}
      </View>
    </View>
  );
}

function Row({
  item,
  checked,
  onToggle,
  dateText,
  onDate,
  invalid,
}: {
  item: ProposedItem;
  checked: boolean;
  onToggle: () => void;
  dateText: string;
  onDate: (text: string) => void;
  invalid: boolean;
}) {
  const t = useTheme();
  const due = item.dueAt ? new Date(item.dueAt) : null;
  return (
    <View style={[styles.row, { backgroundColor: t.surface, borderColor: item.kind === 'exam' ? t.exam : t.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={item.title}
        onPress={onToggle}
        style={styles.rowMain}>
        <View style={[styles.box, { borderColor: t.primary, backgroundColor: checked ? t.primary : 'transparent' }]}>
          {checked ? <Text style={{ color: t.primaryText, fontWeight: '700' }}>✓</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>{item.title}</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>
            {item.courseName}
            {item.kind === 'exam' ? ' · Exam' : ''}
            {due ? ` · ${dayLabel(due)} ${timeLabel(due)}` : ''}
            {item.alreadyImported ? ' · already saved' : ''}
          </Text>
        </View>
      </Pressable>
      {item.needsDate && checked ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: t.exam, fontSize: 13 }}>Canvas has no date for this exam.</Text>
          <TextInput
            value={dateText}
            onChangeText={onDate}
            placeholder="YYYY-MM-DD HH:mm"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            style={[styles.dateInput, { color: t.text, borderColor: invalid ? t.danger : t.border }]}
          />
          {invalid ? <Text style={{ color: t.danger, fontSize: 12 }}>Use the form 2026-11-06 14:00</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 20, gap: 10 },
  title: { fontSize: 24, fontWeight: '700' },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  rowMain: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dateInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1 },
});
