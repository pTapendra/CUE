import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Item } from '../../api/types';
import { dayKey, dayLabel } from '../../dates';
import type { RootScreenProps } from '../../navigation/types';
import { courseColorFor } from '../../ui/courseColors';
import {
  Button,
  Card,
  CheckCircle,
  CourseDot,
  ErrorBanner,
  IconButton,
  ListRow,
  SegmentedControl,
  Tag,
} from '../../ui/kit';
import { space, type, useTokens } from '../../ui/tokens';
import { courseDetail, type ExamPlan } from '../../viewmodels/courses';
import { useItemActions } from '../../viewmodels/useItemActions';
import { useOverview } from '../../viewmodels/useOverview';
import { whenLabel } from '../../viewmodels/today';
import { ItemSheet } from '../sheets/ItemSheet';
import { ProgressBar } from './ProgressBar';

type Tab = 'exams' | 'work';

/** A course: its exams with their study plans, and its assignments and events. */
export function CourseScreen({ navigation, route }: RootScreenProps<'Course'>) {
  const { colors, courses: palette, unknown } = useTokens();
  const { overview, courses, loading, error, reload } = useOverview();
  const actions = useItemActions(reload);
  const [tab, setTab] = useState<Tab>('exams');
  const [editing, setEditing] = useState<Item | null>(null);
  const now = new Date();

  const course = courses.find((c) => c.id === route.params.courseId);
  const color = course ? courseColorFor(course.name, courses, palette, unknown) : unknown;
  const detail = course && overview ? courseDetail(course, overview, now) : null;
  const message = actions.error ?? error;

  // Back to the tabs underneath (not a second copy of them), so Back doesn't return to this course.
  const viewInSchedule = (plan: ExamPlan) =>
    navigation.popTo('Tabs', {
      screen: 'Schedule',
      params: { date: dayKey(new Date(plan.firstBlockStart ?? plan.exam.dueAt!)), view: 'day' },
    });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <IconButton
          icon={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
          label="Back"
          onPress={() => navigation.goBack()}
        />
        {course ? (
          <View style={styles.codeRow}>
            <CourseDot color={color} />
            <Text style={[type.section, { color: color.text }]}>{course.code ?? course.name}</Text>
          </View>
        ) : null}
      </View>
      {course ? (
        <Text accessibilityRole="header" style={[type.largeTitle, styles.title, { color: colors.text }]}>
          {course.name}
        </Text>
      ) : null}

      <ScrollView contentContainerStyle={styles.content}>
        {message ? <ErrorBanner message={message} onRetry={reload} /> : null}
        {!detail ? (
          loading ? (
            <ActivityIndicator style={styles.spinner} color={colors.accent} />
          ) : message ? null : (
            <Text style={[type.body, { color: colors.text2 }]}>This course isn't here any more.</Text>
          )
        ) : (
          <>
            <SegmentedControl
              options={[
                { value: 'exams', label: 'Exams' },
                { value: 'work', label: 'Work' },
              ]}
              value={tab}
              onChange={setTab}
            />
            {tab === 'exams' ? (
              <>
                {detail.upcomingExams.length === 0 && detail.pastExams.length === 0 ? (
                  <Text style={[type.body, { color: colors.text2 }]}>No exams in this course.</Text>
                ) : null}
                {detail.upcomingExams.map((plan) => (
                  <ExamCard
                    key={plan.exam.id}
                    plan={plan}
                    mark={color.mark}
                    onEdit={() => setEditing(plan.exam)}
                    onSchedule={() => viewInSchedule(plan)}
                  />
                ))}
                {/* Past or done, dimmed with colour (never opacity); a done exam without a date is last. */}
                {detail.pastExams.map((exam) => (
                  <View key={exam.id}>
                    <Card>
                      <View style={styles.card}>
                        <View style={styles.titleRow}>
                          <Text style={[type.bodyStrong, { color: colors.text2 }]}>{exam.title}</Text>
                          <Tag label="Exam" tone="exam" />
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={dateButtonLabel(exam)}
                          onPress={() => setEditing(exam)}
                          style={styles.dateButton}
                        >
                          <Text style={[type.body, { color: colors.text3 }]}>
                            {exam.dueAt ? dayLabel(new Date(exam.dueAt)) : 'No date'}
                          </Text>
                        </Pressable>
                      </View>
                    </Card>
                  </View>
                ))}
              </>
            ) : detail.work.length === 0 ? (
              <Text style={[type.body, { color: colors.text2 }]}>No assignments or events in this course.</Text>
            ) : (
              detail.work.map((item) => {
                const done = item.status === 'done';
                return (
                  <View key={item.id} style={styles.workRow}>
                    <CheckCircle
                      checked={done}
                      label={`Mark ${item.title} ${done ? 'not done' : 'done'}`}
                      onPress={() => actions.setStatus(item.id, done ? 'not_started' : 'done')}
                    />
                    <View style={styles.flex}>
                      <ListRow
                        title={item.title}
                        meta={item.dueAt ? whenLabel(new Date(item.dueAt), now) : 'No date'}
                        onPress={() => setEditing(item)}
                        dimmed={done}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {editing !== null ? (
        <ItemSheet
          key={editing.id}
          visible
          item={editing}
          courses={courses}
          error={message}
          onClose={() => setEditing(null)}
          onSave={(input) => actions.saveItem(editing.id, input)}
          onStatus={(status) => actions.setStatus(editing.id, status)}
          onDelete={() => actions.deleteItem(editing.id)}
        />
      ) : null}
    </View>
  );
}

/** What a screen reader says for an exam's date button, which opens the exam to change its date. */
function dateButtonLabel(exam: Item): string {
  return `${exam.dueAt ? 'Change' : 'Add'} date for ${exam.title}`;
}

function ExamCard({
  plan,
  mark,
  onEdit,
  onSchedule,
}: {
  plan: ExamPlan;
  mark: string;
  onEdit: () => void;
  onSchedule: () => void;
}) {
  const { colors } = useTokens();
  const { exam } = plan;
  return (
    <Card>
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>{exam.title}</Text>
          <Tag label="Exam" tone="exam" />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dateButtonLabel(exam)}
          onPress={onEdit}
          style={styles.dateButton}
        >
          <Text style={[type.bodyStrong, { color: exam.dueAt ? colors.text2 : colors.accent }]}>
            {exam.dueAt ? dayLabel(new Date(exam.dueAt)) : 'Add date'}
          </Text>
        </Pressable>
        {plan.total > 0 ? (
          <>
            <ProgressBar value={plan.accepted} max={plan.total} color={mark} label={`${exam.title} study plan`} />
            <Text style={[type.body, { color: colors.text2 }]}>
              {`${plan.accepted} accepted · ${plan.suggested} suggested`}
            </Text>
          </>
        ) : (
          <Text style={[type.body, { color: colors.text2 }]}>No study blocks yet</Text>
        )}
        {exam.dueAt || plan.firstBlockStart ? <Button title="View in Schedule" variant="secondary" onPress={onSchedule} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingTop: space.xs },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { paddingHorizontal: space.lg },
  content: { padding: space.lg, gap: space.md },
  spinner: { paddingVertical: space.xl },
  card: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  dateButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  workRow: { flexDirection: 'row', alignItems: 'center' },
});
