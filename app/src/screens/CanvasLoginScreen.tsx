import React, { useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../ui/kit';
import { space, type, useTokens } from '../ui/tokens';
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
  const { colors } = useTokens();
  // Canvas's pages can take a few seconds through ngrok: show that something is happening.
  const [loading, setLoading] = useState(true);
  const host = hostOf(authorizeUrl);
  return (
    <Modal animationType="slide" onRequestClose={busy ? undefined : onCancel}>
      {/* A Modal is a separate native view tree, out of reach of the app's provider; without its own, iOS puts the header under the status bar. */}
      <SafeAreaProvider>
        <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
          <View style={styles.header}>
            <View style={styles.side}>
              <Button title="Cancel" variant="plain" disabled={busy} onPress={onCancel} />
            </View>
            <Text accessibilityRole="header" style={[type.bodyStrong, styles.title, { color: colors.text }]}>
              Log in to Canvas
            </Text>
            <View style={styles.side} />
          </View>
          {/* Where the page comes from, as a browser's address bar shows it. */}
          <View
            accessible
            accessibilityLabel={`Canvas at ${host}`}
            style={[styles.host, { backgroundColor: colors.bg2, borderColor: colors.line }]}
          >
            <Ionicons name="lock-closed" size={12} color={colors.text2} />
            <Text numberOfLines={1} style={[type.meta, { color: colors.text2 }]}>
              {host}
            </Text>
          </View>
          <View style={styles.root}>
            <WebView
              source={{ uri: authorizeUrl }}
              userAgent={loginUserAgent(authorizeUrl, Platform.OS)}
              incognito
              onShouldStartLoadWithRequest={(r) => onNavigate(r.url)}
              onNavigationStateChange={(s) => {
                onNavigate(s.url);
              }}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
            />
            {busy || loading ? (
              <View style={[styles.spinner, { backgroundColor: colors.bg }]}>
                <ActivityIndicator size="large" color={colors.accent} />
                {busy ? null : <Text style={[type.body, { color: colors.text2 }]}>Loading Canvas…</Text>}
              </View>
            ) : null}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingVertical: space.xs },
  side: { flex: 1, alignItems: 'flex-start' },
  title: { flexShrink: 1, textAlign: 'center', fontSize: 17 },
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  spinner: {
    ...StyleSheet.absoluteFill,
    opacity: 0.85,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
});
