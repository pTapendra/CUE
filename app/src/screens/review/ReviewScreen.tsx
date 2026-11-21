import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApi } from '../../api/ApiContext';
import type { Course, ProposedItem } from '../../api/types';
import { dayLabel, timeLabel } from '../../dates';
import { courseColorFor } from '../../ui/courseColors';
import { Button, CourseDot, DateTimeField, ErrorBanner, Tag, useToast } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';
import { useCanvasLogin } from '../../viewmodels/useCanvasLogin';
import { useSyncReview } from '../../viewmodels/useSyncReview';
import { CanvasLoginScreen } from '../CanvasLoginScreen';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

  const count = vm.preview?.items.length ?? 0;
  const markFor = (name: string) => (courses ? courseColorFor(name, courses, palette, unknown) : unknown);

  async function save() {
    const imported = await vm.confirm();
    if (imported === null) return;
    onDone();
    toast.show(`${plural(imported, 'item')} saved from Canvas`);
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[type.largeTitle, { color: colors.text }]}>
            Check what Cue found
          </Text>
          {vm.preview ? (
            <Text style={[type.body, { color: colors.text2 }]}>
              {`${plural(count, 'item')} from ${plural(vm.groups.length, 'course')}. Untick anything you don't want.`}
            </Text>
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
        {vm.preview && count === 0 ? (
          <Text style={[type.body, { color: colors.text2 }]}>Nothing upcoming in Canvas right now.</Text>
        ) : null}
        {vm.groups.map((g) => (
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
        ))}
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
        <Button title="Cancel" variant="secondary" onPress={onCancel} />
        <View style={styles.save}>
          {vm.preview ? (
            <Button
              title={`Save ${plural(vm.selected.size, 'item')}`}
              busy={vm.saving}
              disabled={vm.selected.size === 0}
              onPress={save}
            />
          ) : (
            <Button title="Try again" onPress={vm.reload} />
          )}
        </View>
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
  const when = [due ? `${dayLabel(due)} · ${timeLabel(due)}` : null, item.alreadyImported ? 'Already saved' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.row, { backgroundColor: colors.bg2 }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={item.title}
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
          <DateTimeField label={`Due date for ${item.title}`} value={date} mode="datetime" onChange={onDate} allowClear clearLabel="Add date" />
          {date ? null : <Text style={[type.meta, { color: colors.text2 }]}>or add it later</Text>}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: space.lg, gap: space.lg },
  header: { gap: space.sm },
  group: { gap: space.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { borderRadius: radius.md, paddingHorizontal: space.md },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingVertical: space.sm },
  rowText: { flex: 1, gap: space.xs },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  needsDate: { gap: space.xs, paddingBottom: space.md },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  save: { flex: 1 },
});
