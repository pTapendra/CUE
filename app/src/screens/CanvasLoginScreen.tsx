import React, { useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../ui/components';
import { useTheme } from '../ui/theme';
import { loginUserAgent } from '../viewmodels/canvasLogin';

/** Canvas's own login and Authorize pages in a full-screen web view. Nothing is injected and no page content is read. */
export function CanvasLoginScreen({
  authorizeUrl,
  busy,
  onNavigate,
  onCancel,
}: {
  authorizeUrl: string;
  busy: boolean;
  onNavigate: (url: string) => boolean;
  onCancel: () => void;
}) {
  const t = useTheme();
  // Canvas's pages can take a few seconds through ngrok: show that something is happening.
  const [loading, setLoading] = useState(true);
  return (
    <Modal animationType="slide" onRequestClose={busy ? undefined : onCancel}>
      {/* A Modal is a separate native view tree, out of reach of the app's provider; without its own, iOS puts the header under the status bar. */}
      <SafeAreaProvider>
        <SafeAreaView style={[styles.root, { backgroundColor: t.background }]}>
          <View style={styles.header}>
            <Button title="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
            <Text style={[styles.title, { color: t.text }]}>Log in to Canvas</Text>
          </View>
          <View style={styles.root}>
            <WebView
              source={{ uri: authorizeUrl }}
              userAgent={loginUserAgent(authorizeUrl, Platform.OS)}
              incognito
              onShouldStartLoadWithRequest={r => onNavigate(r.url)}
              onNavigationStateChange={s => {
                onNavigate(s.url);
              }}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
            />
            {busy || loading ? (
              <View style={[styles.spinner, { backgroundColor: t.background }]}>
                <ActivityIndicator size="large" color={t.primary} />
                {busy ? null : <Text style={[styles.spinnerText, { color: t.muted }]}>Loading Canvas…</Text>}
              </View>
            ) : null}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  spinner: {
    ...StyleSheet.absoluteFill,
    opacity: 0.85,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  spinnerText: { fontSize: 15 },
});
