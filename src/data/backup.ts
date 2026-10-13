/**
 * Резервная копия: сборка файла, проверка и восстановление (0.6.29).
 *
 * Ответ владельцу 07.10.2026: «если есть экспорт, то нужен и импорт». Файл копии —
 * независимый от GitHub канал: он нужен, если семейный репозиторий или аккаунт
 * окажутся недоступны, если нужно перенести данные на новый телефон, и как снимок
 * «как было раньше» (синхронизация повторяет текущее состояние, а копия — прошлое).
 *
 * Правила восстановления — безопасные, без потери данных:
 *  - ничего не удаляется и не «обнуляется»;
 *  - чего на устройстве нет — добавляется;
 *  - что уже есть — остаётся более новая версия (по `rev`, при равенстве — по `updatedAt`);
 *  - поэтому старая копия не «воскрешает» то, что семья удалила позже (у удалённого
 *    `deletedAt` и больший `rev` — старое просто проигрывает).
 *
 * После восстановления обычная синхронизация сама отправит добавленное в семейное
 * хранилище: base-снимок не трогаем, значит новые `rev` попадают в очередь отправки.
 */
import { db } from './db';
import { SCHEMA_VERSION } from '../domain/types';
import type {
  ActivityEntry,
  Deadline,
  Member,
  ShoppingItem,
  Syncable,
  Task,
} from '../domain/types';

export const BACKUP_APP = 'family-hub';
export const BACKUP_FORMAT = 'family-hub-backup';

export interface BackupPayload {
  app: string;
  format: string;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  data: {
    shopping: ShoppingItem[];
    tasks: Task[];
    deadlines: Deadline[];
    members: Member[];
    activity: ActivityEntry[];
  };
}

/** Сборка файла копии из локальной базы (то, что скачивает «Экспорт резервной копии»). */
export async function buildBackup(appVersion: string): Promise<BackupPayload> {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    data: {
      shopping: await db.shopping.toArray(),
      tasks: await db.tasks.toArray(),
      deadlines: await db.deadlines.toArray(),
      members: await db.members.toArray(),
      activity: await db.activity.toArray(),
    },
  };
}

export type ParseResult =
  | { ok: true; payload: BackupPayload }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Минимальная проверка синхронизируемой записи: без неё восстанавливать нечего. */
function isSyncableLike(v: unknown): v is Syncable {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.rev === 'number' &&
    Number.isFinite(v.rev) &&
    (v.updatedAt === undefined || typeof v.updatedAt === 'string')
  );
}

function isActivityLike(v: unknown): v is ActivityEntry {
  if (!isRecord(v)) return false;
  return typeof v.id === 'string' && v.id.length > 0 && typeof v.at === 'string';
}

/**
 * Проверка выбранного файла. Тексты — простые и конкретные: человек должен понять,
 * что именно не так, а не «ошибка импорта».
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл не читается — он повреждён или это не резервная копия.' };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: 'Это не резервная копия Family Hub.' };
  }
  if (raw.app !== BACKUP_APP || raw.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'Это не резервная копия Family Hub — выберите другой файл.' };
  }
  if (typeof raw.schemaVersion !== 'number' || !Number.isFinite(raw.schemaVersion)) {
    return { ok: false, error: 'В копии не указана версия схемы — файл неполный.' };
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `Копия сделана более новой версией приложения (схема v${raw.schemaVersion}). ` +
        'Обновите приложение и попробуйте снова.',
    };
  }
  if (!isRecord(raw.data)) {
    return { ok: false, error: 'В копии нет данных — файл неполный.' };
  }

  const sections = ['shopping', 'tasks', 'deadlines', 'members', 'activity'] as const;
  for (const key of sections) {
    const value = raw.data[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      return { ok: false, error: 'Копия повреждена: один из разделов данных непонятного вида.' };
    }
  }

  const data = raw.data;
  return {
    ok: true,
    payload: {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      schemaVersion: raw.schemaVersion,
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '—',
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      data: {
        shopping: (data.shopping as ShoppingItem[] | undefined) ?? [],
        tasks: (data.tasks as Task[] | undefined) ?? [],
        deadlines: (data.deadlines as Deadline[] | undefined) ?? [],
        members: (data.members as Member[] | undefined) ?? [],
        activity: (data.activity as ActivityEntry[] | undefined) ?? [],
      },
    },
  };
}

export interface KindRestore<T> {
  adds: T[];
  updates: T[];
  skipped: number;
}

export interface ActivityRestore {
  adds: ActivityEntry[];
  skipped: number;
}

export interface RestorePlan {
  shopping: KindRestore<ShoppingItem>;
  tasks: KindRestore<Task>;
  deadlines: KindRestore<Deadline>;
  members: KindRestore<Member>;
  activity: ActivityRestore;
  totals: { added: number; updated: number; skipped: number };
}

/** Что из файла новее того, что есть на устройстве. */
export function isNewerThan(file: Syncable, local: Syncable): boolean {
  if (file.rev !== local.rev) return file.rev > local.rev;
  return (file.updatedAt ?? '') > (local.updatedAt ?? '');
}

