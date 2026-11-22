import React, { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Item, StudyBlock } from '../../api/types';
import { dayKey, dayLabel } from '../../dates';
import type { TabParamList, TabScreenProps } from '../../navigation/types';
import { courseColorFor } from '../../ui/courseColors';
import {
  ADD_BUTTON_CLEARANCE,
  AddButton,
  Button,
  Card,
  CheckCircle,
  CourseDot,
  DayStrip,
  EmptyState,
  ErrorBanner,
  ListRow,
  ProfileButton,
  SectionHeader,
  SyncButton,
  Tag,
  useToast,
} from '../../ui/kit';
import { type CourseColor, space, type, useTokens } from '../../ui/tokens';
import { blockMeta, type UpNext, upNextLabel, weekMarks, whenLabel } from '../../viewmodels/today';
import { useSync } from '../../viewmodels/useSync';
import { useToday } from '../../viewmodels/useToday';
import { CanvasLoginSheet } from '../CanvasLoginScreen';
import { SyncStatus } from '../SyncStatus';
import { BlockSheet } from '../sheets/BlockSheet';
import { ItemSheet } from '../sheets/ItemSheet';

/**
 * Today: the week at a glance, the next study block, what is due in the next 7 days,
 * and what still has no date. Sync and the profile icon (Settings) live in its header.
 */
