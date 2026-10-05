/**
 * Синхронизация: браузерная обвязка поверх чистого ядра (sync/core.ts).
 *
 * Триггеры (§2.2 / ТЗ §7):
 *   - при запуске;
 *   - при возвращении приложения на экран (visibilitychange → visible);
 *   - после локального изменения (с дебаунсом);
 *   - после восстановления соединения (online);
 *   - периодически, пока приложение активно.
 * Агрессивного polling нет: интервал по умолчанию 60 с и настраивается.
 *
 * Дебаунс записи (§2.2): не чаще одного коммита в DEBOUNCE_MS на устройство —
 * защита от abuse-лимитов GitHub и от перерасхода минут Actions (факт F3).
 */
import { baseSnapshot, db, httpCacheRowKey, localEntities, writeMerged } from './localStore';
import { GitHubRemoteStore } from './remoteStore';
import {
  ConflictError,
  syncKind,
  type LocalStorePort,
  type RemoteStorePort,
  type SyncKindsResult,
} from './core';
export type { LocalStorePort, RemoteStorePort } from './core';
import { setSyncState } from './state';
import { log } from '../../shared/log';
import { wakePushSender } from '../remote/wake';
import { appendActivity, placeLabel } from '../repositories';
import type { EntityKind, Syncable } from '../../domain/types';
import { ENTITY_KINDS } from '../../domain/types';

/** Какие виды сущностей синхронизируются в семейное хранилище. */
export const ACTIVE_SYNC_KINDS: EntityKind[] = ['shopping', 'members', 'deadlines', 'tasks'];

/** Задержка перед коммитом после локального изменения. */
export const DEBOUNCE_MS = 2000;
/** Периодическая синхронизация, пока приложение на экране. */
export const PERIODIC_MS = 60_000;

type Outcome = { kind: EntityKind; ok: SyncKindsResult | null; err: unknown };

let localPort: LocalStorePort | null = null;
let remotePort: RemoteStorePort | null = null;
let running = false;
let queued = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;

export function setPorts(local: LocalStorePort, remote: RemoteStorePort | null): void {
  localPort = local;
  remotePort = remote;
}

export function createPorts(
  getToken: () => Promise<string | null>,
  cfg: {
    owner: string;
    repo: string;
    branch: string;
  },
): { local: LocalStorePort; remote: RemoteStorePort } {
  return {
    local: {
      read: <T extends Syncable>(kind: EntityKind) => localEntities<T>(kind),
      readBase: (kind: EntityKind) => baseSnapshot(kind),
      write: <T extends Syncable>(
        kind: EntityKind,
        merged: Record<string, T>,
        at: string,
        localBefore?: Record<string, T>,
      ) => writeMerged<T>(kind, merged, at, localBefore),
    },
    remote: new GitHubRemoteStore(cfg, getToken),
  };
}

export async function countPending(): Promise<number> {
  let n = 0;
  for (const kind of ACTIVE_SYNC_KINDS) {
    const local = await localEntities<Syncable>(kind);
    const base = await baseSnapshot(kind);
    for (const [id, e] of Object.entries(local)) if (e.rev > (base[id] ?? 0)) n += 1;
  }
  return n;
}

export async function refreshPending(): Promise<void> {
  setSyncState({ pendingCount: await countPending() });
}

