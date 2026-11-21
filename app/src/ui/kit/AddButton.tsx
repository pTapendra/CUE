import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, useTokens } from '../tokens';

const SIZE = 56;
const MARGIN = space.lg;

/** How far a list's end must scroll up to clear the + button, with a gap above it. */
export const ADD_BUTTON_CLEARANCE = SIZE + 2 * MARGIN;

/** The round + button at the bottom right of a screen. Pad the scrolling content with ADD_BUTTON_CLEARANCE. */
export function AddButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add"
      onPress={onPress}
      style={[styles.add, { backgroundColor: colors.accent }]}
    >
      <Ionicons name="add" size={28} color={colors.onAccent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  add: {
    position: 'absolute',
    right: MARGIN,
    bottom: MARGIN,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
});
