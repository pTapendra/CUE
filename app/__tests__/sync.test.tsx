import React from 'react';
import { Pressable, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ApiProvider } from '../src/api/ApiContext';
import { ApiClient } from '../src/api/client';
import { type Startup, StartupContext } from '../src/navigation/startup';
import type { RootStackParamList } from '../src/navigation/types';
import { CanvasLoginSheet } from '../src/screens/CanvasLoginScreen';
import { useSync } from '../src/viewmodels/useSync';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, press, texts } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

type Server = ReturnType<typeof fakeServer>;

const Stack = createNativeStackNavigator<RootStackParamList>();

/** A screen that shows what useSync returns and offers its two actions, as Schedule and Today do. */
function Probe() {
  const sync = useSync();
  return (
    <>
      <Text>{`connected ${sync.connected}`}</Text>
      <Text>{`login ${sync.loginAvailable}`}</Text>
      <Text>{`synced ${sync.lastSyncedAt}`}</Text>
      <Text>{`busy ${sync.busy}`}</Text>
      <Pressable onPress={sync.sync}>
        <Text>sync</Text>
      </Pressable>
      <Pressable onPress={sync.connect}>
        <Text>connect</Text>
      </Pressable>
      <CanvasLoginSheet login={sync.login} />
    </>
  );
}

const Marker = (label: string) =>
  function MarkerScreen() {
    return <Text>{label}</Text>;
  };
const ReviewMarker = Marker('Review screen');
const TokenMarker = Marker('Token screen');
const SettingsMarker = Marker('Settings screen');

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

async function open(server: Server, startup: Startup = { loginAvailable: false, canvasUrl: null }, fetchImpl = server.fetchImpl) {
  const client = new ApiClient('http://cue.test', memoryStore(), fetchImpl);
  const nav = createNavigationContainerRef<RootStackParamList>();
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ApiProvider client={client}>
        <StartupContext.Provider value={startup}>
          <NavigationContainer ref={nav}>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Tabs" component={Probe} />
              <Stack.Screen name="Review" component={ReviewMarker} />
              <Stack.Screen name="TokenConnect" component={TokenMarker} />
              <Stack.Screen name="Settings" component={SettingsMarker} />
            </Stack.Navigator>
          </NavigationContainer>
        </StartupContext.Provider>
      </ApiProvider>,
    );
  });
  await flush();
  return { root: tree!.root, nav };
}

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
});

const connectionReads = (server: Server) =>
  server.state.calls.filter((c) => c.method === 'GET' && c.path === '/api/canvas/connection').length;

describe('useSync', () => {
  it('reads the connection when its screen is focused, and again when it comes back', async () => {
    const server = fakeServer();
    server.state.connected = true;
    server.state.loginAvailable = true;
    server.state.lastSyncedAt = '2026-11-02T08:48:00.000Z';
    const { root, nav } = await open(server);
    expect(texts(root)).toEqual(
      expect.arrayContaining(['connected true', 'login true', 'synced 2026-11-02T08:48:00.000Z', 'busy false']),
    );
    expect(connectionReads(server)).toBe(1);

    await act(async () => nav.navigate('Settings'));
    server.state.connected = false;
    server.state.lastSyncedAt = null;
    await act(async () => nav.goBack());
    await flush();
    expect(connectionReads(server)).toBe(2);
    expect(texts(root)).toEqual(expect.arrayContaining(['connected false', 'synced null']));
  });

  it('when connected, sync opens Review, which runs the sync', async () => {
    const server = fakeServer();
    server.state.connected = true;
    const { root } = await open(server);

    await press(root, 'sync');
    await flush();
    expect(texts(root)).toContain('Review screen');
  });

  it('when not connected, sync connects instead (in token mode, the token form)', async () => {
    const { root } = await open(fakeServer());
    expect(texts(root)).toContain('connected false');

    await press(root, 'sync');
    await flush();
    expect(texts(root)).toContain('Token screen');
    expect(texts(root)).not.toContain('Review screen');
  });

  it('in token mode, connect opens the token form', async () => {
    const { root } = await open(fakeServer());

    await press(root, 'connect');
    await flush();
    expect(texts(root)).toContain('Token screen');
  });

  it('with Canvas login, connect is busy while the login starts, then shows it; a finished login opens Review', async () => {
    const server = fakeServer();
    server.state.loginAvailable = true;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (release = resolve));
    const gated = (async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/api/canvas/login') await started;
      return server.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const { root } = await open(server, { loginAvailable: true, canvasUrl: null }, gated);

    await press(root, 'connect');
    expect(texts(root)).toContain('busy true');
    expect(root.findAllByType('WebView' as never)).toHaveLength(0);

    await act(async () => release());
    await flush();
    expect(texts(root)).toContain('busy false');
    const web = root.findByType('WebView' as never);
    await act(async () => {
      web.props.onShouldStartLoadWithRequest({ url: 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1' });
    });
    await flush();
    expect(root.findAllByType('WebView' as never)).toHaveLength(0);
    expect(texts(root)).toContain('Review screen');
  });
});
