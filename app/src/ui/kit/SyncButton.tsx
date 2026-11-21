import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, space, type, useTokens } from '../tokens';

type Props = {
  busy: boolean;
  connected: boolean;
  onSync: () => void;
  onConnect: () => void;
  variant?: 'filled' | 'soft';
};

export function SyncButton({ busy, connected, onSync, onConnect, variant = 'filled' }: Props) {
  const { colors } = useTokens();
  const bg = variant === 'filled' ? colors.accent : colors.accentTint;
  const fg = variant === 'filled' ? colors.onAccent : colors.accent;
  const title = !connected ? 'Connect Canvas' : busy ? 'Syncing…' : 'Sync';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={connected ? onSync : onConnect}
      style={[styles.base, { backgroundColor: bg }]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={fg} /> : <Ionicons name="sync" size={16} color={fg} />}
        <Text style={[type.bodyStrong, { color: fg }]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
