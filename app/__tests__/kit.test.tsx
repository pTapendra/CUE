import React from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  ADD_BUTTON_CLEARANCE,
  AddButton,
  Button,
  Card,
  CheckCircle,
  DateTimeField,
  DayStrip,
  ErrorBanner,
  IconButton,
  ListRow,
  ProfileButton,
  SegmentedControl,
  Stepper,
  SyncButton,
  ToastProvider,
  useToast,
} from '../src/ui/kit';
import { lightColors } from '../src/ui/tokens';
import { isDisabled, press, styleOf, tap, texts } from '../test-support/ui';

type Node = ReactTestRenderer.ReactTestInstance;

jest.useFakeTimers({ now: new Date(2026, 10, 18, 9, 0) });

function render(el: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(el);
  });
  return r;
}

describe('ProfileButton', () => {
  it('is a Settings button with the person icon', async () => {
    const onPress = jest.fn();
    const r = render(<ProfileButton onPress={onPress} />);
    const button = r.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Settings')[0];
    expect(button.findAll((n) => typeof n.props.name === 'string')[0].props.name).toBe('person-circle-outline');
    await tap(r.root, 'Settings');
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SyncButton', () => {
  it('as an icon has no text and no background, and says what it does to a screen reader', async () => {
    const onSync = jest.fn();
    const onConnect = jest.fn();
    const r = render(<SyncButton variant="icon" busy={false} connected onSync={onSync} onConnect={onConnect} />);
    const button = () => r.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')[0];
    expect(texts(r.root)).toEqual([]);
    expect(button().props.accessibilityLabel).toBe('Sync');
    expect(styleOf(button()).backgroundColor).toBeUndefined();
    expect(button().findAll((n) => n.props.name === 'sync')).not.toHaveLength(0);
    await tap(r.root, 'Sync');
    expect(onSync).toHaveBeenCalledTimes(1);

    act(() => r.update(<SyncButton variant="icon" busy connected onSync={onSync} onConnect={onConnect} />));
    expect(texts(r.root)).toEqual([]);
    expect(button().props.accessibilityLabel).toBe('Syncing…');
    expect(button().props.accessibilityState).toEqual({ disabled: true, busy: true });

    act(() => r.update(<SyncButton variant="icon" busy={false} connected={false} onSync={onSync} onConnect={onConnect} />));
    expect(texts(r.root)).toEqual([]);
    await tap(r.root, 'Connect Canvas');
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('syncs, shows busy, and connects', async () => {
    const onSync = jest.fn();
    const onConnect = jest.fn();
    const r = render(<SyncButton variant="soft" busy={false} connected onSync={onSync} onConnect={onConnect} />);
    await press(r.root, 'Sync');
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onConnect).not.toHaveBeenCalled();

    act(() => r.update(<SyncButton variant="soft" busy connected onSync={onSync} onConnect={onConnect} />));
    expect(texts(r.root)).toContain('Syncing…');

    act(() => r.update(<SyncButton variant="soft" busy={false} connected={false} onSync={onSync} onConnect={onConnect} />));
    await press(r.root, 'Connect Canvas');
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});

describe('SegmentedControl', () => {
  it('reports the chosen value', async () => {
    const onChange = jest.fn();
    const r = render(
      <SegmentedControl
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
        ]}
        value="day"
        onChange={onChange}
      />,
    );
    await press(r.root, 'Week');
    expect(onChange).toHaveBeenCalledWith('week');
  });
});

describe('DayStrip', () => {
  it('shows Monday to Sunday, marks today and dots only marked days', async () => {
    const onDay = jest.fn();
    const today = new Date(2026, 10, 18); // Wednesday
    const r = render(
      <DayStrip weekOf={new Date(2026, 10, 19)} today={today} marks={{ '2026-11-20': '#6D5BD0' }} onDay={onDay} />,
    );
    expect(texts(r.root).filter((t) => /^[A-Z]/.test(t))).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(texts(r.root).filter((t) => /^\d+$/.test(t))).toEqual(['16', '17', '18', '19', '20', '21', '22']);
    const days = r.root.findAll((n) => n.props.testID?.startsWith('day-') && typeof n.props.onPress === 'function');
    expect(days).toHaveLength(7);
    expect(days.filter((d) => d.props.accessibilityState?.selected).map((d) => d.props.testID)).toEqual(['day-2026-11-18']);
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID?.startsWith('dot-')).map((n) => n.props.testID)).toEqual(['dot-2026-11-20']);
    await press(r.root, '19');
    expect(onDay).toHaveBeenCalledTimes(1);
    expect(onDay.mock.calls[0][0].getDate()).toBe(19);
    expect(onDay.mock.calls[0][0].getMonth()).toBe(10);
  });
});

describe('Stepper', () => {
  it('disables its ends', async () => {
    const onMinus = jest.fn();
    const onPlus = jest.fn();
    const r = render(
      <Stepper value="30 min" label="Session length" onMinus={onMinus} onPlus={onPlus} minusDisabled />,
    );
    expect(texts(r.root)).toContain('30 min');
    const minus = r.root.findAll((n) => n.props.accessibilityLabel === 'Session length, less')[0];
    const plus = r.root.findAll((n) => n.props.accessibilityLabel === 'Session length, more')[0];
    expect(minus.props.accessibilityState.disabled).toBe(true);
    expect(plus.props.accessibilityState.disabled).toBe(false);
    await act(async () => plus.props.onPress());
    expect(onPlus).toHaveBeenCalledTimes(1);
  });
});

describe('DateTimeField', () => {
  it('opens the picker and returns an ISO string', async () => {
    const onChange = jest.fn();
    const r = render(<DateTimeField label="Due" value={null} mode="datetime" onChange={onChange} />);
    expect(texts(r.root)).toContain('No date');
    expect(r.root.findAllByType('DateTimePicker' as never)).toHaveLength(0);
    await act(async () => r.root.findAll((n) => n.props.accessibilityLabel === 'Due')[0].props.onPress());
    const picker = r.root.findAllByType('DateTimePicker' as never)[0];
    expect(picker).toBeTruthy();
    const date = new Date(2026, 10, 20, 14, 30);
    await act(async () => picker.props.onChange({ type: 'set' }, date));
    expect(onChange).toHaveBeenCalledWith(date.toISOString());
  });

  it('shows the value and clears to null with Clear when allowed', async () => {
    const onChange = jest.fn();
    const iso = new Date(2026, 10, 20, 14, 30).toISOString();
    const r = render(<DateTimeField label="Due" value={iso} mode="datetime" onChange={onChange} allowClear />);
    expect(texts(r.root).join(' ')).toContain('Fri 20 Nov');
    expect(texts(r.root).join(' ')).toContain('14:30');
    expect(texts(r.root)).not.toContain('No date');
    await tap(r.root, 'Clear');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('labels its clear button apart from the empty text', async () => {
    const onChange = jest.fn();
    const iso = new Date(2026, 10, 20, 14, 30).toISOString();
    const field = (value: string | null) => (
      <DateTimeField
        label="Due"
        value={value}
        mode="datetime"
        onChange={onChange}
        allowClear
        clearLabel="Add date"
        clearButtonLabel="Remove date"
      />
    );
    const r = render(field(iso));
    expect(texts(r.root)).toContain('Remove date');
    expect(texts(r.root)).not.toContain('Add date');
    await tap(r.root, 'Remove date');
    expect(onChange).toHaveBeenCalledWith(null);

    act(() => r.update(field(null)));
    expect(texts(r.root)).toContain('Add date');
    expect(texts(r.root)).not.toContain('Remove date');
  });

  it('has no clear button without allowClear', () => {
    const iso = new Date(2026, 10, 20, 14, 30).toISOString();
    const r = render(<DateTimeField label="Due" value={iso} mode="date" onChange={jest.fn()} />);
    expect(texts(r.root)).not.toContain('No date');
  });
});

describe('Toast', () => {
  function Trigger({ onAction }: { onAction: () => void }) {
    const toast = useToast();
    return (
      <Text onPress={() => toast.show('Marked done', { label: 'Undo', onPress: onAction })}>go</Text>
    );
  }

  it('shows the message and action; the action runs and hides it', async () => {
    const onAction = jest.fn();
    const r = render(
      <ToastProvider>
        <Trigger onAction={onAction} />
      </ToastProvider>,
    );
    await press(r.root, 'go');
    expect(texts(r.root)).toContain('Marked done');
    await press(r.root, 'Undo');
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(texts(r.root)).not.toContain('Marked done');
  });

  it('sits above the + button, the tab bar and the home indicator, and is announced', async () => {
    const announce = AccessibilityInfo.announceForAccessibility as jest.Mock;
    announce.mockClear();
    const insets = { top: 47, bottom: 34, left: 0, right: 0 };
    const r = render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets }}>
        <ToastProvider>
          <Trigger onAction={jest.fn()} />
        </ToastProvider>
      </SafeAreaProvider>,
    );
    await press(r.root, 'go');

    const toast = r.root.find((n) => n.props.testID === 'toast' && typeof n.type === 'string');
    const bottom = Number(StyleSheet.flatten(toast.props.style).bottom);
    expect(bottom).toBeGreaterThanOrEqual(ADD_BUTTON_CLEARANCE + insets.bottom);
    expect(announce).toHaveBeenCalledWith('Marked done');
  });

  it('hides after 4 seconds', async () => {
    const r = render(
      <ToastProvider>
        <Trigger onAction={jest.fn()} />
      </ToastProvider>,
    );
    await press(r.root, 'go');
    act(() => {
      jest.advanceTimersByTime(3900);
    });
    expect(texts(r.root)).toContain('Marked done');
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(texts(r.root)).not.toContain('Marked done');
  });
});

