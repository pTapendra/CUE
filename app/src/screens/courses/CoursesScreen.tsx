import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dayLabel } from '../../dates';
import type { TabScreenProps } from '../../navigation/types';
import { courseColorFor } from '../../ui/courseColors';
import { Card, CourseDot, EmptyState, ErrorBanner, ProfileButton, SyncButton, Tag } from '../../ui/kit';
import { space, type, useTokens } from '../../ui/tokens';
import { type CourseSummary, courseSummaries } from '../../viewmodels/courses';
import { useOverview } from '../../viewmodels/useOverview';
import { useSync } from '../../viewmodels/useSync';
import { CanvasLoginSheet } from '../CanvasLoginScreen';
import { ProgressBar } from './ProgressBar';

/** Courses: one card per course with what is next, each exam's study plan, and exams still without a date. */
export function CoursesScreen({ navigation }: TabScreenProps<'Courses'>) {
  const { colors, courses: palette, unknown } = useTokens();
  const { overview, courses, error, reload } = useOverview();
  const sync = useSync();
  const now = new Date();
  const summaries = overview ? courseSummaries(courses, overview, now) : [];

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={[type.largeTitle, styles.title, { color: colors.text }]}>
            Courses
          </Text>
          <View style={styles.actions}>
            <SyncButton
              variant="soft"
              busy={sync.busy}
              connected={sync.connected}
              onSync={sync.sync}
              onConnect={sync.connect}
            />
            <ProfileButton onPress={() => navigation.navigate('Settings')} />
          </View>
        </View>
        <Text style={[type.body, { color: colors.text2 }]}>Your courses · synced from Canvas</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
        {sync.login.error ? <ErrorBanner message={sync.login.error} /> : null}

        {!overview ? (
          error ? null : <ActivityIndicator style={styles.spinner} color={colors.accent} />
        ) : summaries.length === 0 ? (
          <EmptyState
            icon="library-outline"
            title="No courses yet"
            message={
              sync.connected
                ? 'Sync to bring in your courses from Canvas.'
                : 'Connect Canvas to bring in your courses.'
            }
            action={
              <SyncButton variant="soft" busy={sync.busy} connected={sync.connected} onSync={sync.sync} onConnect={sync.connect} />
            }
          />
        ) : (
          summaries.map((s) => (
            <CourseCard
              key={s.course.id}
              summary={s}
              color={courseColorFor(s.course.name, courses, palette, unknown)}
              onPress={() => navigation.navigate('Course', { courseId: s.course.id })}
            />
          ))
        )}
      </ScrollView>

      <CanvasLoginSheet login={sync.login} />
    </View>
  );
}

function CourseCard({
  summary,
  color,
  onPress,
}: {
  summary: CourseSummary;
  color: ReturnType<typeof courseColorFor>;
  onPress: () => void;
}) {
  const { colors } = useTokens();
  const { course, next, exams, undatedExams } = summary;
  return (
    <Card onPress={onPress}>
      <View style={styles.card}>
        <View style={styles.codeRow}>
          <CourseDot color={color} />
          <Text style={[type.section, { color: color.text }]}>{course.code ?? course.name}</Text>
        </View>
        <Text style={[type.title, { color: colors.text }]}>{course.name}</Text>
        {next ? (
          <Text style={[type.body, { color: colors.text2 }]}>{`Next: ${next.title} · ${dayLabel(new Date(next.dueAt!))}`}</Text>
        ) : null}
        {exams.map((plan) => {
          const line =
            plan.total > 0
              ? `study plan ${plan.accepted} of ${plan.total} blocks`
              : 'no study plan yet';
          return (
            <View key={plan.exam.id} style={styles.plan}>
              <Text style={[type.body, { color: colors.text }]}>
                {`${plan.exam.title} ${dayLabel(new Date(plan.exam.dueAt!))} · ${line}`}
              </Text>
              <ProgressBar value={plan.accepted} max={plan.total} color={color.mark} label={`${plan.exam.title} study plan`} />
            </View>
          );
        })}
        {undatedExams.map((exam) => (
          <Tag key={exam.id} label={`${exam.title} needs a date`} tone="exam" />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.xs },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  content: { padding: space.lg, gap: space.md },
  spinner: { paddingVertical: space.xl },
  card: { gap: space.sm },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  plan: { gap: space.xs },
});
