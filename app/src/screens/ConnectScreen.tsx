import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CanvasLoginScreen } from './CanvasLoginScreen';
import { Button, ErrorBanner, Field } from '../ui/components';
import { useTheme } from '../ui/theme';
import { useCanvasLogin } from '../viewmodels/useCanvasLogin';
import { useConnectCanvas } from '../viewmodels/useConnectCanvas';

export function ConnectScreen({
  initialUrl,
  loginAvailable,
  onConnected,
  onSkip,
}: {
  initialUrl?: string | null;
  loginAvailable: boolean;
  onConnected: () => void;
  onSkip: () => void;
}) {
  const t = useTheme();
  const vm = useConnectCanvas(initialUrl ?? '');
  const login = useCanvasLogin(onConnected);

  if (loginAvailable) {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.title, { color: t.text }]}>Connect Canvas</Text>
        <Text style={{ color: t.muted, lineHeight: 20 }}>
          Log in with your Canvas account. Cue only reads your courses and deadlines.
        </Text>
        <ErrorBanner message={login.error} />
        <View style={styles.actions}>
          <Button title="Log in with Canvas" busy={login.busy && !login.authorizeUrl} onPress={login.start} />
          <Button title="Skip – I'll add dates by hand" variant="secondary" onPress={onSkip} />
        </View>
        {login.authorizeUrl ? (
          <CanvasLoginScreen
            authorizeUrl={login.authorizeUrl}
            busy={login.busy}
            onNavigate={login.onNavigate}
            onCancel={login.cancel}
          />
        ) : null}
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: t.text }]}>Connect Canvas</Text>
        <Text style={{ color: t.muted, lineHeight: 20 }}>
          Cue reads your courses, deadlines and exam dates. It never changes anything in Canvas, and you confirm every
          item before it is saved.
        </Text>

        <Field
          label="Canvas address"
          placeholder="yourschool.instructure.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={vm.baseUrl}
          onChangeText={vm.setBaseUrl}
        />
        <Button
          title="Open Canvas to create a token"
          variant="secondary"
          disabled={!vm.canOpenSettings}
          onPress={vm.openCanvasSettings}
        />
        <Field
          label="Access token"
          hint="On the Canvas page, log in, tap “+ New Access Token”, copy the token, then tap Done and paste it here. Cue keeps it encrypted on its server, not on this phone."
          placeholder="Paste your token"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={vm.token}
          onChangeText={vm.setToken}
        />

        <ErrorBanner message={vm.error} />

        <View style={styles.actions}>
          <Button
            title="Connect and sync"
            busy={vm.busy}
            disabled={!vm.canSubmit}
            onPress={async () => {
              if (await vm.connect()) onConnected();
            }}
          />
          <Button title="Skip – I'll add dates by hand" variant="secondary" onPress={onSkip} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  actions: { gap: 10, marginTop: 8 },
});
