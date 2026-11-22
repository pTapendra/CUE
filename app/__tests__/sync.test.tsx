import React from 'react';
import { AccessibilityInfo, Pressable, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiProvider } from '../src/api/ApiContext';
import { ApiClient } from '../src/api/client';
import { type Startup, StartupContext } from '../src/navigation/startup';
import type { RootStackParamList } from '../src/navigation/types';
import { CanvasLoginSheet } from '../src/screens/CanvasLoginScreen';
import { useSync } from '../src/viewmodels/useSync';
import { toReview } from '../src/viewmodels/useSyncReview';
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
      <Text>{`linked ${sync.linked}`}</Text>
      <Text>{`synced ${sync.lastSyncedAt}`}</Text>
      <Text>{`busy ${sync.busy}`}</Text>
      <Text>{`inSync ${sync.inSync}`}</Text>
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
/** Stands in for Check what Cue found, and says whether it was given what the sync read. */
function ReviewMarker({ route }: NativeStackScreenProps<RootStackParamList, 'Review'>) {
  return (
    <>
      <Text>Review screen</Text>
      <Text>{`preview ${route.params?.preview ? 'given' : 'none'}`}</Text>
    </>
  );
}
const TokenMarker = Marker('Token screen');
const SettingsMarker = Marker('Settings screen');

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

async function open(server: Server, startup: Startup = { loginAvailable: false, canvasUrl: null, linked: false }, fetchImpl = server.fetchImpl) {
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
const syncReads = (server: Server) => server.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/canvas/sync').length;

describe('toReview', () => {
  const item = { key: 'k', courseName: 'C', kind: 'assignment' as const, title: 'T', dueAt: null, needsDate: false };
  const none = { syncId: 's', newItems: [], changed: [], removed: [], skipped: [] };
  it('is true when anything is new, changed or removed, and not for skipped items alone', () => {
    expect(toReview(none)).toBe(false);
    expect(toReview({ ...none, skipped: [item] })).toBe(false);
    expect(toReview({ ...none, newItems: [item] })).toBe(true);
    expect(toReview({ ...none, changed: [{ key: 'k', courseName: 'C', kind: 'assignment', title: 'T', changes: [] }] })).toBe(true);
    expect(toReview({ ...none, removed: [{ key: 'k', courseName: 'C', kind: 'assignment', title: 'T', dueAt: null }] })).toBe(true);
  });
});

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

  it('when Canvas has something new, sync reads it once and opens Review with it', async () => {
    const server = fakeServer();
    server.state.connected = true;
    const { root } = await open(server);

    await press(root, 'sync');
    await flush();
    expect(texts(root)).toEqual(expect.arrayContaining(['Review screen', 'preview given']));
    expect(syncReads(server)).toBe(1);
  });

  it('when nothing is new, sync stays, is in sync for 2 seconds, and says so to a screen reader', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    const server = fakeServer();
    server.state.connected = true;
    server.state.preview.newItems = [];
    const { root } = await open(server);
    expect(connectionReads(server)).toBe(1);

    await press(root, 'sync');
    await flush();
    expect(texts(root)).not.toContain('Review screen');
    expect(texts(root)).toEqual(expect.arrayContaining(['inSync true', 'busy false']));
    expect(announce).toHaveBeenCalledWith('In sync with Canvas');
    // The synced time is read again.
    expect(connectionReads(server)).toBe(2);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(texts(root)).toContain('inSync false');
  });

  it('with only skipped items, sync stays too: there is nothing new to review', async () => {
    const server = fakeServer();
    server.state.connected = true;
    server.state.preview.skipped = server.state.preview.newItems;
    server.state.preview.newItems = [];
    const { root } = await open(server);

    await press(root, 'sync');
    await flush();
    expect(texts(root)).not.toContain('Review screen');
    expect(texts(root)).toContain('inSync true');
  });

  it('is busy while it reads, and a second tap does nothing', async () => {
    const server = fakeServer();
    server.state.connected = true;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gated = (async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/api/canvas/sync') await gate;
      return server.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const { root } = await open(server, undefined, gated);

    await press(root, 'sync');
    expect(texts(root)).toContain('busy true');
    await press(root, 'sync');
    await act(async () => release());
    await flush();
    expect(syncReads(server)).toBe(1);
    expect(texts(root)).toContain('Review screen');
  });

  it('when the read fails, sync opens Review, which explains', async () => {
    const server = fakeServer();
    server.state.connected = true;
    server.state.syncError = { status: 409, error: 'canvas_token_rejected' };
    const { root } = await open(server);

    await press(root, 'sync');
    await flush();
    expect(texts(root)).toEqual(expect.arrayContaining(['Review screen', 'preview none']));
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
    const { root } = await open(server, { loginAvailable: true, canvasUrl: null, linked: false }, gated);

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
    // The finished login runs the sync: everything is new, so the review opens with it.
    expect(texts(root)).toEqual(expect.arrayContaining(['Review screen', 'preview given']));
    expect(syncReads(server)).toBe(1);
  });

  it('reports linked from the connection status', async () => {
    const server = fakeServer();
    server.state.linked = true;
    const { root } = await open(server);
    await flush();
    expect(texts(root)).toContain('linked true');
  });

  describe.each([
    ['switched', 'device-9', true],
    ['unswitched', null, false],
  ])('after a %s login', (_name, switchToken, sent) => {
    it(`${sent ? 'sends' : "doesn't send"} the phone's time zone`, async () => {
      const server = fakeServer();
      server.state.loginAvailable = true;
      server.state.switchToken = switchToken;
      const { root } = await open(server, { loginAvailable: true, canvasUrl: null, linked: false });
      await press(root, 'connect');
      await flush();
      await act(async () => {
        root
          .findByType('WebView' as never)
          .props.onShouldStartLoadWithRequest({ url: 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1' });
      });
      await flush();
      const puts = server.state.calls.filter((c) => c.method === 'PUT' && c.path === '/api/planner/settings');
      expect(puts).toHaveLength(sent ? 1 : 0);
    });
  });
});
