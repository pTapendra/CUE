import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, type, useTokens } from '../ui/tokens';
import { syncedLabel } from '../viewmodels/today';
import type { Sync } from '../viewmodels/useSync';

/**
 * Under the title of every page with a Sync button: "Syncing…", when Canvas was last synced, or a
 * Connect Canvas link. Each state is 44 pt tall, and "Syncing…" has an icon where the ✓ is, so
 * neither the page nor the words jump when it changes.
 */
export function SyncStatus({ sync, now }: { sync: Sync; now: Date }) {
  const { colors } = useTokens();
  if (sync.busy) {
    return (
      <View style={[styles.line, styles.synced]}>
        <Ionicons name="sync" size={14} color={colors.text2} />
        <Text style={[type.body, { color: colors.text2 }]}>Syncing…</Text>
      </View>
    );
  }
  if (!sync.connected) {
    return (
      <Pressable accessibilityRole="button" onPress={sync.connect} style={styles.line}>
        <Text style={[type.bodyStrong, { color: colors.accent }]}>Connect Canvas</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.line, styles.synced]}>
      <Ionicons name="checkmark-circle" size={14} color={colors.ok} />
      <Text style={[type.body, { color: colors.text2 }]}>
        {sync.lastSyncedAt ? `Canvas synced ${syncedLabel(sync.lastSyncedAt, now)}` : 'Canvas connected'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { minHeight: 44, justifyContent: 'center' },
  synced: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
