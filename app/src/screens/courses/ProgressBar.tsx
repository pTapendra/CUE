import React from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, useTokens } from '../../ui/tokens';

/** A study plan's progress: `value` of `max` blocks accepted, filled in the course's mark colour. */
export function ProgressBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const { colors } = useTokens();
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now: value }}
      style={[styles.track, { backgroundColor: colors.bg2 }]}
    >
      <View testID="progress-fill" style={[styles.fill, { width: `${share * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { height: 6, borderRadius: radius.pill },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
});
