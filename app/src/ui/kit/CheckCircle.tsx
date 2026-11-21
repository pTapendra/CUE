import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../tokens';
import { ripple } from './feedback';

type Props = {
  checked: boolean;
  exam?: boolean;
  /** May return a promise (such as a status change): until it settles, the circle shows the new state. */
  onPress: () => void | Promise<unknown>;
  label: string;
};

export function CheckCircle({ checked, exam = false, onPress, label }: Props) {
  const { colors } = useTokens();
  // The state shown at once while the change runs; afterwards `checked` says how it went.
  const [pending, setPending] = useState<boolean | null>(null);
  const running = useRef(false);
  const shown = pending ?? checked;
  const edge = exam ? colors.exam : colors.text3;

  async function press() {
    if (running.current) return; // one change at a time
    running.current = true;
    setPending(!checked);
    try {
      await onPress();
    } finally {
      running.current = false;
      setPending(null);
    }
  }

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: shown }}
      onPress={press}
      android_ripple={ripple(colors.text, { borderless: true, radius: 22 })}
      style={({ pressed }) => [styles.hit, pressed && { backgroundColor: colors.bg2 }]}
    >
      <View style={[styles.circle, { borderColor: shown ? colors.ok : edge }, shown && { backgroundColor: colors.ok }]}>
        {shown ? <Ionicons name="checkmark" size={14} color={colors.bg} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
