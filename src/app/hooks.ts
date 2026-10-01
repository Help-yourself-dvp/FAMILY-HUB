import { useSyncExternalStore } from 'react';
import { getSyncState, subscribeSync, type SyncState } from '../data/sync/state';
import { log, type SyncLogEvent } from '../shared/log';

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
}

export function useSyncLog(): ReadonlyArray<{ at: string; event: SyncLogEvent }> {
  return useSyncExternalStore(
    (cb) => log.subscribe(cb),
    () => log.entries(),
    () => log.entries(),
  );
}
