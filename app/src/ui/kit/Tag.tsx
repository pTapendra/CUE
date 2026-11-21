import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, space, type, useTokens } from '../tokens';

type Props = { label: string; tone: 'exam' | 'ok' | 'warn' };

export function Tag({ label, tone }: Props) {
  const { colors } = useTokens();
  const look = {
    exam: { bg: colors.examTint, fg: colors.exam },
    ok: { bg: colors.okTint, fg: colors.ok },
    warn: { bg: colors.bg2, fg: colors.warn },
  }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: look.bg }]}>
      <Text style={[type.meta, styles.text, { color: look.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, alignSelf: 'flex-start' },
  text: { fontWeight: '700' },
});
