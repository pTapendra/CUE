import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../tokens';

type Props = { checked: boolean; exam?: boolean; onPress: () => void; label: string };

export function CheckCircle({ checked, exam = false, onPress, label }: Props) {
  const { colors } = useTokens();
  const edge = exam ? colors.exam : colors.text3;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.hit}
    >
      <View
        style={[styles.circle, { borderColor: checked ? colors.ok : edge }, checked && { backgroundColor: colors.ok }]}
      >
        {checked ? <Ionicons name="checkmark" size={14} color={colors.bg} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
