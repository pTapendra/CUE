import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, useTokens } from '../tokens';
import type { IoniconName } from './icons';

type Props = { icon: IoniconName; label: string; onPress: () => void; tone?: 'plain' | 'soft' };

export function IconButton({ icon, label, onPress, tone = 'plain' }: Props) {
  const { colors } = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.base, tone === 'soft' && { backgroundColor: colors.accentTint }]}
    >
      <Ionicons name={icon} size={22} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minWidth: 44, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