describe('ErrorBanner', () => {
  it('shows Try again only with onRetry', async () => {
    const onRetry = jest.fn();
    const r = render(<ErrorBanner message="Offline" />);
    expect(texts(r.root)).toContain('Offline');
    expect(texts(r.root)).not.toContain('Try again');
    act(() => r.update(<ErrorBanner message="Offline" onRetry={onRetry} />));
    expect(isDisabled(r.root, 'Try again')).toBe(false);
    await press(r.root, 'Try again');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('touch feedback', () => {
  /** The pressable on screen labelled `label`, or holding the text `label`. */
  function pressable(root: Node, label: string): Node {
    const found = root.findAll(
      (n) =>
        typeof n.props.onPress === 'function' &&
        typeof n.props.style === 'function' &&
        (n.props.accessibilityLabel === label || texts(n).includes(label)),
    );
    if (!found[0]) throw new Error(`No pressable "${label}" with a pressed style`);
    return found[0];
  }

  const c = lightColors;
  it.each([
    ['a primary button', <Button title="Go" onPress={jest.fn()} />, 'Go', c.accent, c.accentPressed],
    ['a secondary button', <Button title="Go" variant="secondary" onPress={jest.fn()} />, 'Go', c.bg, c.bg2],
    ['a danger button', <Button title="Go" variant="danger" onPress={jest.fn()} />, 'Go', c.dangerTint, c.dangerPressed],
    ['a plain button', <Button title="Go" variant="plain" onPress={jest.fn()} />, 'Go', 'transparent', c.line],
    ['a list row', <ListRow title="Row" onPress={jest.fn()} />, 'Row', undefined, c.bg2],
    ['a card', <Card onPress={jest.fn()}><Text>Card</Text></Card>, 'Card', c.bg, c.bg2],
    ['an icon button', <IconButton icon="add" label="Add one" onPress={jest.fn()} />, 'Add one', undefined, c.accentTint],
    ['a soft icon button', <IconButton icon="add" label="Add one" tone="soft" onPress={jest.fn()} />, 'Add one', c.accentTint, c.line],
    ['a check circle', <CheckCircle checked={false} label="Tick" onPress={jest.fn()} />, 'Tick', undefined, c.bg2],
    [
      'a segment',
      <SegmentedControl options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} value="a" onChange={jest.fn()} />,
      'B',
      undefined,
      c.line,
    ],
    ['the header Sync button', <SyncButton variant="icon" busy={false} connected onSync={jest.fn()} onConnect={jest.fn()} />, 'Sync', undefined, c.accentTint],
    [
      'the soft Sync button',
      <SyncButton variant="soft" busy={false} connected onSync={jest.fn()} onConnect={jest.fn()} />,
      'Sync',
      c.accentTint,
      c.line,
    ],
    ['the + button', <AddButton onPress={jest.fn()} />, 'Add', c.accent, c.accentPressed],
  ])('%s darkens its background while pressed, and ripples on Android', (_name, element, label, idle, pressed) => {
    const r = render(element);
    const node = pressable(r.root, label);
    expect(styleOf(node).backgroundColor).toBe(idle);
    expect(styleOf(node, true).backgroundColor).toBe(pressed);
    expect(node.props.android_ripple).toEqual(expect.objectContaining({ color: expect.any(String) }));
  });

  it('a check circle shows the new state at once, and goes back to what it is told when the change is over', async () => {
    let finish!: () => void;
    const onPress = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const r = render(<CheckCircle checked={false} label="Tick" onPress={onPress} />);
    const box = () => r.root.findAll((n) => n.props.accessibilityLabel === 'Tick' && typeof n.props.onPress === 'function')[0];

    await act(async () => {
      box().props.onPress();
    });
    expect(box().props.accessibilityState.checked).toBe(true);
    await act(async () => finish()); // the change failed: the parent still says not checked
    expect(box().props.accessibilityState.checked).toBe(false);
  });
});
