/**
 * Ядро синхронизации — ЧИСТАЯ логика без браузера, Dexie и fetch.
 * Отдельный модуль нужен, чтобы алгоритм можно было покрыть тестами на фальшивых
 * хранилищах (ТЗ §32: merge/conflict resolution — критичная логика).
 *
 * Один цикл на один вид сущностей:
 *   1. прочитать remote (файл + sha)
 *   2. 3-way merge (base / local / remote)
 *   3. если merged отличается от remote — записать с sha
 *   4. на 409 Conflict — перечитать, пересчитать merge, повторить (до N раз)
 *   5. применить merged локально и обновить base-снимок
 */
import { mergeEntities, nextBaseSnapshot, type EntityMap } from '../../domain/merge';
import type { EntityKind, RemoteFile, Syncable } from '../../domain/types';
import { SCHEMA_VERSION, emptyRemoteFile } from '../../domain/types';

export interface LocalStorePort {
  read<T extends Syncable>(kind: EntityKind): Promise<EntityMap<T>>;
  readBase(kind: EntityKind): Promise<Record<string, number>>;
  write<T extends Syncable>(
    kind: EntityKind,
    merged: EntityMap<T>,
    syncedAt: string,
  ): Promise<void>;
}

export interface RemoteStorePort {
  read<T extends Syncable>(kind: EntityKind): Promise<{ file: RemoteFile<T>; sha: string | null }>;
  /** Бросает ConflictError при рассогласовании sha. */
  write<T extends Syncable>(
    kind: EntityKind,
    file: RemoteFile<T>,
    sha: string | null,
  ): Promise<string>;
}

export class ConflictError extends Error {
  constructor(message = 'sha mismatch') {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface SyncKindsResult {
  kind: EntityKind;
  pushed: number;
  pulled: number;
  conflicts: number;
  attempts: number;
  remoteChanged: boolean;
}

export interface SyncCoreDeps {
  nowIso(): string;
  maxAttempts?: number;
  onRetry?(kind: EntityKind, attempt: number): void;
  onConflict?(kind: EntityKind, count: number): void;
}

export const DEFAULT_MAX_ATTEMPTS = 3;

/** Синхронизация одного вида сущностей. Возвращает статистику для UI и логов. */
export async function syncKind<T extends Syncable>(
  kind: EntityKind,
  local: LocalStorePort,
  remote: RemoteStorePort,
  deps: SyncCoreDeps,
): Promise<SyncKindsResult> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      return await attemptSync<T>(kind, local, remote, deps, attempts);
    } catch (e) {
      if (e instanceof ConflictError && attempts < maxAttempts) {
        deps.onRetry?.(kind, attempts);
        // Небольшая экспоненциальная пауза: второе устройство может ещё писать.
        await sleep(200 * 2 ** (attempts - 1));
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  // Сюда попадаем, только если исчерпали попытки на конфликтах.
  if (lastError instanceof Error) throw lastError;
  throw new ConflictError(`не удалось синхронизировать ${kind} за ${maxAttempts} попытки`);
}

async function attemptSync<T extends Syncable>(
  kind: EntityKind,
  local: LocalStorePort,
  remote: RemoteStorePort,
  deps: SyncCoreDeps,
  attempt: number,
): Promise<SyncKindsResult> {
  const now = deps.nowIso();
  const localMap = await local.read<T>(kind);
  const base = await local.readBase(kind);
  const { file: remoteFile, sha } = await remote.read<T>(kind);

  const outcome = mergeEntities<T>(base, localMap, remoteFile.entities, kind, now);
  if (outcome.conflicts.length > 0) deps.onConflict?.(kind, outcome.conflicts.length);

  // Сравниваем merged с remote: если совпадает — писать нечего (экономим commit и минуты Actions).
  const remoteNeedsUpdate = !sameEntities<T>(outcome.merged, remoteFile.entities);

  let fileRev = remoteFile.fileRev;
  if (remoteNeedsUpdate) {
    fileRev += 1;
    const next: RemoteFile<T> = {
      schemaVersion: SCHEMA_VERSION,
      fileRev,
      updatedAt: now,
      entities: outcome.merged,
    };
    await remote.write<T>(kind, next, sha);
  }

  await local.write<T>(kind, outcome.merged, now);
  void nextBaseSnapshot; // base-снимок сохраняется внутри local.write

  return {
    kind,
    pushed: outcome.localWins.length,
    pulled: outcome.remoteWins.length,
    conflicts: outcome.conflicts.length,
    attempts: attempt,
    remoteChanged: remoteNeedsUpdate,
  };
}

function sameEntities<T extends Syncable>(a: EntityMap<T>, b: EntityMap<T>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const ea = a[k];
    const eb = b[k];
    if (!ea || !eb) return false;
    if (ea.rev !== eb.rev) return false;
    if (ea.updatedAt !== eb.updatedAt) return false;
    if (ea.updatedBy !== eb.updatedBy) return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { emptyRemoteFile };
