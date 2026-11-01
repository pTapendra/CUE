import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from './theme';

export function Button({
  title,
  onPress,
  disabled,
  busy,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const t = useTheme();
  const filled = variant === 'primary';
  const color = variant === 'danger' ? t.danger : filled ? t.primaryText : t.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: filled ? t.primary : 'transparent',
          borderColor: variant === 'danger' ? t.danger : t.primary,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? t.primary : t.border, backgroundColor: selected ? t.primary : t.surface }]}>
      <Text style={{ color: selected ? t.primaryText : t.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string }) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        style={[styles.input, { color: t.text, borderColor: error ? t.danger : t.border, backgroundColor: t.surface }]}
        {...input}
      />
      {error ? (
        <Text style={{ color: t.danger, fontSize: 12 }}>{error}</Text>
      ) : hint ? (
        <Text style={{ color: t.muted, fontSize: 12 }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: t.dangerTint }]}>
      <Text style={{ color: t.danger }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  banner: { padding: 12, borderRadius: 10 },
});
