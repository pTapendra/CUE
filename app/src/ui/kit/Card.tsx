import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space, useTokens } from '../tokens';
import { ripple } from './feedback';

type Props = { children: React.ReactNode; tint?: string; onPress?: () => void };

export function Card({ children, tint, onPress }: Props) {
  const { colors } = useTokens();
  const style = [styles.card, { backgroundColor: tint ?? colors.bg, borderColor: colors.line }];
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        android_ripple={ripple(colors.text)}
        style={({ pressed }) => [style, styles.tap, pressed && { backgroundColor: colors.bg2 }]}
      >
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
