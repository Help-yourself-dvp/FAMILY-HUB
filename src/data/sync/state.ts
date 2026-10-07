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

/**
 * Простые формулировки состояния (просьба владельца 07.10.2026: без терминов).
 * «Все изменения сохранены» — когда отправлять нечего; «Отправляем: N» — когда есть
 * очередь; «Нет подключения» — вместо «Офлайн»; «Хранилище не подключено» — вместо
 * «Локальный режим».
 */
export const PHASE_LABEL: Record<SyncPhase, string> = {
  idle: 'Ждём отправки',
  offline: 'Нет подключения',
  syncing: 'Отправляем…',
  synced: 'Все изменения сохранены',
  error: 'Не удалось отправить',
  'not-configured': 'Хранилище не подключено',
};

/**
 * Короткие подписи для верхней плашки (07.10.2026): длинная фраза
 * «Все изменения сохранены» выдавливала название раздела из верхней строки.
 * Подробное объяснение по-прежнему в нижней строке Главной и в Настройках.
 */
export const PHASE_LABEL_SHORT: Record<SyncPhase, string> = {
  idle: 'Ждём отправки',
  offline: 'Нет сети',
  syncing: 'Отправляем…',
  synced: 'Сохранено',
  error: 'Ошибка',
  'not-configured': 'Не подключено',
};

export const PHASE_TONE: Record<SyncPhase, 'ok' | 'warn' | 'err' | 'muted'> = {
  idle: 'muted',
  offline: 'warn',
  syncing: 'muted',
  synced: 'ok',
  error: 'err',
  'not-configured': 'muted',
};

/**
 * Подпись состояния для человека, с числом, если оно есть: «Отправляем: 3»,
 * «Ждём отправки: 2». Без числа — просто «Отправляем…» / «Ждём отправки».
 */
/** Короткая подпись плашки: с числом, если оно есть («Отправляем: 3»). */
export function pillLabel(phase: SyncPhase, pendingCount = 0): string {
  const base = PHASE_LABEL_SHORT[phase];
  if (pendingCount <= 0) return base;
  if (phase === 'syncing') return `Отправляем: ${pendingCount}`;
  if (phase === 'idle') return `Ждём: ${pendingCount}`;
  return base;
}

export function phaseLabel(phase: SyncPhase, pendingCount = 0): string {
  const base = PHASE_LABEL[phase];
  if (pendingCount <= 0) return base;
  if (phase === 'syncing') return `Отправляем: ${pendingCount}`;
  if (phase === 'idle') return `Ждём отправки: ${pendingCount}`;
  return base;
}
