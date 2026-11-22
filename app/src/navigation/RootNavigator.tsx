import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { type Edge, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CourseScreen } from '../screens/courses/CourseScreen';
import { CoursesScreen } from '../screens/courses/CoursesScreen';
import { TokenConnectScreen } from '../screens/connect/TokenConnectScreen';
import { ReviewScreen } from '../screens/review/ReviewScreen';
import { ScheduleScreen } from '../screens/schedule/ScheduleScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { StudyTimesScreen } from '../screens/settings/StudyTimesScreen';
import { WhatCueKeepsScreen } from '../screens/settings/WhatCueKeepsScreen';
import { TodayScreen } from '../screens/today/TodayScreen';
import { WelcomeScreen } from '../screens/welcome/WelcomeScreen';
import type { IoniconName } from '../ui/kit';
import { useTokens } from '../ui/tokens';
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
          <Stack.Screen name="Course" component={CourseRoute} />
          <Stack.Screen name="StudyTimes" component={StudyTimesRoute} />
          <Stack.Screen name="WhatCueKeeps" component={WhatCueKeepsRoute} />
          <Stack.Group screenOptions={{ presentation: 'fullScreenModal' }}>
            <Stack.Screen name="Review" component={ReviewRoute} />
            <Stack.Screen name="TokenConnect" component={TokenConnectRoute} />
            <Stack.Screen name="Settings" component={SettingsRoute} />
          </Stack.Group>
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
      <Tab.Screen name="Today" component={TodayTab} />
      <Tab.Screen name="Schedule" component={ScheduleTab} />
      <Tab.Screen name="Courses" component={CoursesTab} />
    </Tab.Navigator>
  );
}

function TodayTab(props: TabScreenProps<'Today'>) {
  return (
    <Page edges={TAB_EDGES}>
      <TodayScreen {...props} />
    </Page>
  );
}

function ScheduleTab(props: TabScreenProps<'Schedule'>) {
  return (
    <Page edges={TAB_EDGES}>
      <ScheduleScreen {...props} />
    </Page>
  );
}

function CoursesTab(props: TabScreenProps<'Courses'>) {
  return (
    <Page edges={TAB_EDGES}>
      <CoursesScreen {...props} />
    </Page>
  );
}

function CourseRoute(props: RootScreenProps<'Course'>) {
  return (
    <Page>
      <CourseScreen {...props} />
    </Page>
  );
}

function ReviewRoute({ navigation, route }: RootScreenProps<'Review'>) {
  const { loginAvailable } = useStartup();
  return (
    <Page>
      <ReviewScreen
        initialPreview={route.params?.preview}
        loginAvailable={loginAvailable}
        onDone={() => backToTabs(navigation, 'Today')}
        onCancel={() => backToTabs(navigation)}
        onConnect={() => navigation.replace('TokenConnect')}
      />
    </Page>
  );
}

function TokenConnectRoute(props: RootScreenProps<'TokenConnect'>) {
  return (
    <Page>
      <TokenConnectScreen {...props} />
    </Page>
  );
}

function SettingsRoute(props: RootScreenProps<'Settings'>) {
  return (
    <Page>
      <SettingsScreen {...props} />
    </Page>
  );
}

function StudyTimesRoute(props: RootScreenProps<'StudyTimes'>) {
  return (
    <Page>
      <StudyTimesScreen {...props} />
    </Page>
  );
}

function WhatCueKeepsRoute(props: RootScreenProps<'WhatCueKeeps'>) {
  return (
    <Page>
      <WhatCueKeepsScreen {...props} />
    </Page>
  );
}

const ALL_EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];

/**
 * A screen's safe area on the app's background. It pads by the insets the app measures at its
 * root, not with SafeAreaView: on iOS, SafeAreaView inside a full-screen modal (Settings,
 * Check what Cue found) gets no top inset, and the page slid under the status bar.
 */
function Page({ edges = ALL_EDGES, children }: { edges?: Edge[]; children: React.ReactNode }) {
  const { colors } = useTokens();
  const insets = useSafeAreaInsets();
  const pad = (edge: Edge) => (edges.includes(edge) ? insets[edge] : 0);
  return (
    <View
      style={[
        styles.page,
        { backgroundColor: colors.bg, paddingTop: pad('top'), paddingRight: pad('right'), paddingBottom: pad('bottom'), paddingLeft: pad('left') },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});
