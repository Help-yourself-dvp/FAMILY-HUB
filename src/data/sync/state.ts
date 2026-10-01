/**
 * Состояние синхронизации, обязательное в UI (ТЗ §6):
 * online · offline · syncing · synced · sync error.
 * Плюс «последняя успешная» и «есть неотправленные изменения».
 */
export type SyncPhase = 'idle' | 'offline' | 'syncing' | 'synced' | 'error' | 'not-configured';

export interface SyncState {
  phase: SyncPhase;
  lastSuccessAt: string | null;
  lastError: { code: string; message: string; at: string } | null;
  pendingCount: number;
  lastDurationMs: number | null;
  configured: boolean;
  online: boolean;
  lastPushed: number;
  lastPulled: number;
  lastConflicts: number;
  rateRemaining: number | null;
}

export const INITIAL_SYNC_STATE: SyncState = {
  phase: 'idle',
  lastSuccessAt: null,
  lastError: null,
  pendingCount: 0,
  lastDurationMs: null,
  configured: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastPushed: 0,
  lastPulled: 0,
  lastConflicts: 0,
  rateRemaining: null,
};

type Listener = () => void;

let state: SyncState = { ...INITIAL_SYNC_STATE };
const listeners = new Set<Listener>();

export function getSyncState(): SyncState {
  return state;
}

export function setSyncState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const PHASE_LABEL: Record<SyncPhase, string> = {
  idle: 'Не синхронизировано',
  offline: 'Нет сети',
  syncing: 'Синхронизация…',
  synced: 'Сохранено',
  error: 'Ошибка синхронизации',
  'not-configured': 'Локальный режим',
};

export const PHASE_TONE: Record<SyncPhase, 'ok' | 'warn' | 'err' | 'muted'> = {
  idle: 'muted',
  offline: 'warn',
  syncing: 'muted',
  synced: 'ok',
  error: 'err',
  'not-configured': 'muted',
};
