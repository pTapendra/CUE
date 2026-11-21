import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  DateTimeField,
  DayStrip,
  ErrorBanner,
  SegmentedControl,
  Stepper,
  SyncButton,
  ToastProvider,
  useToast,
} from '../src/ui/kit';
import { isDisabled, press, texts } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 18, 9, 0) });

function render(el: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(el);
  });
  return r;
}

describe('SyncButton', () => {
  it('syncs, shows busy, and connects', async () => {
    const onSync = jest.fn();
    const onConnect = jest.fn();
    const r = render(<SyncButton busy={false} connected onSync={onSync} onConnect={onConnect} />);
    await press(r.root, 'Sync');
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onConnect).not.toHaveBeenCalled();

    act(() => r.update(<SyncButton busy connected onSync={onSync} onConnect={onConnect} />));
    expect(texts(r.root)).toContain('Syncing…');

    act(() => r.update(<SyncButton busy={false} connected={false} onSync={onSync} onConnect={onConnect} />));
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

  it('shows the value and clears to null when allowed', async () => {
    const onChange = jest.fn();
    const iso = new Date(2026, 10, 20, 14, 30).toISOString();
    const r = render(<DateTimeField label="Due" value={iso} mode="datetime" onChange={onChange} allowClear />);
    expect(texts(r.root).join(' ')).toContain('Fri 20 Nov');
    expect(texts(r.root).join(' ')).toContain('14:30');
    await press(r.root, 'No date');
    expect(onChange).toHaveBeenCalledWith(null);
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
