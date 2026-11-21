import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, type, useTokens } from '../tokens';
import type { IoniconName } from './icons';

type Props = { icon: IoniconName; title: string; message?: string; action?: React.ReactNode };

export function EmptyState({ icon, title, message, action }: Props) {
  const { colors } = useTokens();
  return (
    <View style={styles.box}>
      <Ionicons name={icon} size={36} color={colors.text3} />
      <Text style={[type.title, styles.text, { color: colors.text }]}>{title}</Text>
      {message ? <Text style={[type.body, styles.text, { color: colors.text2 }]}>{message}</Text> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: space.md, padding: space.xl },
  text: { textAlign: 'center' },
});
