import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { space, type, useTokens } from '../tokens';

type Props = { title: string; actionLabel?: string; onAction?: () => void };

export function SectionHeader({ title, actionLabel, onAction }: Props) {
  const { colors } = useTokens();
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={[type.section, styles.title, { color: colors.text3 }]}>
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} style={styles.action}>
          <Text style={[type.bodyStrong, { color: colors.accent }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg },
  // Shown in capitals; screen readers still read the words.
  title: { flex: 1, letterSpacing: 0.6, textTransform: 'uppercase' },
  action: { minHeight: 44, justifyContent: 'center', paddingLeft: space.md },
});
