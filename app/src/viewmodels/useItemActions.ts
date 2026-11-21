import { useCallback, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { ItemInput, ItemStatus } from '../api/types';

/**
 * Changes to items and study blocks, shared by every screen that opens a sheet.
 * Each returns whether it worked, keeps the message when it did not, and calls `reload` afterwards
 * (also after a failure, so the screen shows what the server has now).
 */
export function useItemActions(reload: () => Promise<void>) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setError(null);
      try {
        await action();
        await reload();
        return true;
      } catch (err) {
        await reload();
        setError(friendlyMessage(err));
        return false;
      }
    },
    [reload],
  );

  return {
    error,
    /** Runs any change the same way: error handling, then a reload. */
    run,
    clearError: useCallback(() => setError(null), []),
    saveItem: (id: string | null, input: ItemInput) => run(() => (id ? api.updateItem(id, input) : api.addItem(input))),
    setStatus: (id: string, status: ItemStatus) => run(() => api.setStatus(id, status)),
    deleteItem: (id: string) => run(() => api.deleteItem(id)),
    acceptBlock: (id: string) => run(() => api.acceptBlock(id)),
    rejectBlock: (id: string) => run(() => api.rejectBlock(id)),
    moveBlock: (id: string, startsAtIso: string) => run(() => api.moveBlock(id, startsAtIso)),
    setStudyHours: (itemId: string, hours: number) => run(() => api.updateItem(itemId, { studyMinutes: hours * 60 })),
  };
}
