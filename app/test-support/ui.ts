import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, StyleSheet, Text } from 'react-native';

type Node = ReactTestRenderer.ReactTestInstance;

/** Lets pending requests and the state updates they cause settle. */
export async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Every node under `root` that the student can see, in tree order. A tab in the background stays
 * mounted, but React Navigation turns its touches off (`pointerEvents="none"`); it is left out, as it is
 * hidden on the phone.
 */
function shown(root: Node): Node[] {
  const out: Node[] = [];
  const walk = (node: Node) => {
    out.push(node);
    for (const child of node.children) {
      if (typeof child !== 'string' && child.props.pointerEvents !== 'none') walk(child);
    }
  };
  walk(root);
  return out;
}

/** The nodes on screen that match `predicate`, like `root.findAll` but without background tabs. */
export function onScreen(root: Node, predicate: (node: Node) => boolean): Node[] {
  return shown(root).filter(predicate);
}

/** The string content of every Text on screen under `root`. */
export function texts(root: Node): string[] {
  return onScreen(root, (n) => n.type === Text).map((t) =>
    [].concat(t.props.children).filter((c) => typeof c === 'string').join(''),
  );
}

/** Presses the first pressable on screen whose text is exactly `label`. */
export function press(root: Node, label: string) {
  const target = onScreen(root, (n) => typeof n.props.onPress === 'function' && texts(n).some((t) => t === label))[0];
  if (!target) throw new Error(`No button "${label}" in: ${texts(root).join(' | ')}`);
  return act(async () => {
    await target.props.onPress();
  });
}

/** Presses the control on screen with this accessibility label (for icon buttons, which have no text). */
export function tap(root: Node, label: string) {
  const target = onScreen(root, (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  if (!target) throw new Error(`No control "${label}"`);
  return act(async () => {
    await target.props.onPress();
  });
}

/** Whether the button labelled `label` is disabled. */
export function isDisabled(root: Node, label: string): boolean {
  const button = onScreen(root, (n) => n.props.accessibilityRole === 'button' && texts(n).includes(label))[0];
  if (!button) throw new Error(`No button "${label}" in: ${texts(root).join(' | ')}`);
  return !!button.props.accessibilityState?.disabled;
}

/** Types `value` into the field on screen with this placeholder. */
export function type(root: Node, placeholder: string, value: string) {
  const input = onScreen(root, (n) => n.props.placeholder === placeholder && typeof n.props.onChangeText === 'function')[0];
  if (!input) throw new Error(`No field "${placeholder}"`);
  return act(async () => {
    input.props.onChangeText(value);
  });
}

/** The lowest opacity on `node` or any of its ancestors (1 when nothing fades it). */
export function lowestOpacity(node: Node): number {
  let lowest = 1;
  for (let n: Node | null = node; n; n = n.parent) {
    const style = StyleSheet.flatten(n.props.style);
    if (typeof style?.opacity === 'number') lowest = Math.min(lowest, style.opacity);
  }
  return lowest;
}

/** The colour of the Text on screen under `root` whose content is exactly `content`. */
export function textColor(root: Node, content: string): string | undefined {
  const node = onScreen(root, (n) => n.type === Text && texts(n).includes(content) && n.props.children === content)[0];
  return node ? StyleSheet.flatten(node.props.style)?.color : undefined;
}

/**
 * The flattened style of `node`. A Pressable's style may be a function of its state: it is called
 * with `pressed` (false unless asked), as React Native does while the finger is down.
 */
export function styleOf(node: Node, pressed = false) {
  const style = node.props.style;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed, hovered: false }) : style) ?? {};
}

/**
 * What React Native does when the student leaves the app and comes back to it: every AppState
 * listener still subscribed hears "background", then "active".
 */
export async function comeBackToApp() {
  const add = AppState.addEventListener as jest.Mock;
  const live = add.mock.calls
    .map(([event, listener], i) => ({ event, listener, subscription: add.mock.results[i]?.value }))
    .filter(({ event, subscription }) => event === 'change' && subscription?.remove.mock.calls.length === 0);
  await act(async () => {
    live.forEach(({ listener }) => listener('background'));
    live.forEach(({ listener }) => listener('active'));
  });
  await flush();
}