/** Основной цикл. Повторный вызов во время работы не плодит параллельные запросы. */
/** @param _reason человекочитаемая причина запуска: полезна при чтении кода, в лог не пишется (§6.19). */
export async function syncNow(_reason: string): Promise<void> {
  if (running) {
    queued = true;
    return;
  }
  if (!localPort || !remotePort) {
    setSyncState({ phase: 'not-configured', configured: false });
    return;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setSyncState({ phase: 'offline', online: false });
    return;
  }

  running = true;
  const startedAt = Date.now();
  // Приёмка 0.1.5: после блокировки экрана цикл мог оставить running=true навсегда
  // (исключение в хвосте цикла) — все следующие синхронизации молча пропускались,
  // «Синхронизация…» не заканчивалась до перезапуска. Теперь finally гарантирован.
  try {
    const kinds = [...ACTIVE_SYNC_KINDS];
    log.emit({ type: 'sync:started', kinds });
    setSyncState({ phase: 'syncing', online: true, configured: true });

    let pushed = 0;
    let pulled = 0;
    let conflicts = 0;
    let failure: { code: string; message: string } | null = null;

    // Виды независимы (отдельные файлы в репозитории) - идём параллельно: меньше
    // худшее время цикла и уже окно, в котором пользователь ждёт.
    const outcomes = await Promise.all(
      kinds.map(async (kind): Promise<Outcome> => {
        try {
          const r = await syncKind<Syncable>(
            kind,
            localPort as LocalStorePort,
            remotePort as RemoteStorePort,
            {
              nowIso: () => new Date().toISOString(),
              onRetry: (k, attempt) =>
                log.emit({ type: 'sync:retry', kind: k, attempt, reason: 'conflict' }),
              onConflict: (k, count) => log.emit({ type: 'sync:conflict', kind: k, count }),
            },
          );
          return { kind, ok: r, err: null };
        } catch (e) {
          return { kind, ok: null, err: e };
        }
      }),
    );
    for (const o of outcomes) {
      if (o.ok) {
        pushed += o.ok.pushed;
        pulled += o.ok.pulled;
        conflicts += o.ok.conflicts;
        // Семейная лента на принимающем устройстве (приёмка 0.1.7): чужие изменения
        // видны как события с именем автора, а не применяются молча.
        for (const ev of o.ok.remoteEvents) {
          // Профили (members) — служебный вид: события «изменён профиль» в семейной
          // ленте не нужны (приёмка 0.1.8: лента забивалась строками с dev-id).
          if (o.kind === 'members') continue;
          // «Изменено» без человекочитаемых правок (служебные rev/updatedBy) ленту
          // не пополняет: иначе технические циклы затапливали её (приёмка 0.1.9).
          if (ev.action === 'updated' && !ev.meaningful) continue;
          const member = await db.members.get(ev.actorId);
          void appendActivity(
            ev.action,
            ev.title,
            { id: ev.actorId, name: member?.name || 'Семья' },
            { kind: o.kind, place: placeLabel(o.kind, ev.category) },
          );
        }
      } else if (!failure) {
        const e = o.err;
        const code = e instanceof ConflictError ? 'conflict' : errorCode(e);
        const message = e instanceof Error ? e.message : String(e);
        failure = { code, message };
        log.emit({ type: 'sync:error', kind: o.kind, code, message });
      }
    }

    const durationMs = Date.now() - startedAt;
    setSyncState({
      phase: failure ? 'error' : 'synced',
      lastSuccessAt: failure ? undefined : new Date().toISOString(),
      lastError: failure ? { ...failure, at: new Date().toISOString() } : null,
      lastDurationMs: durationMs,
      lastPushed: pushed,
      lastPulled: pulled,
      lastConflicts: conflicts,
      pendingCount: await countPending(),
      rateRemaining: (remotePort as GitHubRemoteStore).rateRemaining ?? undefined,
    });

    log.emit({ type: 'sync:completed', kinds, durationMs, pushed, pulled });
    if (pushed > 0) {
      // Это устройство что-то изменило — просим GitHub запустить отправку сейчас, не
      // дожидаясь расписания (оно может молчать часами). Не ждём ответа: синхронизация
      // важнее, а «будильник» сам ограничен одной просьбой в минуту.
      void wakePushSender('push');
    }
  } catch (e) {
    const code = 'internal';
    const message = e instanceof Error ? e.message : String(e);
    log.emit({ type: 'sync:error', kind: 'internal', code, message });
    setSyncState({
      phase: 'error',
      lastError: { code, message, at: new Date().toISOString() },
      lastDurationMs: Date.now() - startedAt,
      pendingCount: await countPending(),
    });
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void syncNow('queued');
    }
  }
}

function errorCode(e: unknown): string {
  const anyErr = e as { code?: string; status?: number; name?: string };
  return anyErr?.code ?? (anyErr?.status ? `http-${anyErr.status}` : (anyErr?.name ?? 'unknown'));
}

/** Локальное изменение → отложенная синхронизация. */
export function notifyLocalChange(): void {
  void refreshPending();
  if (!remotePort) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncNow('local-change');
  }, DEBOUNCE_MS);
}

/** Немедленный flush: уход в фон, закрытие вкладки. */
export function flushNow(reason: string): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (!remotePort) return;
  // keepalive-запросы здесь не используем: GitHub PUT не идемпотентен,
  // безопаснее дождаться следующего запуска приложения.
  void syncNow(reason);
}

export function startAutoSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow('foreground');
  };
  const onOnline = () => {
    setSyncState({ online: true });
    void syncNow('online');
  };
  const onOffline = () => setSyncState({ online: false, phase: 'offline' });
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushNow('background');
  };

  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('pagehide', () => flushNow('pagehide'));

  periodicTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow('periodic');
  }, PERIODIC_MS);

  void syncNow('startup');

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    if (periodicTimer) clearInterval(periodicTimer);
    periodicTimer = null;
  };
}

export { ENTITY_KINDS, db, httpCacheRowKey };
