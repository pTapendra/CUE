import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApi } from '../../api/ApiContext';
import { showReviewAfterConnect } from '../../navigation/actions';
import { useStartup } from '../../navigation/startup';
import type { RootScreenProps } from '../../navigation/types';
import { setSkippedCanvas } from '../../prefs';
import { Button, ErrorBanner, type IoniconName } from '../../ui/kit';
import { radius, space, type, useTokens } from '../../ui/tokens';
import { useCanvasLogin } from '../../viewmodels/useCanvasLogin';
import { CanvasLoginScreen } from '../CanvasLoginScreen';

const FEATURES: { icon: IoniconName; title: string; text: string }[] = [
  {
    icon: 'calendar-outline',
    title: 'Every deadline in one place',
    text: 'Assignments and exams from Canvas, and anything you add yourself.',
  },
  {
    icon: 'time-outline',
    title: 'Study time, planned for you',
    text: 'Cue suggests study blocks before each exam, inside the hours you choose.',
  },
  {
    icon: 'sparkles-outline',
    title: 'Study plans are on the way',
    text: 'Next, Cue will plan each exam from today to exam day.',
  },
];

/** The first screen on a phone that has neither connected Canvas nor skipped it. */
export function WelcomeScreen({ navigation }: RootScreenProps<'Welcome'>) {
  const api = useApi();
  const { colors } = useTokens();
  const { loginAvailable } = useStartup();
  // Welcome gives way to the tabs, with Review on top, so Android's back button from Review can't return to it.
  const login = useCanvasLogin(() => showReviewAfterConnect(navigation));

  async function skip() {
    // Only the next launch reads the flag: if the phone can't keep it, Welcome just shows again then.
    await setSkippedCanvas(api.store, true).catch(() => {});
    navigation.reset({ index: 0, routes: [{ name: 'Tabs', params: { screen: 'Today' } }] });
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.intro}>
          <View style={styles.brand}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.mark, { backgroundColor: colors.accent }]}
            >
              <Ionicons name="school" size={22} color={colors.onAccent} />
            </View>
            <Text style={[type.title, { color: colors.text }]}>Cue</Text>
          </View>
          <Text accessibilityRole="header" style={[type.largeTitle, { color: colors.text }]}>
            Know what to study, and when.
          </Text>
          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f.title} style={styles.feature}>
                <View style={[styles.featureIcon, { backgroundColor: colors.accentTint }]}>
                  <Ionicons name={f.icon} size={20} color={colors.accent} />
                </View>
                <View style={styles.featureText}>
                  <Text style={[type.bodyStrong, { color: colors.text }]}>{f.title}</Text>
                  <Text style={[type.body, { color: colors.text2 }]}>{f.text}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.actions}>
          {login.error ? <ErrorBanner message={login.error} /> : null}
          {loginAvailable ? (
            <Button title="Log in with Canvas" busy={login.busy && !login.authorizeUrl} onPress={login.start} />
          ) : (
            <Button title="Connect Canvas" onPress={() => navigation.navigate('TokenConnect')} />
          )}
          <Button title="Skip for now · add dates by hand" variant="plain" onPress={skip} />
          <Text style={[type.meta, styles.footnote, { color: colors.text2 }]}>
            No name or email needed. Your Canvas access stays on Cue's server, not this phone.
          </Text>
        </View>
      </ScrollView>

      {login.authorizeUrl ? (
        <CanvasLoginScreen
          authorizeUrl={login.authorizeUrl}
          busy={login.busy}
          onNavigate={login.onNavigate}
          onCancel={login.cancel}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flexGrow: 1, justifyContent: 'space-between', padding: space.xl, gap: space.xl },
  intro: { gap: space.lg, paddingTop: space.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mark: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  features: { gap: space.lg, marginTop: space.sm },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  featureIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  featureText: { flex: 1, gap: 2 },
  actions: { gap: space.sm },
  footnote: { textAlign: 'center', marginTop: space.xs },
});
