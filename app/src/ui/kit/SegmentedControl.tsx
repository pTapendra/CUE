import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, type, useTokens } from '../tokens';
import { ripple } from './feedback';

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const { colors } = useTokens();
  return (
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: colors.bg2 }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            android_ripple={ripple(colors.text)}
            style={({ pressed }) => [
              styles.segment,
              selected ? { backgroundColor: colors.bg } : pressed && { backgroundColor: colors.line },
            ]}
          >
            <Text style={[type.bodyStrong, { color: selected ? colors.text : colors.text2 }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: radius.md, padding: 2 },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md - 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
});
