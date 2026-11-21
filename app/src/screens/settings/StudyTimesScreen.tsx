import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { RootScreenProps } from '../../navigation/types';
import { Button, DateTimeField, ErrorBanner, IconButton, Stepper } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';
import {
  hoursText,
  isoToTime,
  MAX_LIMIT_HOURS,
  MIN_LIMIT_HOURS,
  rangeText,
  timeToIso,
  useStudyTimes,
} from '../../viewmodels/useStudyTimes';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Where the student sets the times Cue may plan study blocks in. */
export function StudyTimesScreen({ navigation }: RootScreenProps<'StudyTimes'>) {
  const { colors } = useTokens();
  const vm = useStudyTimes(() => navigation.goBack());

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} label="Back" onPress={() => navigation.goBack()} />
      </View>

      {vm.loading ? (
        <ActivityIndicator style={styles.spinner} color={colors.accent} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text accessibilityRole="header" style={[type.largeTitle, { color: colors.text }]}>
            Study times
          </Text>
          {/* Try again only for a failed load: after a failed save it would load over the student's changes. */}
          {vm.error ? <ErrorBanner message={vm.error} onRetry={vm.loadFailed ? vm.reload : undefined} /> : null}
          <Text style={[type.body, { color: colors.text2 }]}>
            Cue only suggests study blocks inside these times, and never on top of your Canvas events.
          </Text>

          {vm.rows.map((w, i) => {
            const day = DAY_NAMES[w.weekday]!;
            const error = vm.errors[i];
            const overnight = rangeText(w).includes('next day');
            return (
              <View key={w.weekday} style={[styles.row, { backgroundColor: colors.bg2 }]}>
                <View style={styles.line}>
                  <Text style={[type.bodyStrong, styles.day, { color: colors.text }]}>{day}</Text>
                  {w.enabled ? (
                    <View style={styles.chips}>
                      <DateTimeField
                        label={`${day} start`}
                        mode="time"
                        value={timeToIso(w.start)}
                        onChange={(iso) => iso && vm.change(w.weekday, { start: isoToTime(iso) })}
                      />
                      <Text style={[type.body, { color: colors.text2 }]}>to</Text>
                      <DateTimeField
                        label={`${day} end`}
                        mode="time"
                        value={timeToIso(w.end)}
                        onChange={(iso) => iso && vm.change(w.weekday, { end: isoToTime(iso) })}
                      />
                    </View>
                  ) : (
                    <Text style={[type.body, styles.chips, { color: colors.text2 }]}>No studying</Text>
                  )}
                  <Switch
                    accessibilityLabel={`${day} ${w.enabled ? 'on' : 'off'}`}
                    value={w.enabled}
                    onValueChange={(enabled) => vm.change(w.weekday, { enabled })}
                    trackColor={{ true: colors.accent }}
                  />
                </View>
                {w.enabled && error ? <Text style={[type.meta, { color: colors.danger }]}>{error}</Text> : null}
                {w.enabled && !error && overnight ? (
                  <Text style={[type.meta, { color: colors.text2 }]}>{rangeText(w)}</Text>
                ) : null}
              </View>
            );
          })}

          <View style={[styles.row, styles.line, { backgroundColor: colors.bg2 }]}>
            <Text style={[type.bodyStrong, styles.limit, { color: colors.text }]}>Daily limit</Text>
            <Stepper
              label="Daily limit"
              value={hoursText(vm.dailyLimitHours)}
              minusDisabled={vm.dailyLimitHours <= MIN_LIMIT_HOURS}
              plusDisabled={vm.dailyLimitHours >= MAX_LIMIT_HOURS}
              onMinus={() => vm.stepLimit(-1)}
              onPlus={() => vm.stepLimit(1)}
            />
          </View>

          <Text style={[type.meta, { color: colors.text2 }]}>{`Time zone: ${vm.timeZone}`}</Text>
        </ScrollView>
      )}

      <View style={[styles.footer, { borderTopColor: colors.line }]}>
        <Button title="Save" busy={vm.saving} disabled={!vm.canSave} onPress={vm.save} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: space.sm, paddingTop: space.xs },
  spinner: { flex: 1 },
  body: { padding: space.lg, gap: space.md },
  row: { borderRadius: radius.lg, padding: space.md, gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Grows with the phone's text size rather than clipping the day's name.
  day: { minWidth: 36 },
  chips: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  limit: { flex: 1 },
  footer: { padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
