/**
 * Repository layer (PROJECT.md §2.2): UI обращается сюда и НЕ знает,
 * где физически лежат данные — в IndexedDB или в GitHub.
 *
 * Каждая мутация: пишет локально → помечает изменение → просит планировщик
 * синхронизироваться с дебаунсом. Offline-изменения не теряются: они остаются
 * в Dexie с rev > base до успешной отправки.
 */
import { db, kvSet } from './db';
import { session } from './session';
import { notifyLocalChange } from './sync/engine';
import { canonicalKey } from '../domain/normalize';
import type { Horizon, Member, ShoppingItem } from '../domain/types';
import { newId } from '../shared/id';

export interface NewShoppingInput {
  title: string;
  qty?: number | null;
  unit?: string | null;
  category?: string | null;
  store?: string | null;
  horizon?: Horizon;
  note?: string | null;
}

function stamp(): { updatedAt: string; updatedBy: string } {
  return { updatedAt: new Date().toISOString(), updatedBy: session().deviceId };
}

export const shoppingRepo = {
  /** Все незавершённые позиции, отсортированные по горизонту и дате. */
  async listActive(): Promise<ShoppingItem[]> {
    const all = await db.shopping.toArray();
    return all.filter((i) => !i.deletedAt && !i.done).sort(byHorizonThenNewest);
  },

  async listDone(): Promise<ShoppingItem[]> {
    const all = await db.shopping.toArray();
    return all
      .filter((i) => !i.deletedAt && i.done)
      .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  },

  async countActive(): Promise<number> {
    return (await db.shopping.toArray()).filter((i) => !i.deletedAt && !i.done).length;
  },

  async add(input: NewShoppingInput): Promise<ShoppingItem> {
    const now = new Date().toISOString();
    const s = stamp();
    const item: ShoppingItem = {
      id: newId(),
      rev: 1,
      createdAt: now,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
      deletedAt: null,
      kind: 'shopping',
      title: input.title.trim(),
      canonicalKey: canonicalKey(input.title),
      qty: input.qty ?? null,
      unit: input.unit ?? null,
      category: input.category ?? null,
      store: input.store ?? null,
      horizon: input.horizon ?? 'now',
      note: input.note ?? null,
      done: false,
      doneAt: null,
      doneBy: null,
    };
    await db.shopping.put(item);
    await appendActivity('created', item.title);
    notifyLocalChange();
    return item;
  },

  async update(
    id: string,
    patch: Partial<Omit<ShoppingItem, 'id' | 'rev' | 'createdAt' | 'kind'>>,
  ): Promise<void> {
    const cur = await db.shopping.get(id);
    if (!cur || cur.deletedAt) return;
    const s = stamp();
    const next: ShoppingItem = {
      ...cur,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim() : cur.title,
      canonicalKey: patch.title !== undefined ? canonicalKey(patch.title) : cur.canonicalKey,
      rev: cur.rev + 1,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    };
    await db.shopping.put(next);
    await appendActivity('updated', next.title);
    notifyLocalChange();
  },

  async toggleDone(id: string): Promise<void> {
    const cur = await db.shopping.get(id);
    if (!cur || cur.deletedAt) return;
    const s = stamp();
    const next: ShoppingItem = {
      ...cur,
      done: !cur.done,
      doneAt: !cur.done ? s.updatedAt : null,
      doneBy: !cur.done ? s.updatedBy : null,
      rev: cur.rev + 1,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    };
    await db.shopping.put(next);
    await appendActivity('completed', next.title);
    notifyLocalChange();
  },

  /** Tombstone, а не физическое удаление (§2.2, п.5): иначе позиция воскреснет при merge. */
  async remove(id: string): Promise<void> {
    const cur = await db.shopping.get(id);
    if (!cur) return;
    const s = stamp();
    await db.shopping.put({
      ...cur,
      deletedAt: s.updatedAt,
      rev: cur.rev + 1,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    });
    await appendActivity('deleted', cur.title);
    notifyLocalChange();
  },

  /**
   * «Повторить корзину» (ЭТАП 4): завершённые позиции возвращаются в список активными.
   * Типичный сценарий семьи: недельная корзина повторяется с небольшими правками.
   */
  async repeatBasket(): Promise<number> {
    const done = await this.listDone();
    let n = 0;
    for (const d of done) {
      const s = stamp();
      await db.shopping.put({
        ...d,
        done: false,
        doneAt: null,
        doneBy: null,
        rev: d.rev + 1,
        updatedAt: s.updatedAt,
        updatedBy: s.updatedBy,
      });
      n += 1;
    }
    if (n > 0) {
      await appendActivity('created', `Корзина повторена: ${n} поз.`);
      notifyLocalChange();
    }
    return n;
  },

  /** Очистка завершённых (локально + tombstone, чтобы не вернулись с другого телефона). */
  async clearDone(): Promise<number> {
    const done = await this.listDone();
    for (const d of done) await this.remove(d.id);
    return done.length;
  },
};

