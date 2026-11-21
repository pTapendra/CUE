import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { Item } from '../../api/types';
import { monthTitle, parseDay, rangeLabel } from '../../dates';
import type { TabScreenProps } from '../../navigation/types';
import { ADD_BUTTON_CLEARANCE, AddButton, Button, ErrorBanner, IconButton, SegmentedControl, SyncButton } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';
import { type ScheduleView, useSchedule } from '../../viewmodels/useSchedule';
import { useSync } from '../../viewmodels/useSync';
import { CanvasLoginSheet } from '../CanvasLoginScreen';
import { BlockSheet } from '../sheets/BlockSheet';
import { ItemSheet } from '../sheets/ItemSheet';
import { TimeGrid } from '../TimeGrid';

const VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: '3days', label: '3 days' },
  { value: 'week', label: 'Week' },
];

/** The view Schedule opens in when nothing asks for another. */
const DEFAULT_VIEW: ScheduleView = '3days';

/**
 * Schedule: 1, 3 or 7 days of deadlines and study blocks on a time grid.
 * Route params `{ date, view }` open a page; this is how Today opens a day.
 */
export function ScheduleScreen({ navigation, route }: TabScreenProps<'Schedule'>) {
  const { colors } = useTokens();
  const wantedView = route.params?.view;
  const wantedDate = route.params?.date;
  const vm = useSchedule({ view: wantedView ?? DEFAULT_VIEW, date: parseDay(wantedDate) ?? new Date() });
  const sync = useSync();
  const [editing, setEditing] = useState<Item | null | 'new'>(null);
  useReloadOnReturn(vm.reload);

  // Params sent while Schedule is open show their page too. They are cleared once shown, so the
  // same day can be sent again after the student has moved on.
  const { show } = vm;
  useEffect(() => {
    if (!wantedView && !wantedDate) return;
    show(wantedView, parseDay(wantedDate) ?? new Date());
    navigation.setParams({ view: undefined, date: undefined });
  }, [wantedView, wantedDate, show, navigation]);

  const openBlock = vm.openBlock;
  const suggested = vm.suggestedCount;
  const first = vm.days[0];
  const last = vm.days[vm.days.length - 1];
  const hasNotices = !!vm.error || !!sync.login.error || vm.shortfalls.length > 0 || suggested > 0;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[type.largeTitle, styles.title, { color: colors.text }]}>
          {monthTitle(first, last, new Date())}
        </Text>
        <View style={styles.actions}>
          <SyncButton
            variant="soft"
            busy={sync.busy}
            connected={sync.connected}
            onSync={sync.sync}
            onConnect={sync.connect}
          />
          <IconButton icon="locate-outline" label="Today" onPress={vm.goToday} />
        </View>
      </View>

      <View style={styles.controls}>
        <SegmentedControl options={VIEWS} value={vm.view} onChange={vm.setView} />
        <View style={styles.pager}>
          <IconButton icon="chevron-back" label="Previous days" onPress={vm.previous} />
          <Text style={[type.bodyStrong, styles.range, { color: colors.text2 }]}>{rangeLabel(first, vm.days.length)}</Text>
          <IconButton icon="chevron-forward" label="Next days" onPress={vm.next} />
        </View>
      </View>

      {hasNotices ? (
        <ScrollView style={styles.notices} contentContainerStyle={styles.noticeList}>
          {vm.error ? <ErrorBanner message={vm.error} onRetry={vm.reload} /> : null}
          {sync.login.error ? <ErrorBanner message={sync.login.error} /> : null}

          {vm.shortfalls.map((s) => (
            <View key={s.itemId} style={styles.shortfall}>
              <Ionicons name="warning-outline" size={18} color={colors.warn} />
              <Text style={[type.body, styles.noticeText, { color: colors.warn }]}>{s.text}</Text>
            </View>
          ))}

          {suggested > 0 ? (
            <View style={[styles.suggestions, { backgroundColor: colors.accentTint }]}>
              <Text style={[type.bodyStrong, styles.noticeText, { color: colors.accent }]}>
                {`${suggested} suggested block${suggested === 1 ? '' : 's'}`}
              </Text>
              <Button title="Accept all" variant="plain" onPress={vm.acceptVisible} />
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      <TimeGrid
        days={vm.days}
        range={vm.range}
        blocks={vm.blocks}
        items={vm.items}
        courses={vm.courses}
        onBlock={vm.showBlock}
        onItem={setEditing}
        refreshControl={<RefreshControl refreshing={vm.loading} onRefresh={vm.reload} />}
        bottomInset={ADD_BUTTON_CLEARANCE}
      />

      <AddButton onPress={() => setEditing('new')} />

      <CanvasLoginSheet login={sync.login} />

      {openBlock ? (
        <BlockSheet
          block={openBlock}
          studyHours={vm.openBlockHours}
          error={vm.error}
          onAccept={() => vm.acceptBlock(openBlock.id)}
          onReject={() => vm.rejectBlock(openBlock.id)}
          onMove={(startsAtIso) => vm.moveBlock(openBlock.id, startsAtIso)}
          onStudyHours={(h) => vm.setStudyHours(openBlock.itemId, h)}
          onClose={vm.closeBlock}
        />
      ) : null}

      {editing !== null ? (
        <ItemSheet
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

/** Loads the page again each time Schedule comes back into view: after a sync, new study times, or Today. */
function useReloadOnReturn(reload: () => Promise<void>) {
  const latest = useRef(reload);
  latest.current = reload;
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) latest.current();
      seen.current = true;
    }, []),
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  controls: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.xs },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  range: { flex: 1, textAlign: 'center' },
  notices: { flexGrow: 0, maxHeight: '30%' },
  noticeList: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  noticeText: { flex: 1 },
  shortfall: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  suggestions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingLeft: space.md,
  },
});
