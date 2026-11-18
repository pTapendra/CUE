import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Item } from '../api/types';
import { rangeLabel, timeLabel } from '../dates';
import { Button, ErrorBanner } from '../ui/components';
import { useTheme } from '../ui/theme';
import { DAYS_PER_PAGE, useWeek } from '../viewmodels/useWeek';
import { BlockSheet } from './BlockSheet';
import { ItemEditor, STATUSES } from './ItemEditor';
import { SettingsMenu } from './SettingsMenu';
import { TimeGrid } from './TimeGrid';

export function WeekScreen({
  onSync,
  onCanvasSettings,
  onStudyTimes,
}: {
  onSync: () => void;
  onCanvasSettings: () => void;
  onStudyTimes: () => void;
}) {
  const t = useTheme();
  const vm = useWeek();
  const [editing, setEditing] = useState<Item | null | 'new'>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openBlock = vm.openBlock;
  const suggested = vm.suggestedCount;
  const hasBanners = !!vm.error || vm.undated.length > 0 || vm.shortfalls.length > 0 || suggested > 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { borderColor: t.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous days" onPress={vm.previous} hitSlop={12}>
          <Text style={[styles.arrow, { color: t.primary }]}>‹</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityHint="Go to today" onPress={vm.goToday}>
          <Text style={[styles.title, { color: t.text }]}>{rangeLabel(vm.from, DAYS_PER_PAGE)}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next days" onPress={vm.next} hitSlop={12}>
          <Text style={[styles.arrow, { color: t.primary }]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {hasBanners ? (
          <ScrollView style={styles.banners} contentContainerStyle={styles.bannerList}>
            <ErrorBanner message={vm.error} />

            {vm.undated.length > 0 ? (
              <View style={[styles.banner, { backgroundColor: t.examTint }]}>
                <Text style={[styles.bannerTitle, { color: t.exam }]}>Needs a date</Text>
                {vm.undated.map((item) => (
                  <ItemRow key={item.id} item={item} onPress={() => setEditing(item)} />
                ))}
              </View>
            ) : null}

            {vm.shortfalls.map((s) => (
              <View key={s.itemId} style={[styles.banner, { backgroundColor: t.examTint }]}>
                <Text style={{ color: t.exam }}>{s.text}</Text>
              </View>
            ))}

            {suggested > 0 ? (
              <View style={[styles.banner, styles.suggestions, { backgroundColor: t.surface }]}>
                <Text style={[styles.bannerTitle, { color: t.text }]}>
                  {`${suggested} suggested block${suggested === 1 ? '' : 's'}`}
                </Text>
                <Button title="Accept all" onPress={vm.acceptVisible} />
              </View>
            ) : null}
          </ScrollView>
        ) : null}

        <TimeGrid
          days={vm.days}
          range={vm.range}
          blocks={vm.blocks}
          items={vm.items}
          onBlock={vm.showBlock}
          onItem={setEditing}
          refreshControl={<RefreshControl refreshing={vm.loading} onRefresh={vm.reload} />}
        />
      </View>

      <View style={[styles.footer, { borderColor: t.border, backgroundColor: t.background }]}>
        <View style={styles.footerButton}>
          <Button title="Add" onPress={() => setEditing('new')} />
        </View>
        <View style={styles.footerButton}>
          <Button title="Sync Canvas" variant="secondary" onPress={onSync} />
        </View>
        <Button title="⚙" variant="secondary" onPress={() => setMenuOpen(true)} />
      </View>

      <SettingsMenu
        visible={menuOpen}
        onStudyTimes={() => {
          setMenuOpen(false);
          onStudyTimes();
        }}
        onCanvas={() => {
          setMenuOpen(false);
          onCanvasSettings();
        }}
        onClose={() => setMenuOpen(false)}
      />

      {openBlock ? (
        <BlockSheet
          block={openBlock}
          studyHours={vm.openBlockHours}
          error={vm.error}
          onAccept={() => vm.acceptBlock(openBlock.id)}
          onReject={() => vm.rejectBlock(openBlock.id)}
          onMove={(text) => vm.moveBlock(openBlock.id, text)}
          onStudyHours={(h) => vm.setStudyHours(openBlock.itemId, h)}
          onClose={vm.closeBlock}
        />
      ) : null}

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
      <View style={styles.itemText}>
        <Text style={[styles.itemTitle, { color: t.text }, done ? styles.done : null]}>
          {item.kind === 'exam' ? 'Exam: ' : ''}
          {item.title}
        </Text>
        <Text style={[styles.itemDetail, { color: t.muted }]}>
          {[item.courseName, due ? timeLabel(due) : null, item.status !== 'not_started' ? status : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {done ? <Text style={[styles.check, { color: t.done }]}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  arrow: { fontSize: 30, paddingHorizontal: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  body: { flex: 1, padding: 12, gap: 8 },
  banners: { flexGrow: 0, maxHeight: '40%' },
  bannerList: { gap: 8 },
  banner: { borderRadius: 10, padding: 10, gap: 8 },
  bannerTitle: { fontSize: 15, fontWeight: '700' },
  suggestions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  item: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 4, borderWidth: 1, borderRadius: 8, padding: 10 },
  itemText: { flex: 1 },
  itemTitle: { fontWeight: '600' },
  itemDetail: { fontSize: 13 },
  done: { textDecorationLine: 'line-through' },
  check: { fontWeight: '700' },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1 },
  footerButton: { flex: 1 },
});