const HORIZON_ORDER: Record<Horizon, number> = { now: 0, soon: 1, someday: 2 };

function byHorizonThenNewest(a: ShoppingItem, b: ShoppingItem): number {
  const h = HORIZON_ORDER[a.horizon] - HORIZON_ORDER[b.horizon];
  if (h !== 0) return h;
  return b.createdAt.localeCompare(a.createdAt);
}

export const memberRepo = {
  async list(): Promise<Member[]> {
    const all = await db.members.toArray();
    return all.filter((m) => !m.deletedAt).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  },

  /** Профиль устройства публикуется в общий members.json, чтобы семья видела имена. */
  async ensureSelfProfile(): Promise<Member> {
    const s = session();
    const existing = s.memberEntityId ? await db.members.get(s.memberEntityId) : undefined;
    if (existing && !existing.deletedAt && existing.name === s.name && existing.color === s.color) {
      return existing;
    }
    const now = new Date().toISOString();
    const member: Member = existing
      ? {
          ...existing,
          name: s.name,
          color: s.color,
          rev: existing.rev + 1,
          updatedAt: now,
          updatedBy: s.deviceId,
        }
      : {
          id: newId(),
          rev: 1,
          kind: 'members',
          createdAt: now,
          updatedAt: now,
          updatedBy: s.deviceId,
          deletedAt: null,
          name: s.name,
          color: s.color,
          emoji: null,
        };
    await db.members.put(member);
    await kvSet('profile.memberId', member.id);
    notifyLocalChange();
    return member;
  },
};

/**
 * «Семейная лента» (§3, п.2) — замена per-entity audit log.
 * Хранится локально и синхронизируется как часть activity (ЭТАП 8).
 * Заголовок КОРОТКИЙ: без приватных подробностей (§6.19).
 */
export async function appendActivity(
  action: 'created' | 'updated' | 'completed' | 'deleted',
  title: string,
  actor?: { id: string; name: string },
): Promise<void> {
  const s = session();
  const short = title.length > 40 ? `${title.slice(0, 40)}…` : title;
  // Дедупликация (приёмка 0.1.9): циклы синхронизации могут приносить одно и то же
  // событие повторно — лента не должна двоиться и вытеснять настоящие записи.
  const actorId = actor?.id ?? s.deviceId;
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const dup = await db.activity
    .where('at')
    .above(since)
    .filter((a) => a.actorId === actorId && a.action === action && a.title === short)
    .first();
  if (dup) return;
  await db.activity.put({
    id: newId(),
    at: new Date().toISOString(),
    actorId,
    actorName: actor?.name || s.name || 'Устройство',
    kind: 'shopping',
    action,
    title: short,
  });
  // Ограничиваем ленту, чтобы она не росла бесконечно.
  const count = await db.activity.count();
  if (count > 60) {
    const old = await db.activity
      .orderBy('at')
      .limit(count - 60)
      .primaryKeys();
    await db.activity.bulkDelete(old);
  }
}
