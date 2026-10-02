/**
 * Entity-level 3-way merge — сердце синхронизации (PROJECT.md §2.2).
 *
 * Обязательный сценарий из ТЗ §7:
 *   Honor получил версию A, iPhone получил версию A.
 *   Honor добавил молоко → версия B. iPhone на основе A добавил хлеб.
 *   Результат: молоко НЕ теряется.
 *
 * Решается тем, что слияние идёт ПО СУЩНОСТЯМ, а не по файлу: каждая сущность
 * сравнивается с последней синхронизированной версией (base), поэтому изменения
 * разных устройств в разные сущности не конфликтуют в принципе.
 *
 * Для настоящего конфликта (обе стороны правили ОДНУ сущность после base) —
 * LWW по updatedAt с детерминированным tie-break, а проигравшая версия
 * сохраняется в unresolved (§3, п.5: UI разрешения конфликтов не строим).
 */
import type { Syncable } from './types';

export type EntityMap<T extends Syncable> = Record<string, T>;

export interface ConflictRecord<T extends Syncable> {
  id: string;
  kind: string;
  winner: 'local' | 'remote';
  reason: 'updatedAt' | 'updatedBy' | 'id';
  at: string;
  /** Побеждённая версия — целиком, чтобы её можно было показать в Диагностике и восстановить. */
  loser: T;
  winnerEntity: T;
}

export interface MergeOutcome<T extends Syncable> {
  merged: EntityMap<T>;
  conflicts: ConflictRecord<T>[];
  /** Сколько сущностей взято с локальной стороны (нужно отправить в remote). */
  localWins: string[];
  /** Сколько сущностей взято из remote (нужно записать локально). */
  remoteWins: string[];
  changed: boolean;
}

/**
 * @param base   rev каждой сущности на момент последней успешной синхронизации
 *               (хранится в Dexie.syncMeta). Отсутствие id = 0.
 * @param local  текущее локальное состояние
 * @param remote текущее состояние в GitHub
 */
export function mergeEntities<T extends Syncable>(
  base: Record<string, number>,
  local: EntityMap<T>,
  remote: EntityMap<T>,
  kind: string,
  nowIso: string,
): MergeOutcome<T> {
  const merged: EntityMap<T> = {};
  const conflicts: ConflictRecord<T>[] = [];
  const localWins: string[] = [];
  const remoteWins: string[] = [];

  const ids = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);

  for (const id of ids) {
    const l = local[id];
    const r = remote[id];
    const b = base[id] ?? 0;
    const localRev = l?.rev ?? 0;
    const remoteRev = r?.rev ?? 0;

    const localChanged = localRev > b;
    const remoteChanged = remoteRev > b;

    // 1. Изменений нет ни с одной стороны → берём то, что есть (обычно remote).
    if (!localChanged && !remoteChanged) {
      const keep = r ?? l;
      if (keep) {
        merged[id] = keep;
        if (r) remoteWins.push(id);
      }
      continue;
    }

    // 2. Изменилась только одна сторона → она и побеждает, конфликта нет.
    if (localChanged && !remoteChanged) {
      if (l) {
        merged[id] = l;
        localWins.push(id);
      }
      continue;
    }
    if (remoteChanged && !localChanged) {
      if (r) {
        merged[id] = r;
        remoteWins.push(id);
      }
      continue;
    }

    // 3. Обе стороны изменили одну сущность → настоящий конфликт.
    if (!l || !r) {
      // Одна из сторон физически потеряла запись (например, компакция tombstone).
      const keep = (l ?? r)!;
      merged[id] = keep;
      (l ? localWins : remoteWins).push(id);
      continue;
    }

    const winner = pickWinner(l, r);
    const loser = winner === 'local' ? r : l;
    merged[id] = winner === 'local' ? l : r;
    (winner === 'local' ? localWins : remoteWins).push(id);
    conflicts.push({
      id,
      kind,
      winner,
      reason: winnerReason(l, r),
      at: nowIso,
      loser,
      winnerEntity: winner === 'local' ? l : r,
    });
  }

  const changed =
    conflicts.length > 0 ||
    localWins.length > 0 ||
    remoteWins.length > 0 ||
    Object.keys(merged).length !== Object.keys(remote).length ||
    ids.size !== Object.keys(merged).length;

  return { merged, conflicts, localWins, remoteWins, changed };
}

/**
 * Детерминированный выбор победителя. Порядок:
 *   1) более поздний updatedAt;
 *   2) при равенстве — лексикографически больший updatedBy;
 *   3) при полном равенстве — больший id.
 * Детерминизм обязателен: оба устройства должны прийти к ОДИНАКОВОМУ решению,
 * иначе они разойдутся навсегда.
 */
export function pickWinner<T extends Syncable>(a: T, b: T): 'local' | 'remote' {
  const cmp = compareEntities(a, b);
  return cmp >= 0 ? 'local' : 'remote';
}

export function winnerReason<T extends Syncable>(a: T, b: T): 'updatedAt' | 'updatedBy' | 'id' {
  if (a.updatedAt !== b.updatedAt) return 'updatedAt';
  if (a.updatedBy !== b.updatedBy) return 'updatedBy';
  return 'id';
}

/** >0 если `a` сильнее `b`. */
function compareEntities<T extends Syncable>(a: T, b: T): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
  if (a.updatedBy !== b.updatedBy) return a.updatedBy > b.updatedBy ? 1 : -1;
  if (a.id !== b.id) return a.id > b.id ? 1 : -1;
  // Полностью равные ключи → сравниваем rev как последний аргумент
  return a.rev - b.rev;
}

/**
 * Применяет результат слияния к локальному хранилищу и возвращает новый снимок
 * base (rev по каждой сущности) для следующего цикла.
 */
export function nextBaseSnapshot<T extends Syncable>(merged: EntityMap<T>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, e] of Object.entries(merged)) out[id] = e.rev;
  return out;
}

/** Сущности, которые нужно отправить: их локальный rev больше синхронизированного. */
export function dirtyIds<T extends Syncable>(
  local: EntityMap<T>,
  base: Record<string, number>,
): string[] {
  return Object.entries(local)
    .filter(([id, e]) => e.rev > (base[id] ?? 0))
    .map(([id]) => id);
}

/**
 * Компакция tombstone. Удаляем запись только если:
 *  - она помечена удалённой;
 *  - локальных несохранённых изменений нет (rev === base);
 *  - с момента удаления прошло больше ttlDays.
 *
 * ВНИМАНИЕ (известное ограничение ЭТАПА 1): компакция выполняется только локально и
 * только когда все известные устройства подтвердили синхронизацию. Полный механизм
 * (сверка lastSeenRev по устройствам из meta.json) — отдельная задача. До её
 * реализации TTL намеренно большой, чтобы исключать «воскрешение» удалённых позиций.
 */
export function canCompactTombstone<T extends Syncable>(
  entity: T,
  baseRev: number,
  nowMs: number,
  ttlDays = 90,
): boolean {
  if (!entity.deletedAt) return false;
  if (entity.rev !== baseRev) return false;
  const deletedMs = Date.parse(entity.deletedAt);
  if (Number.isNaN(deletedMs)) return false;
  return nowMs - deletedMs > ttlDays * 86_400_000;
}
