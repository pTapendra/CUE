import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button, ErrorBanner } from '../ui/components';
import { useTheme } from '../ui/theme';
import { rangeText, useStudyTimes } from '../viewmodels/useStudyTimes';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Where the student sets the times Cue may plan study blocks in. */
export function StudyTimesScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useTheme();
  const vm = useStudyTimes(onDone);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { borderColor: t.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onCancel} hitSlop={12}>
          <Text style={[styles.arrow, { color: t.primary }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: t.text }]}>Study times</Text>
        <View style={styles.spacer} />
      </View>

      {vm.loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <ErrorBanner message={vm.error} />
          <Text style={{ color: t.muted, fontSize: 13 }}>
            Cue only suggests study blocks inside these times, and never on top of your Canvas events.
          </Text>

          {vm.rows.map((w, i) => {
            const day = DAY_NAMES[w.weekday]!;
            const error = vm.errors[i];
            return (
              <View key={w.weekday} style={[styles.row, { borderColor: t.border }]}>
                <View style={styles.line}>
                  <Text style={[styles.day, { color: t.text }]}>{day}</Text>
                  <TimeInput label={`${day} start`} value={w.start} invalid={!!error} onChange={(start) => vm.change(w.weekday, { start })} />
                  <Text style={{ color: t.muted }}>to</Text>
                  <TimeInput label={`${day} end`} value={w.end} invalid={!!error} onChange={(end) => vm.change(w.weekday, { end })} />
                  <Switch
                    accessibilityLabel={`${day} ${w.enabled ? 'on' : 'off'}`}
                    value={w.enabled}
                    onValueChange={(enabled) => vm.change(w.weekday, { enabled })}
                  />
                </View>
                {error ? (
                  <Text style={{ color: t.danger, fontSize: 12 }}>{error}</Text>
                ) : (
                  <Text style={{ color: t.muted, fontSize: 12 }}>{rangeText(w)}</Text>
                )}
              </View>
            );
          })}

          <View style={[styles.row, styles.line, { borderColor: t.border }]}>
            <Text style={[styles.limit, { color: t.text }]}>Most study in one day</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Less per day" hitSlop={8} onPress={() => vm.stepLimit(-1)}>
              <Text style={[styles.step, { color: t.primary }]}>–</Text>
            </Pressable>
            <Text style={{ color: t.text }}>{`${vm.dailyLimitHours} h`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="More per day" hitSlop={8} onPress={() => vm.stepLimit(1)}>
              <Text style={[styles.step, { color: t.primary }]}>+</Text>
            </Pressable>
          </View>

          <Text style={{ color: t.muted, fontSize: 13 }}>{`Time zone: ${vm.timeZone}`}</Text>
        </ScrollView>
      )}

      <View style={[styles.footer, { borderColor: t.border, backgroundColor: t.background }]}>
        <Button title="Save and plan" busy={vm.saving} disabled={!vm.canSave} onPress={vm.save} />
      </View>
    </View>
  );
}

function TimeInput({ label, value, invalid, onChange }: { label: string; value: string; invalid: boolean; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      placeholder="18:00"
      placeholderTextColor={t.muted}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="numbers-and-punctuation"
      maxLength={5}
      style={[styles.input, { color: t.text, borderColor: invalid ? t.danger : t.border, backgroundColor: t.surface }]}
    />
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
  spacer: { width: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 10 },
  row: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  day: { width: 36, fontWeight: '700' },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 15, textAlign: 'center' },
  limit: { flex: 1 },
  step: { fontSize: 24, paddingHorizontal: 8 },
  footer: { padding: 16, borderTopWidth: 1 },
});
