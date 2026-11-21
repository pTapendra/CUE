import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, StatusBar, StyleSheet, Text } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ApiProvider } from './src/api/ApiContext';
import { ApiClient, friendlyMessage } from './src/api/client';
import { SERVER_URL } from './src/config';
import { RootNavigator } from './src/navigation/RootNavigator';
import type { Startup } from './src/navigation/startup';
import { getOnboarded } from './src/prefs';
import { syncTimeZone } from './src/timeZone';
import { Button, ToastProvider } from './src/ui/kit';
import { space, type, useTokens } from './src/ui/tokens';

type Started = { initialRoute: 'Welcome' | 'Tabs'; startup: Startup };

export default function App({ client }: { client?: ApiClient }) {
  const api = useMemo(() => client ?? new ApiClient(SERVER_URL, AsyncStorage), [client]);
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ApiProvider client={api}>
        <ToastProvider>
          <Root api={api} />
        </ToastProvider>
      </ApiProvider>
    </SafeAreaProvider>
  );
}

function Root({ api }: { api: ApiClient }) {
  const { colors, dark } = useTokens();
  const [started, setStarted] = useState<Started | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.ensureAccount();
        syncTimeZone(api); // not awaited: a slow server never holds up startup (and it never fails)
        const [status, onboarded] = await Promise.all([api.getConnection(), getOnboarded(api.store)]);
        if (cancelled) return;
        setStarted({
          // Welcome until the student connects Canvas or skips it (once; disconnecting later doesn't bring it back).
          initialRoute: status.connected || onboarded ? 'Tabs' : 'Welcome',
          startup: { loginAvailable: status.loginAvailable, canvasUrl: status.baseUrl, linked: status.linked },
        });
      } catch (err) {
        if (!cancelled) setStartError(friendlyMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  // The phone may be in another time zone when the student comes back to the app, whichever screen
  // is open: tell the server, which re-plans (screens with study blocks load again; see onTimeZoneSaved).
  // Only once start-up has made the account and sent the zone the first time.
  const ready = started !== null;
  useEffect(() => {
    if (!ready) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncTimeZone(api);
    });
    return () => subscription.remove();
  }, [api, ready]);

  return (
    <>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      {started ? (
        <RootNavigator initialRouteName={started.initialRoute} startup={started.startup} />
      ) : (
        <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
          {startError ? (
            <>
              <Text style={[type.body, styles.message, { color: colors.text }]}>{startError}</Text>
              <Button
                title="Try again"
                onPress={() => {
                  setStartError(null);
                  setAttempt((a) => a + 1);
                }}
              />
            </>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </SafeAreaView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  message: { textAlign: 'center', marginBottom: space.lg },
});
