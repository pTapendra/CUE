import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showReviewAfterConnect } from '../../navigation/actions';
import { useStartup } from '../../navigation/startup';
import type { RootScreenProps } from '../../navigation/types';
import { Button, ErrorBanner } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';
import { useConnectCanvas } from '../../viewmodels/useConnectCanvas';

/** Connects Canvas with an access token the student makes in Canvas, for a server without Canvas login. */
export function TokenConnectScreen({ navigation }: RootScreenProps<'TokenConnect'>) {
  const { colors } = useTokens();
  const { canvasUrl } = useStartup();
  const vm = useConnectCanvas(canvasUrl ?? '');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <View style={styles.side}>
          <Button title="Cancel" variant="plain" onPress={() => navigation.goBack()} />
        </View>
        <Text accessibilityRole="header" style={[type.bodyStrong, styles.title, { color: colors.text }]}>
          Connect Canvas
        </Text>
        <View style={styles.side} />
      </View>

      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[type.body, { color: colors.text2 }]}>
            Cue reads your courses, deadlines and exam dates. It never changes anything in Canvas, and you confirm every
            item before it is saved.
          </Text>

          <Field
            label="Canvas address"
            placeholder="yourschool.instructure.com"
            keyboardType="url"
            value={vm.baseUrl}
            onChangeText={vm.setBaseUrl}
          />
          <Button
            title="Open Canvas to create a token"
            variant="secondary"
            icon="open-outline"
            disabled={!vm.canOpenSettings}
            onPress={vm.openCanvasSettings}
          />
          <Field
            label="Access token"
            hint="On the Canvas page, log in, tap “+ New Access Token”, copy the token, then tap Done and paste it here. Cue keeps it encrypted on its server, not on this phone."
            placeholder="Paste your token"
            secureTextEntry
            value={vm.token}
            onChangeText={vm.setToken}
          />

          {vm.error ? <ErrorBanner message={vm.error} /> : null}

          <Button
            title="Connect and sync"
            busy={vm.busy}
            disabled={!vm.canSubmit}
            onPress={async () => {
              if (await vm.connect()) showReviewAfterConnect(navigation);
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  const { colors } = useTokens();
  return (
    <View style={styles.field}>
      <Text style={[type.bodyStrong, { color: colors.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.text3}
        style={[type.body, styles.input, { color: colors.text, borderColor: colors.line, backgroundColor: colors.bg }]}
        {...input}
      />
      {hint ? <Text style={[type.meta, { color: colors.text2 }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { flex: 1, alignItems: 'flex-start' },
  title: { flexShrink: 1, textAlign: 'center', fontSize: 17 },
  body: { padding: space.lg, gap: space.lg },
  field: { gap: space.xs },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
});
