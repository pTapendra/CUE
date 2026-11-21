import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { TokenConnectScreen } from '../screens/connect/TokenConnectScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { SettingsMenu } from '../screens/SettingsMenu';
import { StudyTimesScreen } from '../screens/StudyTimesScreen';
import { WeekScreen } from '../screens/WeekScreen';
import { WelcomeScreen } from '../screens/welcome/WelcomeScreen';
import type { IoniconName } from '../ui/kit';
import { space, type, useTokens } from '../ui/tokens';
import { backToTabs } from './actions';
import { type Startup, StartupContext, useStartup } from './startup';
import type { RootScreenProps, RootStackParamList, TabParamList, TabScreenProps } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(name: IoniconName) {
  return ({ color, size }: { color: string; size: number }) => <Ionicons name={name} size={size} color={color} />;
}

const TAB_ICONS: Record<keyof TabParamList, ReturnType<typeof tabIcon>> = {
  Today: tabIcon('today-outline'),
  Schedule: tabIcon('calendar-outline'),
  Courses: tabIcon('library-outline'),
};

/** Tab screens leave the bottom edge to the tab bar. */
const TAB_EDGES: Edge[] = ['top', 'left', 'right'];

/** The whole app once start-up is done: Welcome, the tabs, and the screens and modals above them. */
export function RootNavigator({ initialRouteName, startup }: { initialRouteName: 'Welcome' | 'Tabs'; startup: Startup }) {
  const { colors, dark } = useTokens();
  const theme = useMemo<Theme>(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.bg,
        card: colors.bg,
        text: colors.text,
        border: colors.line,
        notification: colors.danger,
      },
    };
  }, [colors, dark]);

  return (
    <StartupContext.Provider value={startup}>
      <NavigationContainer theme={theme}>
        <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Tabs" component={TabsNavigator} />
          <Stack.Screen name="StudyTimes" component={StudyTimesRoute} />
          <Stack.Group screenOptions={{ presentation: 'fullScreenModal' }}>
            <Stack.Screen name="Review" component={ReviewRoute} />
            <Stack.Screen name="TokenConnect" component={TokenConnectScreen} />
          </Stack.Group>
          {/* The old ⚙ menu draws its own sheet over the screen below, until Settings has its own screen. */}
          <Stack.Screen
            name="Settings"
            component={SettingsRoute}
            options={{ presentation: 'transparentModal', animation: 'none' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </StartupContext.Provider>
  );
}

function TabsNavigator() {
  const { colors } = useTokens();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.text3,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line },
        tabBarIcon: TAB_ICONS[route.name],
      })}
    >
      <Tab.Screen name="Today" component={TodayPlaceholder} />
      <Tab.Screen name="Schedule" component={ScheduleTab} />
      <Tab.Screen name="Courses" component={CoursesPlaceholder} />
    </Tab.Navigator>
  );
}

function ScheduleTab({ navigation }: TabScreenProps<'Schedule'>) {
  return (
    <Page edges={TAB_EDGES}>
      <WeekScreen onSync={() => navigation.navigate('Review')} onSettings={() => navigation.navigate('Settings')} />
    </Page>
  );
}

function TodayPlaceholder() {
  return <Placeholder title="Today" text="Your day will show here soon. For now, your week is in Schedule." />;
}

function CoursesPlaceholder() {
  return <Placeholder title="Courses" text="Your courses will show here soon." />;
}

function Placeholder({ title, text }: { title: string; text: string }) {
  const { colors } = useTokens();
  return (
    <Page edges={TAB_EDGES}>
      <View style={styles.placeholder}>
        <Text accessibilityRole="header" style={[type.largeTitle, { color: colors.text }]}>
          {title}
        </Text>
        <Text style={[type.body, { color: colors.text2 }]}>{text}</Text>
      </View>
    </Page>
  );
}

function ReviewRoute({ navigation }: RootScreenProps<'Review'>) {
  const { loginAvailable } = useStartup();
  return (
    <Page>
      <ReviewScreen
        loginAvailable={loginAvailable}
        onDone={() => backToTabs(navigation, 'Today')}
        onCancel={() => backToTabs(navigation)}
        onConnect={() => navigation.replace('TokenConnect')}
      />
    </Page>
  );
}

function SettingsRoute({ navigation }: RootScreenProps<'Settings'>) {
  return (
    <SettingsMenu
      visible
      onStudyTimes={() => navigation.replace('StudyTimes')}
      onCanvas={() => navigation.replace('Welcome')}
      onClose={() => navigation.goBack()}
    />
  );
}

function StudyTimesRoute({ navigation }: RootScreenProps<'StudyTimes'>) {
  return (
    <Page>
      <StudyTimesScreen onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />
    </Page>
  );
}

/** A screen's safe area on the app's background. */
function Page({ edges, children }: { edges?: Edge[]; children: React.ReactNode }) {
  const { colors } = useTokens();
  return (
    <SafeAreaView edges={edges} style={[styles.page, { backgroundColor: colors.bg }]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  placeholder: { padding: space.lg, gap: space.sm },
});
