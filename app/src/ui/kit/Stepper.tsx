import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, space, type, useTokens } from '../tokens';

type Props = {
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
  label: string;
};

export function Stepper({ value, onMinus, onPlus, minusDisabled = false, plusDisabled = false, label }: Props) {
  const { colors } = useTokens();
  const end = (name: 'remove' | 'add', hint: string, disabled: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${hint}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.end, { backgroundColor: colors.bg2 }, disabled && styles.dim]}
    >
      <Ionicons name={name} size={20} color={colors.accent} />
    </Pressable>
  );
  return (
    <View style={styles.row}>
      {end('remove', 'less', minusDisabled, onMinus)}
      <Text accessibilityLabel={`${label}: ${value}`} style={[type.bodyStrong, styles.value, { color: colors.text }]}>
        {value}
      </Text>
      {end('add', 'more', plusDisabled, onPlus)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  end: { minWidth: 44, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.4 },
  value: { minWidth: 56, textAlign: 'center' },
});
