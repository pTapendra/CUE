import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, type, useTokens } from '../tokens';

type Props = { message: string; onRetry?: () => void };

export function ErrorBanner({ message, onRetry }: Props) {
  const { colors } = useTokens();
  return (
    <View accessibilityRole="alert" style={[styles.box, { backgroundColor: colors.dangerTint }]}>
      <Text style={[type.body, styles.message, { color: colors.danger }]}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={onRetry} style={styles.retry}>
          <Text style={[type.bodyStrong, { color: colors.danger }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingLeft: space.lg, gap: space.sm },
  message: { flex: 1, paddingVertical: space.md },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg },
});
