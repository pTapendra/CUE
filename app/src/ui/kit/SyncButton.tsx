import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
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
        <SyncIcon spinning={busy} color={colors.accent} />
      ) : (
        <View style={styles.row}>
          {busy ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="sync" size={16} color={colors.accent} />}
          <Text style={[type.bodyStrong, { color: colors.accent }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** The sync icon, turning about once a second while Cue syncs; still when the phone asks to reduce motion. */
function SyncIcon({ spinning, color }: { spinning: boolean; color: string }) {
  const reduceMotion = useReduceMotion();
  const [turn] = useState(() => new Animated.Value(0));
  const spin = spinning && !reduceMotion;
  useEffect(() => {
    if (!spin) {
      turn.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, turn]);

  const icon = <Ionicons name="sync" size={22} color={color} />;
  if (!spin) return icon;
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={{ transform: [{ rotate }] }}>{icon}</Animated.View>;
}

/** Whether the phone asks apps to reduce motion (and stays up to date when that changes). */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let current = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => current && setReduce(on))
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  return reduce;
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
