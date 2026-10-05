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
import type { Deadline, EntityKind, Horizon, Member, ShoppingItem, Task } from '../domain/types';
import { isDateOnly, type DateOnly } from '../domain/dateOnly';
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
    await appendActivity('created', item.title, undefined, {
      kind: 'shopping',
      place: placeLabel('shopping', item.category),
    });
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
    await appendActivity('updated', next.title, undefined, {
      kind: 'shopping',
      place: placeLabel('shopping', next.category),
    });
    notifyLocalChange();
  },

  /**
   * `done` можно задать явно: свёрнутая строка раздела «Куплено» возвращает в список сразу
   * всю группу одинаковых записей (0.5.9). Без второго аргумента — прежнее переключение.
   */
  async toggleDone(id: string, done?: boolean): Promise<void> {
    const cur = await db.shopping.get(id);
    if (!cur || cur.deletedAt) return;
    const want = done ?? !cur.done;
    if (want === cur.done) return;
    const s = stamp();
    const next: ShoppingItem = {
      ...cur,
      done: want,
      doneAt: want ? s.updatedAt : null,
      doneBy: want ? s.updatedBy : null,
      rev: cur.rev + 1,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    };
    await db.shopping.put(next);
    // Возврат в список пишем как «updated» — так же, как «Повторить корзину» (0.5.9).
    await appendActivity(want ? 'completed' : 'updated', next.title, undefined, {
      kind: 'shopping',
      place: placeLabel('shopping', next.category),
    });
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
    await appendActivity('deleted', cur.title, undefined, {
      kind: 'shopping',
      place: placeLabel('shopping', cur.category),
    });
    notifyLocalChange();
  },

  /**
   * «Повторить корзину»: завершённые позиции возвращаются в список активными.
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
      await appendActivity('created', `Корзина повторена: ${n} поз.`, undefined, {
        kind: 'shopping',
        place: placeLabel('shopping'),
      });
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
const SECTION_LABEL: Record<string, string> = {
  shopping: 'Покупки',
  deadlines: 'Сроки',
  tasks: 'Дела',
  members: 'Профили',
};

/** «Покупки · Молочное» — куда попала запись; видно в семейной ленте (приёмка 0.3.3). */
export function placeLabel(kind: string, category?: string | null): string {
  const base = SECTION_LABEL[kind] ?? 'Данные';
  const cat = category?.trim();
  return cat ? `${base} · ${cat}` : base;
}

