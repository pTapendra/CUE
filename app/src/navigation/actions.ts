import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList, TabParamList } from './types';

/**
 * Leaves a modal for the tabs. When the tabs are underneath, goes back to them, to `tab` if given.
 * Otherwise (after Welcome) the tabs become the only screen, so Back can't return to Welcome.
 */
export function backToTabs<T extends keyof RootStackParamList>(
  navigation: NativeStackNavigationProp<RootStackParamList, T>,
  tab?: keyof TabParamList,
): void {
  if (navigation.getState().routes[0]?.name === 'Tabs') {
    if (tab) navigation.popTo('Tabs', { screen: tab });
    else navigation.popToTop();
  } else {
    navigation.reset({ index: 0, routes: [{ name: 'Tabs', params: { screen: tab ?? 'Today' } }] });
  }
}
