import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SyncStatus } from '../src/screens/SyncStatus';
import type { Sync } from '../src/viewmodels/useSync';
import { texts } from '../test-support/ui';

type Node = ReactTestRenderer.ReactTestInstance;

const NOW = new Date(2026, 10, 2, 9, 0);

function sync(fields: Partial<Sync>): Sync {
  return {
    connected: true,
    loginAvailable: false,
    linked: false,
    lastSyncedAt: new Date(2026, 10, 2, 8, 59, 40).toISOString(),
    busy: false,
    inSync: false,
    sync: jest.fn(),
    connect: jest.fn(),
    reload: jest.fn(),
    login: {} as Sync['login'],
    ...fields,
  };
}

/** The small icon in front of the text, and the style of the row that holds both. */
function lead(element: React.ReactElement): { icon: string | undefined; row: object; text: string[] } {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(element);
  });
  const icon: Node | undefined = r.root.findAll((n) => typeof n.props.name === 'string' && n.props.size === 14)[0];
  return { icon: icon?.props.name, row: StyleSheet.flatten(icon?.parent?.props.style) ?? {}, text: texts(r.root) };
}

describe('SyncStatus', () => {
  it('keeps "Syncing…" where "Canvas synced …" is: same row, an icon of the same size in front', () => {
    const synced = lead(<SyncStatus sync={sync({})} now={NOW} />);
    const syncing = lead(<SyncStatus sync={sync({ busy: true })} now={NOW} />);

    expect(synced).toMatchObject({ icon: 'checkmark-circle', text: ['Canvas synced just now'] });
    expect(syncing).toMatchObject({ icon: 'sync', text: ['Syncing…'] });
    expect(syncing.row).toEqual(synced.row);
  });
});