export async function appendActivity(
  action: 'created' | 'updated' | 'completed' | 'deleted',
  title: string,
  actor?: { id: string; name: string },
  meta?: { kind?: EntityKind; place?: string | null },
): Promise<void> {
  const s = session();
  const short = title.length > 40 ? `${title.slice(0, 40)}…` : title;
  // Дедупликация (приёмка 0.1.9): циклы синхронизации могут приносить одно и то же
  // событие повторно — лента не должна двоиться и вытеснять настоящие записи.
  const actorId = actor?.id ?? s.deviceId;
  const kind = meta?.kind ?? 'shopping';
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const dup = await db.activity
    .where('at')
    .above(since)
    .filter(
      (a) => a.kind === kind && a.actorId === actorId && a.action === action && a.title === short,
    )
    .first();
  if (dup) return;
  await db.activity.put({
    id: newId(),
    at: new Date().toISOString(),
    actorId,
    actorName: actor?.name || s.name || 'Устройство',
    kind,
    action,
    title: short,
    place: meta?.place ?? null,
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

/* --------------------------------- Сроки ------------------------------------ */

export interface NewDeadlineInput {
  title: string;
  deadlineKind: Deadline['deadlineKind'];
  dueDate: DateOnly;
  remindersDays: number[];
  alertDays?: number | null;
  warnDays?: number | null;
}

export const deadlinesRepo = {
  async add(input: NewDeadlineInput): Promise<Deadline> {
    const s = stamp();
    const item: Deadline = {
      id: newId(),
      rev: 1,
      kind: 'deadlines',
      createdAt: s.updatedAt,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
      deletedAt: null,
      title: input.title.trim(),
      deadlineKind: input.deadlineKind,
      dueDate: input.dueDate,
      remindersDays: input.remindersDays,
      recurrence: { type: 'none' },
      lastCompletedAt: null,
      history: [],
      visibility: 'family',
      note: null,
      alertDays: input.alertDays ?? null,
      warnDays: input.warnDays ?? null,
    };
    await db.deadlines.put(item);
    await appendActivity('created', item.title, undefined, {
      kind: 'deadlines',
      place: placeLabel('deadlines'),
    });
    notifyLocalChange();
    return item;
  },

  async update(id: string, patch: Partial<NewDeadlineInput>): Promise<void> {
    const cur = await db.deadlines.get(id);
    if (!cur || cur.deletedAt) return;
    const s = stamp();
    const next: Deadline = {
      ...cur,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim() : cur.title,
      rev: cur.rev + 1,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    };
    await db.deadlines.put(next);
    await appendActivity('updated', next.title, undefined, {
      kind: 'deadlines',
      place: placeLabel('deadlines'),
    });
    notifyLocalChange();
  },

  /** Tombstone: иначе срок воскреснет при слиянии (§2.2, п.5). */
  async remove(id: string): Promise<void> {
    const cur = await db.deadlines.get(id);
    if (!cur) return;
    const s = stamp();
    await db.deadlines.put({
      ...cur,
      deletedAt: s.updatedAt,
      rev: cur.rev + 1,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    });
    await appendActivity('deleted', cur.title, undefined, {
      kind: 'deadlines',
      place: placeLabel('deadlines'),
    });
    notifyLocalChange();
  },
};

/* ---------------------------------- Дела ------------------------------------ */
export interface NewTaskInput {
  title: string;
  note?: string | null;
  assigneeId?: string | null;
  dueDate?: DateOnly | null;
}

function normalizedTaskInput(input: NewTaskInput) {
  const title = input.title.trim();
  if (!title) throw new Error('Напишите, что нужно сделать.');
  const dueDate = input.dueDate || null;
  if (dueDate && !isDateOnly(dueDate)) throw new Error('Проверьте дату срока.');
  return { title, note: input.note?.trim() || null, assigneeId: input.assigneeId || null, dueDate };
}

export const tasksRepo = {
  /** Локальная запись + лента атомарно. Никакой сети в мутации интерфейса. */
  async add(input: NewTaskInput): Promise<Task> {
    const fields = normalizedTaskInput(input);
    const s = stamp();
    const item: Task = {
      ...fields,
      id: newId(),
      kind: 'tasks',
      rev: 1,
      createdAt: s.updatedAt,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
      deletedAt: null,
      status: 'open',
      doneAt: null,
      recurrence: { type: 'none' },
      assignmentId: fields.assigneeId ? newId() : null,
      assignedAt: fields.assigneeId ? s.updatedAt : null,
      assignedBy: fields.assigneeId ? s.updatedBy : null,
    };
    await db.transaction('rw', db.tasks, db.activity, async () => {
      await db.tasks.put(item);
      await appendActivity('created', item.title, undefined, {
        kind: 'tasks',
        place: placeLabel('tasks'),
      });
    });
    notifyLocalChange();
    return item;
  },

  async update(id: string, patch: Partial<NewTaskInput>): Promise<void> {
    let changed = false;
    await db.transaction('rw', db.tasks, db.activity, async () => {
      const current = await db.tasks.get(id);
      if (!current || current.deletedAt) return;
      const fields = normalizedTaskInput({ ...current, ...patch });
      if (
        fields.title === current.title &&
        fields.note === current.note &&
        fields.assigneeId === current.assigneeId &&
        fields.dueDate === current.dueDate
      )
        return;
      const s = stamp();
      const assignment =
        fields.assigneeId !== current.assigneeId
          ? {
              assignmentId: fields.assigneeId ? newId() : null,
              assignedAt: fields.assigneeId ? s.updatedAt : null,
              assignedBy: fields.assigneeId ? s.updatedBy : null,
            }
          : {};
      await db.tasks.put({ ...current, ...fields, ...assignment, ...s, rev: current.rev + 1 });
      await appendActivity('updated', fields.title, undefined, {
        kind: 'tasks',
        place: placeLabel('tasks'),
      });
      changed = true;
    });
    if (changed) notifyLocalChange();
  },

  /** Желаемое состояние, не toggle: два быстрых нажатия не делают обратную правку. */
  async setDone(id: string, done: boolean): Promise<void> {
    let changed = false;
    await db.transaction('rw', db.tasks, db.activity, async () => {
      const current = await db.tasks.get(id);
      if (!current || current.deletedAt || (current.status === 'done') === done) return;
      const s = stamp();
      await db.tasks.put({
        ...current,
        ...s,
        rev: current.rev + 1,
        status: done ? 'done' : 'open',
        doneAt: done ? s.updatedAt : null,
      });
      await appendActivity(done ? 'completed' : 'updated', current.title, undefined, {
        kind: 'tasks',
        place: placeLabel('tasks'),
      });
      changed = true;
    });
    if (changed) notifyLocalChange();
  },

  async remove(id: string): Promise<void> {
    let changed = false;
    await db.transaction('rw', db.tasks, db.activity, async () => {
      const current = await db.tasks.get(id);
      if (!current || current.deletedAt) return;
      const s = stamp();
      await db.tasks.put({ ...current, ...s, rev: current.rev + 1, deletedAt: s.updatedAt });
      await appendActivity('deleted', current.title, undefined, {
        kind: 'tasks',
        place: placeLabel('tasks'),
      });
      changed = true;
    });
    if (changed) notifyLocalChange();
  },
};
