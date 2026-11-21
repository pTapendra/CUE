/* eslint-env jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-webview', () => {
  const { createElement } = require('react');
  return { WebView: (p) => createElement('WebView', p) };
});
jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = require('react');
  return {
    __esModule: true,
    default: (p) => createElement('DateTimePicker', p),
  };
});
