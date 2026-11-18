import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ApiProvider } from './src/api/ApiContext';
import { ApiClient, friendlyMessage } from './src/api/client';
import { SERVER_URL } from './src/config';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { StudyTimesScreen } from './src/screens/StudyTimesScreen';
import { ReviewScreen } from './src/screens/ReviewScreen';
import { WeekScreen } from './src/screens/WeekScreen';
import { syncTimeZone } from './src/timeZone';
import { Button } from './src/ui/components';
import { useTheme } from './src/ui/theme';

type Screen = 'loading' | 'connect' | 'review' | 'week' | 'studyTimes';

export default function App({ client }: { client?: ApiClient }) {
  const api = useMemo(() => client ?? new ApiClient(SERVER_URL, AsyncStorage), [client]);
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ApiProvider client={api}>
        <Root api={api} />
      </ApiProvider>
    </SafeAreaProvider>
  );
}

function Root({ api }: { api: ApiClient }) {
  const t = useTheme();
  const scheme = useColorScheme();
  const [screen, setScreen] = useState<Screen>('loading');
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.ensureAccount();
        syncTimeZone(api); // not awaited: a slow server never holds up startup (and it never fails)
        const status = await api.getConnection();
        if (cancelled) return;
        setCanvasUrl(status.baseUrl);
        setScreen(status.connected ? 'week' : 'connect');
      } catch (err) {
        if (!cancelled) setStartError(friendlyMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.background }]}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      {screen === 'loading' ? (
        <View style={styles.center}>
          {startError ? (
            <>
              <Text style={{ color: t.text, textAlign: 'center', marginBottom: 16 }}>{startError}</Text>
              <Button
                title="Try again"
                onPress={() => {
                  setStartError(null);
                  setAttempt((a) => a + 1);
                }}
              />
            </>
          ) : (
            <ActivityIndicator color={t.primary} />
          )}
        </View>
      ) : null}
      {screen === 'connect' ? (
        <ConnectScreen initialUrl={canvasUrl} onConnected={() => setScreen('review')} onSkip={() => setScreen('week')} />
      ) : null}
      {screen === 'review' ? <ReviewScreen onDone={() => setScreen('week')} onCancel={() => setScreen('week')} /> : null}
      {screen === 'week' ? (
        <WeekScreen
          onSync={() => setScreen('review')}
          onCanvasSettings={() => setScreen('connect')}
          onStudyTimes={() => setScreen('studyTimes')}
        />
      ) : null}
      {screen === 'studyTimes' ? (
        <StudyTimesScreen onDone={() => setScreen('week')} onCancel={() => setScreen('week')} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
