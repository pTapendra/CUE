/**
 * @format
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiProvider } from '../src/api/ApiContext';
import { ApiClient } from '../src/api/client';
import { StartupContext } from '../src/navigation/startup';
import { WelcomeScreen } from '../src/screens/welcome/WelcomeScreen';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, press } from '../test-support/ui';

it('puts the tabs under Review after a Canvas login, so Back cannot return to Welcome', async () => {
  const server = fakeServer();
  server.state.loginAvailable = true;
  const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
  const navigation = {
    replace: jest.fn(),
    navigate: jest.fn(),
    reset: jest.fn(),
    getState: () => ({ routes: [{ name: 'Welcome' }] }),
  };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ApiProvider client={client}>
        <StartupContext.Provider value={{ loginAvailable: true, canvasUrl: null }}>
          <WelcomeScreen {...({ navigation, route: { key: 'w', name: 'Welcome' } } as any)} />
        </StartupContext.Provider>
      </ApiProvider>,
    );
  });
  await press(tree.root, 'Log in with Canvas');
  await flush();
  await act(async () => {
    tree.root
      .findByType('WebView' as any)
      .props.onShouldStartLoadWithRequest({ url: 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1' });
  });
  await flush();
  expect(navigation.reset).toHaveBeenCalledWith({
    index: 1,
    routes: [{ name: 'Tabs', params: { screen: 'Today' } }, { name: 'Review' }],
  });
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(navigation.navigate).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});
