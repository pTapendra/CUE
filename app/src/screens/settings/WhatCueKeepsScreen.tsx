import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RootScreenProps } from '../../navigation/types';
import { IconButton } from '../../ui/kit';
import { space, type, useTokens } from '../../ui/tokens';

const POINTS = [
  { title: 'No name or email', text: "Cue never asks who you are. When you log in with Canvas, Cue keeps a scrambled code for your Canvas account, so it can find your schedule again. It can't turn that code back into your name." },
  {
    title: 'Canvas access stays on the server',
    text: "When you connect Canvas, the access is encrypted on Cue's server. It is never kept on this phone.",
  },
  { title: 'Cue only reads Canvas', text: 'Cue brings in your courses, assignments and exams. It never changes anything in Canvas.' },
  {
    title: 'You can remove it all',
    text: 'Delete all my data, in Settings, removes your account and everything Cue holds for you, on every phone.',
  },
];

/** A short, plain explanation of what Cue stores. */
export function WhatCueKeepsScreen({ navigation }: RootScreenProps<'WhatCueKeeps'>) {
  const { colors } = useTokens();
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} label="Back" onPress={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text accessibilityRole="header" style={[type.largeTitle, { color: colors.text }]}>
          What Cue keeps
        </Text>
        {POINTS.map((p) => (
          <View key={p.title} style={styles.point}>
            <Text style={[type.bodyStrong, { color: colors.text }]}>{p.title}</Text>
            <Text style={[type.body, { color: colors.text2 }]}>{p.text}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: space.sm, paddingTop: space.xs },
  body: { padding: space.lg, gap: space.lg },
  point: { gap: space.xs },
});
