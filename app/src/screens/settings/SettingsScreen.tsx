import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useApi } from '../../api/ApiContext';
import { friendlyMessage } from '../../api/client';
import type { PlannerSettings } from '../../api/types';
import type { RootScreenProps } from '../../navigation/types';
import { setOnboarded } from '../../prefs';
import { syncTimeZone } from '../../timeZone';
import { ErrorBanner, ListRow, ripple, SectionHeader, Tag } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';
import { syncedLabel } from '../../viewmodels/today';
import { hoursText, studyTimesSummary } from '../../viewmodels/useStudyTimes';
import { useSync } from '../../viewmodels/useSync';
import { CanvasLoginSheet } from '../CanvasLoginScreen';

/** Settings, a full-screen modal opened from the gear on Today: Canvas, the study plan, privacy and the version. */
export function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  const api = useApi();
  const { colors } = useTokens();
  const sync = useSync();
  const [planner, setPlanner] = useState<PlannerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Again each time Settings is back in view, so Study times' new values show.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      api
        .getPlannerSettings()
        .then((s) => current && setPlanner(s))
        .catch(() => {}); // the rows just show no value
      return () => {
        current = false;
      };
    }, [api]),
  );

  function confirmDisconnect() {
    Alert.alert('Disconnect Canvas?', 'Your schedule and study plans stay. Cue just stops reading Canvas, so nothing new comes in.', [
      { text: 'Disconnect', style: 'destructive', onPress: disconnect },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function disconnect() {
    setError(null);
    try {
      await api.disconnectCanvas();
      await sync.reload();
    } catch (err) {
      setError(friendlyMessage(err));
    }
  }

  function confirmDelete() {
    Alert.alert('Delete all your data?', "Your schedule, courses and study plans are removed from Cue, on every phone. This can't be undone.", [
      { text: 'Delete everything', style: 'destructive', onPress: deleteEverything },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function deleteEverything() {
    setError(null);
    setDeleting(true);
    try {
      // Forgets the device token only once the server has deleted the account.
      await api.deleteAccount();
    } catch (err) {
      setError(friendlyMessage(err));
      setDeleting(false);
      return;
    }
    await startOver();
  }

  function confirmLogOut() {
    Alert.alert('Log out of Cue?', 'Your schedule and study plans stay saved. Log in with Canvas to get them back, on this phone or another.', [
      { text: 'Log out', onPress: logOut },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function logOut() {
    setError(null);
    setLoggingOut(true);
    try {
      // Forgets the device token (a 401 means the server already has) but leaves the account on the server.
      await api.logout();
    } catch (err) {
      setError(friendlyMessage(err));
      setLoggingOut(false);
      return;
    }
    await startOver();
  }

  /** After the account is gone from this phone (deleted, or logged out): a fresh anonymous start at Welcome. */
  async function startOver() {
    // Only the next launch reads the flag: if the phone can't clear it, Welcome just doesn't show then.
    await setOnboarded(api.store, false).catch(() => {});
    // A new anonymous account now, told the phone's time zone (without waiting for it): the planner plans
    // nothing for an account without one. If the server can't be reached, the next request makes the
    // account, and the zone goes with the next start or return to the app.
    try {
      await api.ensureAccount();
      syncTimeZone(api);
    } catch {
      // see above
    }
    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  }

  const studyTimes = () => navigation.navigate('StudyTimes');
  const connectLabel = sync.loginAvailable ? 'Log in with Canvas' : 'Connect Canvas';

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg2 }]}>
      <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.line }]}>
        <Text accessibilityRole="header" style={[type.largeTitle, styles.title, { color: colors.text }]}>
          Settings
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={() => navigation.goBack()} style={styles.done}>
          <Text style={[type.bodyStrong, { color: colors.accent }]}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {error ? <ErrorBanner message={error} /> : null}
        {sync.login.error ? <ErrorBanner message={sync.login.error} /> : null}

        <SectionHeader title="Canvas" />
        <Group>
          <ListRow
            title="Canvas"
            meta={sync.connected ? connectedMeta(sync.lastSyncedAt) : undefined}
            leading={
              <View style={[styles.mark, { backgroundColor: colors.accentTint }]}>
                <Ionicons name="school" size={18} color={colors.accent} />
              </View>
            }
            trailing={sync.connected ? <Tag label="Connected" tone="ok" /> : <NotConnected />}
          />
          {sync.connected ? (
            <>
              <Action title="Sync now" onPress={() => navigation.navigate('Review')} />
              <Action title="Disconnect Canvas" danger onPress={confirmDisconnect} />
            </>
          ) : (
            <Action title={connectLabel} busy={sync.busy} onPress={sync.connect} />
          )}
        </Group>

        <SectionHeader title="Study plan" />
        <Group>
          <ListRow title="Study times" meta={planner ? studyTimesSummary(planner.windows) : undefined} onPress={studyTimes} />
          <ListRow
            title="Daily limit"
            meta={planner ? hoursText(Math.round(planner.dailyLimitMinutes / 60)) : undefined}
            onPress={studyTimes}
          />
        </Group>

        <SectionHeader title="Privacy" />
        <Group>
          <ListRow title="What Cue keeps" onPress={() => navigation.navigate('WhatCueKeeps')} />
          <Action title="Delete all my data" danger busy={deleting} onPress={confirmDelete} />
        </Group>

        {sync.linked ? (
          <>
            <SectionHeader title="Account" />
            <Group>
              <Action title="Log out" busy={loggingOut} onPress={confirmLogOut} />
            </Group>
          </>
        ) : null}

        <SectionHeader title="About" />
        <Group>
          <ListRow title="Version" trailing={<Text style={[type.body, { color: colors.text2 }]}>{Constants.expoConfig?.version ?? '1.0.0'}</Text>} />
        </Group>
      </ScrollView>

      <CanvasLoginSheet login={sync.login} />
    </View>
  );
}

/** "Synced 12 min ago · read-only", or "Connected · read-only" before the first sync. */
function connectedMeta(lastSyncedAt: string | null): string {
  return lastSyncedAt ? `Synced ${syncedLabel(lastSyncedAt, new Date())} · read-only` : 'Connected · read-only';
}

function NotConnected() {
  const { colors } = useTokens();
  return <Text style={[type.body, { color: colors.text2 }]}>Not connected</Text>;
}

/** A rounded list of rows. */
function Group({ children }: { children: React.ReactNode }) {
  const { colors } = useTokens();
  return <View style={[styles.group, { backgroundColor: colors.bg }]}>{children}</View>;
}

/** A row that does something, in red when it removes something. */
function Action({ title, onPress, danger = false, busy = false }: { title: string; onPress: () => void; danger?: boolean; busy?: boolean }) {
  const { colors } = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      android_ripple={ripple(danger ? colors.danger : colors.accent)}
      style={({ pressed }) => [styles.action, { borderBottomColor: colors.line }, pressed && { backgroundColor: colors.bg2 }]}
    >
      <Text style={[type.bodyStrong, { color: danger ? colors.danger : colors.accent }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1 },
  done: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  body: { padding: space.lg, paddingTop: 0, gap: space.sm, paddingBottom: space.xl },
  group: { borderRadius: radius.lg, paddingHorizontal: space.lg, overflow: 'hidden' },
  action: { minHeight: 44, justifyContent: 'center', paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  mark: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
