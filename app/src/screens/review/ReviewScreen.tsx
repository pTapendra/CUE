import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../../api/ApiContext';
import type { ChangedItem, Course, ProposedItem, RemovedItem } from '../../api/types';
import { dayLabel, timeLabel } from '../../dates';
import { courseColorFor } from '../../ui/courseColors';
import { Button, CourseDot, DateTimeField, ErrorBanner, Tag, useToast } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';
import { useCanvasLogin } from '../../viewmodels/useCanvasLogin';
import { describeChange, groupByCourse, savedToast, summaryLine, useSyncReview } from '../../viewmodels/useSyncReview';
import { CanvasLoginScreen } from '../CanvasLoginScreen';

export function ReviewScreen({
  onDone,
  onCancel,
  loginAvailable,
  onConnect,
}: {
  onDone: () => void;
  onCancel: () => void;
  /** The server has Canvas login set up, so the student can log in again right here. */
  loginAvailable: boolean;
  /** Opens the Connect screen (for a server without Canvas login). */
  onConnect: () => void;
}) {
  const api = useApi();
  const { colors, courses: palette, unknown } = useTokens();
  const toast = useToast();
  const vm = useSyncReview();
  // After logging in again, read Canvas again right here.
  const login = useCanvasLogin(vm.reload);
  // Only for the colours: until the courses arrive (or if they can't), the dots are neutral.
  const [courses, setCourses] = useState<Course[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .listCourses()
      .then((r) => !cancelled && setCourses(r.courses))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (vm.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[type.body, { color: colors.text2, marginTop: space.md }]}>Reading Canvas…</Text>
      </View>
    );
  }

  const markFor = (name: string) => (courses ? courseColorFor(name, courses, palette, unknown) : unknown);

  async function save() {
    const counts = await vm.confirm();
    if (counts === null) return;
    onDone();
    toast.show(savedToast(counts));
  }

  /** New or skipped items, grouped by course, with today's rows and date picker. */
  const courseGroups = (groups: ReturnType<typeof groupByCourse>) =>
    groups.map((g) => (
      <View key={g.courseName} style={styles.group}>
        <View style={styles.groupHeader}>
          <CourseDot color={markFor(g.courseName)} />
          <Text style={[type.section, { color: colors.text2 }]}>{g.courseName.toUpperCase()}</Text>
        </View>
        {g.items.map((item) => (
          <Row
            key={item.key}
            item={item}
            checked={vm.selected.has(item.key)}
            onToggle={() => vm.toggle(item.key)}
            date={vm.dates[item.key] ?? null}
            onDate={(iso) => vm.setDate(item.key, iso)}
          />
        ))}
      </View>
    ));
  const heading = (text: string) => (
    <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>
      {text}
    </Text>
  );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[type.largeTitle, { color: colors.text }]}>
            Check what Cue found
          </Text>
          {vm.preview && !vm.nothingListed ? (
            <Text style={[type.body, { color: colors.text2 }]}>{summaryLine(vm.preview)}</Text>
          ) : null}
          {vm.error ? <ErrorBanner message={vm.error} /> : null}
          {vm.needsConnect ? (
            loginAvailable ? (
              <>
                <Button title="Log in with Canvas" busy={login.busy && !login.authorizeUrl} onPress={login.start} />
                {login.error ? <ErrorBanner message={login.error} /> : null}
              </>
            ) : (
              <Button title="Connect Canvas" onPress={onConnect} />
            )
          ) : null}
        </View>
        {vm.preview && vm.nothingListed ? (
          <Text style={[type.body, { color: colors.text2 }]}>Cue is up to date with Canvas.</Text>
        ) : null}
        {vm.groups.length > 0 ? (
          <View style={styles.section}>
            {heading('New')}
            {courseGroups(vm.groups)}
          </View>
        ) : null}
        {vm.changed.length > 0 ? (
          <View style={styles.section}>
            {heading('Changed')}
            {vm.changed.map((item) => (
              <ChangedRow key={item.key} item={item} />
            ))}
          </View>
        ) : null}
        {vm.removed.length > 0 ? (
          <View style={styles.section}>
            {heading('Removed from Canvas')}
            {vm.removed.map((item) => (
              <RemovedRow key={item.key} item={item} />
            ))}
          </View>
        ) : null}
        {vm.skippedCount > 0 && !vm.showSkipped ? (
          <Button title={`Show ${vm.skippedCount} skipped`} variant="plain" onPress={vm.revealSkipped} />
        ) : null}
        {vm.showSkipped && vm.skippedGroups.length > 0 ? (
          <View style={styles.section}>
            {heading('Skipped')}
            {courseGroups(vm.skippedGroups)}
          </View>
        ) : null}
      </ScrollView>
      {login.authorizeUrl ? (
        <CanvasLoginScreen
          authorizeUrl={login.authorizeUrl}
          busy={login.busy}
          onNavigate={login.onNavigate}
          onCancel={login.cancel}
        />
      ) : null}
      <View style={[styles.footer, { borderColor: colors.line, backgroundColor: colors.bg }]}>
        {vm.preview && !vm.canSave ? (
          <View style={styles.save}>
            <Button title="Done" onPress={onCancel} />
          </View>
        ) : (
          <>
            <Button title="Cancel" variant="secondary" onPress={onCancel} />
            <View style={styles.save}>
              {vm.preview ? (
                <Button title="Save" busy={vm.saving} onPress={save} />
              ) : (
                <Button title="Try again" onPress={vm.reload} />
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function Row({
  item,
  checked,
  onToggle,
  date,
  onDate,
}: {
  item: ProposedItem;
  checked: boolean;
  onToggle: () => void;
  date: string | null;
  onDate: (iso: string | null) => void;
}) {
  const { colors } = useTokens();
  const exam = item.kind === 'exam';
  const due = item.dueAt ? new Date(item.dueAt) : null;
  const edge = exam ? colors.exam : colors.accent;
  const when = due ? `${dayLabel(due)} · ${timeLabel(due)}` : null;
  // Everything the row shows, for a screen reader: "Midterm, exam, Thu 5 Nov, 09:00".
  const spoken = [item.title, exam ? 'exam' : null, due ? `${dayLabel(due)}, ${timeLabel(due)}` : 'no date']
    .filter(Boolean)
    .join(', ');
  return (
    <View style={[styles.row, { backgroundColor: colors.bg2 }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={spoken}
        onPress={onToggle}
        style={styles.rowMain}
      >
        <View style={[styles.box, { borderColor: edge }, checked && { backgroundColor: edge }]}>
          {checked ? <Ionicons name="checkmark" size={16} color={colors.bg} /> : null}
        </View>
        <View style={styles.rowText}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>{item.title}</Text>
          {exam ? <Tag label="Exam" tone="exam" /> : null}
          {when ? <Text style={[type.meta, { color: colors.text2 }]}>{when}</Text> : null}
        </View>
      </Pressable>
      {item.needsDate && checked ? (
        <View style={styles.needsDate}>
          <Text style={[type.body, { color: colors.exam }]}>Canvas has no date for this exam</Text>
          <DateTimeField
            label={`Due date for ${item.title}`}
            value={date}
            mode="datetime"
            onChange={onDate}
            allowClear
            clearLabel="Add date"
            clearButtonLabel="Remove date"
          />
          {date ? null : <Text style={[type.meta, { color: colors.text2 }]}>or add it later</Text>}
        </View>
      ) : null}
    </View>
  );
}

/** A saved item Canvas changed: what changed, old → new. No checkbox: Save applies it. */
function ChangedRow({ item }: { item: ChangedItem }) {
  const { colors } = useTokens();
  const lines = item.changes.map(describeChange);
  const spoken = [item.title, ...lines.map((l) => l.spoken)].join(', ');
  return (
    <View accessible accessibilityLabel={spoken} style={[styles.row, styles.info, { backgroundColor: colors.bg2 }]}>
      <Text style={[type.bodyStrong, { color: colors.text }]}>{item.title}</Text>
      {item.kind === 'exam' ? <Tag label="Exam" tone="exam" /> : null}
      <Text style={[type.meta, { color: colors.text2 }]}>{item.courseName}</Text>
      {lines.map((l) => (
        <Text key={l.shown} style={[type.body, { color: colors.text }]}>
          {l.shown}
        </Text>
      ))}
    </View>
  );
}

/** A saved item Canvas no longer has. No checkbox: Save removes it. */
function RemovedRow({ item }: { item: RemovedItem }) {
  const { colors } = useTokens();
  return (
    <View accessible accessibilityLabel={`${item.title}, will be removed from Cue`} style={[styles.row, styles.info, { backgroundColor: colors.bg2 }]}>
      <Text style={[type.bodyStrong, { color: colors.text }]}>{item.title}</Text>
      <Text style={[type.meta, { color: colors.text2 }]}>{item.courseName}</Text>
      <Text style={[type.body, { color: colors.text2 }]}>Will be removed from Cue</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: space.lg, gap: space.lg },
  header: { gap: space.sm },
  section: { gap: space.md },
  group: { gap: space.sm },
  info: { gap: space.xs, paddingVertical: space.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { borderRadius: radius.md, paddingHorizontal: space.md },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingVertical: space.sm },
  rowText: { flex: 1, gap: space.xs },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  needsDate: { gap: space.xs, paddingBottom: space.md },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  save: { flex: 1 },
});
