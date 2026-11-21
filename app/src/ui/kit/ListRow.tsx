import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, type, useTokens } from '../tokens';

type Props = {
  title: string;
  meta?: string;
  /** Shown before the meta line, such as a course dot. */
  metaLeading?: React.ReactNode;
  onPress?: () => void;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  tag?: React.ReactNode;
  dimmed?: boolean;
};

export function ListRow({ title, meta, metaLeading, onPress, leading, trailing, tag, dimmed }: Props) {
  const { colors } = useTokens();
  const body = (
    <>
      {leading}
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text style={[type.bodyStrong, styles.title, { color: colors.text }]}>{title}</Text>
          {tag}
        </View>
        {meta ? (
          <View style={styles.metaRow}>
            {metaLeading}
            <Text style={[type.meta, styles.meta, { color: colors.text2 }]}>{meta}</Text>
          </View>
        ) : null}
      </View>
      {trailing ??
        (onPress ? <Ionicons name="chevron-forward" size={16} color={colors.text3} /> : null)}
    </>
  );
  const style = [styles.row, { borderBottomColor: colors.line, opacity: dimmed ? 0.55 : 1 }];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={style}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  meta: { flexShrink: 1 },
});
