import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

type Node = ReactTestRenderer.ReactTestInstance;

/** Lets pending requests and the state updates they cause settle. */
export async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** The string content of every Text under `root`. */
export function texts(root: Node): string[] {
  return root.findAllByType(Text).map((t) => [].concat(t.props.children).filter((c) => typeof c === 'string').join(''));
}

/** Presses the first pressable whose text is exactly `label`. */
export function press(root: Node, label: string) {
  const target = root.findAll((n) => typeof n.props.onPress === 'function' && texts(n).some((t) => t === label))[0];
  if (!target) throw new Error(`No button "${label}" in: ${texts(root).join(' | ')}`);
  return act(async () => {
    await target.props.onPress();
  });
}

/** Presses the control with this accessibility label (for icon buttons, which have no text). */
export function tap(root: Node, label: string) {
  const target = root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  if (!target) throw new Error(`No control "${label}"`);
  return act(async () => {
    await target.props.onPress();
  });
}

/** Whether the button labelled `label` is disabled. */
export function isDisabled(root: Node, label: string): boolean {
  const button = root.findAll((n) => n.props.accessibilityRole === 'button' && texts(n).includes(label))[0];
  if (!button) throw new Error(`No button "${label}" in: ${texts(root).join(' | ')}`);
  return !!button.props.accessibilityState?.disabled;
}

/** Types `value` into the field with this placeholder. */
export function type(root: Node, placeholder: string, value: string) {
  const input = root.find((n) => n.props.placeholder === placeholder && typeof n.props.onChangeText === 'function');
  return act(async () => {
    input.props.onChangeText(value);
  });
}