function planKind<T extends Syncable>(fileRows: unknown, local: Record<string, T>): KindRestore<T> {
  const rows = Array.isArray(fileRows) ? fileRows : [];
  const adds: T[] = [];
  const updates: T[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!isSyncableLike(row)) {
      skipped += 1;
      continue;
    }
    const entity = row as T;
    const current = local[entity.id];
    if (!current) adds.push(entity);
    else if (isNewerThan(entity, current)) updates.push(entity);
    else skipped += 1;
  }
  return { adds, updates, skipped };
}

/**
 * План восстановления: считается ДО записи, чтобы показать человеку, что произойдёт,
 * и ничего не менять без подтверждения.
 */
export async function planRestore(payload: BackupPayload): Promise<RestorePlan> {
  const [shopping, tasks, deadlines, members] = await Promise.all([
    db.shopping.toArray(),
    db.tasks.toArray(),
    db.deadlines.toArray(),
    db.members.toArray(),
  ]);

  const byId = <T extends Syncable>(rows: T[]): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const r of rows) out[r.id] = r;
    return out;
  };

  const shoppingPlan = planKind<ShoppingItem>(payload.data.shopping, byId(shopping));
  const tasksPlan = planKind<Task>(payload.data.tasks, byId(tasks));
  const deadlinesPlan = planKind<Deadline>(payload.data.deadlines, byId(deadlines));
  const membersPlan = planKind<Member>(payload.data.members, byId(members));

  // Лента — записи без rev: восстанавливаем только отсутствующие, существующие не трогаем.
  const activityAdds: ActivityEntry[] = [];
  let activitySkipped = 0;
  const activityRows = payload.data.activity ?? [];
  for (const entry of activityRows) {
    if (!isActivityLike(entry)) {
      activitySkipped += 1;
      continue;
    }
    const exists = await db.activity.get(entry.id);
    if (exists) activitySkipped += 1;
    else activityAdds.push(entry);
  }

  const added =
    shoppingPlan.adds.length +
    tasksPlan.adds.length +
    deadlinesPlan.adds.length +
    membersPlan.adds.length +
    activityAdds.length;
  const updated =
    shoppingPlan.updates.length +
    tasksPlan.updates.length +
    deadlinesPlan.updates.length +
    membersPlan.updates.length;

  return {
    shopping: shoppingPlan,
    tasks: tasksPlan,
    deadlines: deadlinesPlan,
    members: membersPlan,
    activity: { adds: activityAdds, skipped: activitySkipped },
    totals: {
      added,
      updated,
      skipped: shoppingPlan.skipped + tasksPlan.skipped + deadlinesPlan.skipped + membersPlan.skipped + activitySkipped,
    },
  };
}

/** Запись плана в локальную базу. Одной транзакцией: либо всё, либо ничего. */
export async function applyRestore(plan: RestorePlan): Promise<void> {
  await db.transaction(
    'rw',
    [db.shopping, db.tasks, db.deadlines, db.members, db.activity],
    async () => {
      const put = async <T>(rows: T[], table: { bulkPut: (rows: T[]) => Promise<unknown> }) => {
        if (rows.length) await table.bulkPut(rows);
      };
      await put([...plan.shopping.adds, ...plan.shopping.updates], db.shopping);
      await put([...plan.tasks.adds, ...plan.tasks.updates], db.tasks);
      await put([...plan.deadlines.adds, ...plan.deadlines.updates], db.deadlines);
      await put([...plan.members.adds, ...plan.members.updates], db.members);
      await put(plan.activity.adds, db.activity);
    },
  );
}
