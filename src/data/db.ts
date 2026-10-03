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
  /** Срок из заголовка GitHub — оценка или факт; пока ключа нет, срок «неизвестен». */
  authPatExpiresIsEstimate: 'auth.pat.expiresIsEstimate',
  /** Версия, которую пользователь видел в последний раз (плашка «обновлено до …»). */
  lastSeenVersion: 'app.lastSeenVersion',
  remoteOwner: 'remote.owner',
  remoteRepo: 'remote.repo',
  remoteBranch: 'remote.branch',
  lastSyncAt: 'sync.lastSuccessAt',
  lastSyncError: 'sync.lastError',
  notificationLevel: 'notifications.level',
  /** Локальный кэш UI; источник истины для push — подписка браузера. */
  notifyPushEnabled: 'notify.channels.push',
  /** Только факт скачивания .ics, не подтверждение импорта в календарь. */
  notifyIcsDownloaded: 'notify.channels.ics',
  /** Только безопасные метаданные экспорта: количество, формат, время. */
  notifyIcsExport: 'notify.calendar.export',
  notifyCalendarAddOnSave: 'notify.calendar.addOnSave',
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
export async function localEntities<T extends Syncable>(
  kind: EntityKind,
): Promise<Record<string, T>> {
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

/**
 * Запись результата слияния. БЕЗ `table.clear()` и БЕЗ потери локальных правок:
 *
 * Дефект 0.1.4 (приёмка владельца): прежняя реализация стирала таблицу и клала
 * снимок, прочитанный ДО начала цикла синхронизации. Всё, что пользователь нажал
 * во время долгого цикла (отметил купленным, удалил), молча откатывалось —
 * «кнопка не нажимается», «информация пропадает». Теперь:
 *  - строки, изменённые локально ПОСЛЕ снимка localBefore, сохраняются (они новее
 *    и уедут в следующем цикле: base-снимок остаётся по синхронизированному rev);
 *  - строки, удалённые локально во время цикла, не воскрешаются;
 *  - точечные put/delete вместо clear(): даже авария транзакции не оставляет
 *    пустую таблицу.
 *
 * @param localBefore снимок локальных данных на момент чтения в этом цикле.
 */
export async function writeMerged<T extends Syncable>(
  kind: EntityKind,
  merged: Record<string, T>,
  syncedAt: string,
  localBefore?: Record<string, T>,
): Promise<void> {
  const table = tableFor<T>(kind);
  await db.transaction('rw', table, db.syncMeta, async () => {
    const localNow = await table.toArray();
    const final: Record<string, T> = { ...merged };
    const localNowIds = new Set<string>();
    for (const row of localNow) {
      localNowIds.add(row.id);
      const before = localBefore?.[row.id];
      const touchedDuringSync =
        !before || before.rev !== row.rev || before.updatedAt !== row.updatedAt;
      if (touchedDuringSync) final[row.id] = row;
    }
    if (localBefore) {
      for (const id of Object.keys(localBefore)) {
        // Локальное (физическое) удаление во время цикла — не воскрешать.
        if (!localNowIds.has(id)) delete final[id];
      }
    }

    const rows = Object.values(final);
    if (rows.length) await table.bulkPut(rows);
    for (const row of localNow) if (!(row.id in final)) await table.delete(row.id);

    // base-снимок = ТОЛЬКО фактически синхронизированные rev (из merged).
    // Локально более новые строки остаются с rev > base -> попадут в очередь.
    await db.syncMeta.where('kind').equals(kind).delete();
    const baseRows = Object.values(merged).map((e) => ({
      key: `${kind}:${e.id}`,
      kind,
      id: e.id,
      rev: e.rev,
      syncedAt,
    }));
    if (baseRows.length) await db.syncMeta.bulkPut(baseRows);
  });
}

export type { RemoteFile };
