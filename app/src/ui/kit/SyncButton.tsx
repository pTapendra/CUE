import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, space, type, useTokens } from '../tokens';
import { ripple } from './feedback';

type Props = {
  busy: boolean;
  connected: boolean;
  onSync: () => void;
  onConnect: () => void;
  /**
   * `icon`: just the sync icon, like the other header buttons (a screen reader still hears what it
   * does). `soft`: icon and words on a tinted pill, for the empty states that explain it.
   */
  variant?: 'icon' | 'soft';
};

export function SyncButton({ busy, connected, onSync, onConnect, variant = 'icon' }: Props) {
  const { colors } = useTokens();
  const title = !connected ? 'Connect Canvas' : busy ? 'Syncing…' : 'Sync';
  const iconOnly = variant === 'icon';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={connected ? onSync : onConnect}
      android_ripple={ripple(colors.accent, { borderless: iconOnly })}
      style={({ pressed }) =>
        iconOnly
          ? [styles.icon, pressed && { backgroundColor: colors.accentTint }]
          : [styles.pill, { backgroundColor: pressed ? colors.line : colors.accentTint }]
      }
    >
      {iconOnly ? (
        busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Ionicons name="sync" size={22} color={colors.accent} />
        )
      ) : (
        <View style={styles.row}>
          {busy ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="sync" size={16} color={colors.accent} />}
          <Text style={[type.bodyStrong, { color: colors.accent }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: { minWidth: 44, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  pill: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
