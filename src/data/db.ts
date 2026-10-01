/**
 * Локальное хранилище — IndexedDB через Dexie (PROJECT.md §5).
 *
 * Принцип (§2.2): IndexedDB — кэш и очередь, GitHub — источник истины.
 * Потеря локальных данных (очистка данных сайта, переустановка iOS, политика
 * Safari — факт F6/F8) восстанавливается одной загрузкой из удалённого репозитория.
 */
import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  ActivityEntry,
  Deadline,
  Member,
  RemoteFile,
  ShoppingItem,
  Syncable,
  Task,
  EntityKind,
} from '../domain/types';
import { SCHEMA_VERSION } from '../domain/types';

/** Служебная запись: rev каждой сущности на момент последней успешной синхронизации. */
export interface SyncMetaRow {
  /** compound key `${kind}:${id}` */
  key: string;
  kind: EntityKind;
  id: string;
  rev: number;
  syncedAt: string;
}

/** Кэш условных GET (ETag) — экономит лимит запросов GitHub (факт F4). */
export interface HttpCacheRow {
  key: string;
  etag: string;
  sha: string;
  body: string;
  fetchedAt: string;
}

export interface KvRow {
  key: string;
  value: unknown;
}

/** Неразрешённые конфликты (§3, п.5): побеждённая версия, видна в Диагностике. */
export interface UnresolvedRow {
  id: string;
  key: string;
  kind: EntityKind;
  winner: 'local' | 'remote';
  reason: string;
  at: string;
  loser: Syncable;
  winnerEntity: Syncable;
}

export type ActivityRow = ActivityEntry;

class FamilyHubDB extends Dexie {
  shopping!: EntityTable<ShoppingItem, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  deadlines!: EntityTable<Deadline, 'id'>;
  members!: EntityTable<Member, 'id'>;
  syncMeta!: Table<SyncMetaRow, string>;
  httpCache!: Table<HttpCacheRow, string>;
  kv!: Table<KvRow, string>;
  unresolved!: Table<UnresolvedRow, string>;
  activity!: Table<ActivityRow, string>;

  constructor() {
    super('family-hub');
    this.version(SCHEMA_VERSION).stores({
      // Индексы: первый — первичный ключ. 'kind' и 'deletedAt' нужны для выборок и компакции.
      shopping: 'id, canonicalKey, done, horizon, updatedAt, deletedAt',
      tasks: 'id, status, dueDate, assigneeId, updatedAt, deletedAt',
      deadlines: 'id, dueDate, deadlineKind, visibility, updatedAt, deletedAt',
      members: 'id, updatedAt, deletedAt',
      syncMeta: 'key, kind',
      httpCache: 'key',
      kv: 'key',
      unresolved: 'id, kind, at',
      activity: 'id, at',
    });
  }
}

export const db = new FamilyHubDB();

/** Таблица Dexie для вида сущностей. */
export function tableFor<T extends Syncable>(kind: EntityKind): Table<T, string> {
  switch (kind) {
    case 'shopping':
      return db.shopping as unknown as Table<T, string>;
    case 'tasks':
      return db.tasks as unknown as Table<T, string>;
    case 'deadlines':
      return db.deadlines as unknown as Table<T, string>;
    case 'members':
      return db.members as unknown as Table<T, string>;
    case 'dictionary':
      // ЭТАП 5. Таблица появится вместе со словарём; сейчас — безопасный отказ.
      throw new Error('dictionary: хранилище появится на ЭТАПЕ 5');
    default: {
      const exhaustive: never = kind;
      throw new Error(`Неизвестный вид сущностей: ${String(exhaustive)}`);
    }
  }
}

export const KV_KEYS = {
  deviceId: 'device.id',
  deviceName: 'device.name',
  profileName: 'profile.name',
  profileColor: 'profile.color',
  theme: 'ui.theme',
  authPat: 'auth.pat',
  authPatSavedAt: 'auth.pat.savedAt',
  authPatExpiresAt: 'auth.pat.expiresAt',
  remoteOwner: 'remote.owner',
  remoteRepo: 'remote.repo',
  remoteBranch: 'remote.branch',
  lastSyncAt: 'sync.lastSuccessAt',
  lastSyncError: 'sync.lastError',
  notificationLevel: 'notifications.level',
} as const;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export async function kvDel(key: string): Promise<void> {
  await db.kv.delete(key);
}

/** Просим браузер не evict-ить наше хранилище. Реально работает с Safari 17+ (факт F8). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Полный снимок локального состояния одного вида сущностей. */
export async function localEntities<T extends Syncable>(kind: EntityKind): Promise<Record<string, T>> {
  const rows = await tableFor<T>(kind).toArray();
  const out: Record<string, T> = {};
  for (const r of rows) out[r.id] = r;
  return out;
}

/** Снимок base (rev на момент последней синхронизации). */
export async function baseSnapshot(kind: EntityKind): Promise<Record<string, number>> {
  const rows = await db.syncMeta.where('kind').equals(kind).toArray();
  const out: Record<string, number> = {};
  for (const r of rows) out[r.id] = r.rev;
  return out;
}

export async function writeMerged<T extends Syncable>(
  kind: EntityKind,
  merged: Record<string, T>,
  syncedAt: string,
): Promise<void> {
  const table = tableFor<T>(kind);
  await db.transaction('rw', table, db.syncMeta, async () => {
    await table.clear();
    const rows = Object.values(merged);
    if (rows.length) await table.bulkPut(rows);
    await db.syncMeta.where('kind').equals(kind).delete();
    if (rows.length) {
      await db.syncMeta.bulkPut(
        rows.map((e) => ({
          key: `${kind}:${e.id}`,
          kind,
          id: e.id,
          rev: e.rev,
          syncedAt,
        })),
      );
    }
  });
}

export type { RemoteFile };
