import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, space, type, useTokens } from '../tokens';
import { ripple } from './feedback';
import type { IoniconName } from './icons';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'plain';
  busy?: boolean;
  disabled?: boolean;
  icon?: IoniconName;
};

export function Button({ title, onPress, variant = 'primary', busy = false, disabled = false, icon }: Props) {
  const { colors } = useTokens();
  // `border`, when set, stays while pressed; otherwise the border follows the background.
  const look: { bg: string; pressed: string; fg: string; border?: string } = {
    primary: { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent },
    secondary: { bg: colors.bg, pressed: colors.bg2, fg: colors.accent, border: colors.line },
    danger: { bg: colors.dangerTint, pressed: colors.dangerPressed, fg: colors.danger },
    plain: { bg: 'transparent', pressed: colors.line, fg: colors.accent },
  }[variant];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      android_ripple={ripple(look.fg)}
      style={({ pressed }) => {
        const fill = pressed ? look.pressed : look.bg;
        return [styles.base, { backgroundColor: fill, borderColor: look.border ?? fill }, disabled && styles.dim];
      }}
    >
      <View style={styles.row}>
        {busy ? (
          <ActivityIndicator color={look.fg} />
        ) : icon ? (
          <Ionicons name={icon} size={18} color={look.fg} />
        ) : null}
        <Text style={[type.bodyStrong, { color: look.fg }]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
