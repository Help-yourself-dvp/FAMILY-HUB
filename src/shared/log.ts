/**
 * Безопасное логирование (ТЗ §31 / PROJECT.md §6.19).
 * Разрешено: структурные события синхронизации.
 * ЗАПРЕЩЕНО: содержимое покупок/дел/сроков, токены, push-подписки.
 *
 * Поэтому логгер принимает только разрешённый набор событий, а не произвольную
 * строку: ошибиться и записать приватные данные становится сложно.
 */
export type SyncLogEvent =
  | { type: 'sync:started'; kinds: string[] }
  | { type: 'sync:completed'; kinds: string[]; durationMs: number; pushed: number; pulled: number }
  | { type: 'sync:conflict'; kind: string; count: number }
  | { type: 'sync:retry'; kind: string; attempt: number; reason: 'conflict' | 'network' }
  | { type: 'sync:error'; kind: string; code: string; message: string }
  | { type: 'http'; method: string; path: string; status: number; ms: number; code?: string }
  | { type: 'auth:changed'; present: boolean }
  | { type: 'app:installed' }
  | { type: 'app:update-available' }
  | { type: 'push:step'; step: string };

const MAX_ENTRIES = 200;
const ring: Array<{ at: string; event: SyncLogEvent }> = [];
const listeners = new Set<() => void>();

/** Красный список: любые значения, похожие на токен, не попадают в лог никогда. */
function safeMessage(m: string): string {
  return m
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[^\s"]+/gi, 'Bearer [REDACTED]');
}

export const log = {
  emit(event: SyncLogEvent): void {
    const entry = { at: new Date().toISOString(), event };
    if (event.type === 'sync:error') {
      entry.event = { ...event, message: safeMessage(event.message) };
    }
    ring.push(entry);
    if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
    if (import.meta.env.DEV) {
      console.info('[family-hub]', entry.event.type, entry.event);
    }
    for (const l of listeners) l();
  },
  entries(): ReadonlyArray<{ at: string; event: SyncLogEvent }> {
    return ring;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  clear(): void {
    ring.length = 0;
    for (const l of listeners) l();
  },
};