export function TodayScreen({ navigation }: TabScreenProps<'Today'>) {
  const { colors, courses: palette, unknown } = useTokens();
  const vm = useToday();
  const sync = useSync();
  const toast = useToast();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [moving, setMoving] = useState<StudyBlock | null>(null);
  const [pulling, setPulling] = useState(false);

  const colorOf = (courseName: string | null) => courseColorFor(courseName, vm.courses, palette, unknown);
  const marks = weekMarks(vm.items, vm.blocks, vm.now, (courseName) => colorOf(courseName).mark);
  // The block whose sheet is open, as the latest load has it (its study hours may have changed).
  const openBlock = moving ? vm.blocks.find((b) => b.id === moving.id) ?? moving : null;
  const empty =
    vm.loaded && !vm.upNext && vm.shortfalls.length === 0 && vm.dueSoon.length === 0 && vm.noDate.length === 0;

  const openSchedule = (params: TabParamList['Schedule']) => navigation.navigate('Tabs', { screen: 'Schedule', params });

  /** Ticks an item off, with an Undo that puts back the status it had (such as In progress). */
  async function markDone(item: Item) {
    const previous = item.status;
    if (await vm.setStatus(item.id, 'done')) {
      toast.show('Marked done', {
        label: 'Undo',
        onPress: () => {
          vm.setStatus(item.id, previous);
        },
      });
    }
  }

  /** Pulling down syncs with Canvas; without Canvas it loads Today again. */
  async function refresh() {
    if (sync.connected) {
      sync.sync();
      return;
    }
    setPulling(true);
    await vm.reload();
    setPulling(false);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={[type.largeTitle, styles.title, { color: colors.text }]}>
            Today
          </Text>
          <View style={styles.actions}>
            <SyncButton busy={sync.busy} inSync={sync.inSync} connected={sync.connected} onSync={sync.sync} onConnect={sync.connect} />
            <ProfileButton onPress={() => navigation.navigate('Settings')} />
          </View>
        </View>
        <View style={styles.subtitle}>
          <Text style={[type.body, { color: colors.text2 }]}>{dayLabel(vm.now)}</Text>
          <SyncStatus sync={sync} now={vm.now} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: ADD_BUTTON_CLEARANCE }]}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} />}
      >
        <DayStrip
          weekOf={vm.now}
          today={vm.now}
          marks={marks}
          onDay={(day) => openSchedule({ date: dayKey(day), view: 'day' })}
        />

        {vm.error ? <ErrorBanner message={vm.error} onRetry={vm.reload} /> : null}
        {sync.login.error ? <ErrorBanner message={sync.login.error} /> : null}

        {!vm.loaded ? (
          vm.error ? null : <ActivityIndicator style={styles.spinner} color={colors.accent} />
        ) : empty ? (
          <EmptyState
            icon="checkmark-done-outline"
            title="Nothing due this week"
            message={
              sync.connected
                ? 'Sync to check Canvas for new work, or add something with +.'
                : 'Connect Canvas to bring in your deadlines, or add one with +.'
            }
            action={
              sync.connected ? (
                <SyncButton variant="soft" busy={sync.busy} inSync={sync.inSync} connected onSync={sync.sync} onConnect={sync.connect} />
              ) : undefined
            }
          />
        ) : (
          <>
            {vm.upNext ? (
              <UpNextCard
                upNext={vm.upNext}
                now={vm.now}
                colorOf={colorOf}
                started={(id) => vm.items.find((i) => i.id === id)?.status === 'in_progress'}
                onStart={(block) => vm.setStatus(block.itemId, 'in_progress')}
                onMove={setMoving}
                onReview={(first) => openSchedule({ date: dayKey(new Date(first.startsAt)) })}
                onPlan={() => navigation.navigate('StudyTimes')}
              />
            ) : null}

            {vm.shortfalls.map((s) => (
              <View key={s.itemId} style={styles.shortfall}>
                <Ionicons name="warning-outline" size={18} color={colors.warn} />
                <Text style={[type.body, styles.flex, { color: colors.warn }]}>{s.text}</Text>
              </View>
            ))}

            <View>
              <SectionHeader title="Due soon" actionLabel="See all" onAction={() => openSchedule({ date: dayKey(vm.now) })} />
              {vm.dueSoon.length === 0 ? (
                <Text style={[type.body, styles.none, { color: colors.text2 }]}>Nothing due in the next 7 days.</Text>
              ) : (
                vm.dueSoon.map((item) => (
                  <View key={item.id} style={styles.checkRow}>
                    <CheckCircle
                      checked={false}
                      exam={item.kind === 'exam'}
                      label={`Mark ${item.title} done`}
                      onPress={() => markDone(item)}
                    />
                    <View style={styles.flex}>
                      <ListRow
                        title={item.title}
                        tag={item.kind === 'exam' ? <Tag label="Exam" tone="exam" /> : undefined}
                        meta={[item.courseName, whenLabel(new Date(item.dueAt!), vm.now)].filter(Boolean).join(' · ')}
                        metaLeading={item.courseName ? <CourseDot color={colorOf(item.courseName)} /> : undefined}
                        onPress={() => setEditing(item)}
                      />
                    </View>
                  </View>
                ))
              )}
            </View>

            {vm.noDate.length > 0 ? (
              <View>
                <SectionHeader title="No date" />
                {vm.noDate.map((item) => {
                  // Done ones stay at the end, dimmed and ticked: untick to reopen, tap to date or delete.
                  const done = item.status === 'done';
                  return (
                    <View key={item.id} style={styles.checkRow}>
                      <CheckCircle
                        checked={done}
                        exam={item.kind === 'exam'}
                        label={`Mark ${item.title} ${done ? 'not done' : 'done'}`}
                        onPress={() => (done ? vm.setStatus(item.id, 'not_started') : markDone(item))}
                      />
                      <View style={styles.flex}>
                        <ListRow
                          title={item.title}
                          tag={item.kind === 'exam' ? <Tag label="Exam" tone="exam" /> : undefined}
                          meta={item.courseName ?? undefined}
                          metaLeading={item.courseName ? <CourseDot color={colorOf(item.courseName)} /> : undefined}
                          onPress={() => setEditing(item)}
                          dimmed={done}
                          trailing={
                            done ? undefined : <Text style={[type.bodyStrong, { color: colors.accent }]}>Add date</Text>
                          }
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <AddButton onPress={() => setEditing('new')} />

      <CanvasLoginSheet login={sync.login} />

      {openBlock ? (
        <BlockSheet
          block={openBlock}
          studyHours={openBlock.itemStudyMinutes / 60}
          error={vm.error}
          startMoving
          onAccept={() => vm.acceptBlock(openBlock.id)}
          onReject={() => vm.rejectBlock(openBlock.id)}
          onMove={(startsAtIso) => vm.moveBlock(openBlock.id, startsAtIso)}
          onStudyHours={(hours) => vm.setStudyHours(openBlock.itemId, hours)}
          onClose={() => setMoving(null)}
        />
      ) : null}

      {editing !== null ? (
        <ItemSheet
          key={editing === 'new' ? 'new' : editing.id}
          visible
          item={editing === 'new' ? null : editing}
          courses={vm.courses}
          error={vm.error}
          onClose={() => setEditing(null)}
          onSave={(input) => vm.saveItem(editing === 'new' ? null : editing.id, input)}
          onStatus={(status) => (editing === 'new' ? Promise.resolve(false) : vm.setStatus(editing.id, status))}
          onDelete={() => (editing === 'new' ? Promise.resolve(false) : vm.deleteItem(editing.id))}
        />
      ) : null}
    </View>
  );
}

/** The next accepted study block, else the suggestions to review, else a prompt to plan. */
function UpNextCard({
  upNext,
  now,
  colorOf,
  started,
  onStart,
  onMove,
  onReview,
  onPlan,
}: {
  upNext: NonNullable<UpNext>;
  now: Date;
  colorOf: (courseName: string | null) => CourseColor;
  /** Whether the item with this id is In progress. */
  started: (itemId: string) => boolean;
  onStart: (block: StudyBlock) => void;
  onMove: (block: StudyBlock) => void;
  onReview: (first: StudyBlock) => void;
  onPlan: () => void;
}) {
  const { colors } = useTokens();

  if (upNext.kind === 'block') {
    const { block } = upNext;
    const course = colorOf(block.courseName);
    const inProgress = started(block.itemId);
    return (
      <Card tint={course.tint}>
        <View style={styles.card}>
          <Text style={[type.section, styles.caps, { color: course.text }]}>{upNextLabel(block, now)}</Text>
          <Text style={[type.title, { color: colors.text }]}>{`Study for ${block.itemTitle}`}</Text>
          <Text style={[type.body, { color: course.text }]}>{blockMeta(block, now)}</Text>
          {inProgress ? <Tag label="In progress" tone="ok" /> : null}
          <View style={styles.cardActions}>
            {inProgress ? null : <Button title="Start" onPress={() => onStart(block)} />}
            <Button title="Move" variant="secondary" onPress={() => onMove(block)} />
          </View>
        </View>
      </Card>
    );
  }

  const suggested = upNext.kind === 'suggested';
  const title = suggested
    ? `${upNext.count} suggested study block${upNext.count === 1 ? '' : 's'}`
    : 'Plan your studying';
  const text = suggested
    ? 'Cue found times to study before your deadlines. Accept the ones that suit you.'
    : 'Tell Cue when you can study, and it suggests study blocks before your deadlines.';
  return (
    <Card tint={colors.accentTint}>
      <View style={styles.card}>
        <Text style={[type.section, styles.caps, { color: colors.accent }]}>Up next</Text>
        <Text style={[type.title, { color: colors.text }]}>{title}</Text>
        <Text style={[type.body, { color: colors.text2 }]}>{text}</Text>
        <View style={styles.cardActions}>
          {upNext.kind === 'suggested' ? (
            <Button title="Review" onPress={() => onReview(upNext.first)} />
          ) : (
            <Button title="Set study times" onPress={onPlan} />
          )}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingTop: space.sm },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  subtitle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
  spinner: { paddingVertical: space.xl },
  card: { gap: space.sm },
  caps: { textTransform: 'uppercase', letterSpacing: 0.6 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  shortfall: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  none: { paddingVertical: space.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center' },
});
