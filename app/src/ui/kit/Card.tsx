import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space, useTokens } from '../tokens';

type Props = { children: React.ReactNode; tint?: string; onPress?: () => void };

export function Card({ children, tint, onPress }: Props) {
  const { colors } = useTokens();
  const style = [styles.card, { backgroundColor: tint ?? colors.bg, borderColor: colors.line }];
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={[style, styles.tap]}>
        {children}
      </Pressable>
    );
  }
  return <View style={style}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
  tap: { minHeight: 44 },
});
