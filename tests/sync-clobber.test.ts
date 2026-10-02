/**
 * Защита правок пользователя во время цикла синхронизации (приёмка 0.1.5).
 *
 * Дефект 0.1.4: writeMerged стирал таблицу и клал снимок, прочитанный ДО начала
 * цикла, — нажатия во время долгой синхронизации молча откатывались («кнопка не
 * нажимается», «продукт не пропадает»). Теперь правки новее снимка localBefore
 * переживают запись, а base-снимок остаётся по синхронизированному rev, поэтому
 * такие правки попадают в очередь на отправку.
 */
import { describe, expect, it } from 'vitest';
import { db, writeMerged } from '../src/data/db';
import type { ShoppingItem } from '../src/domain/types';

function row(id: string, rev: number, patch: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id,
    rev,
    kind: 'shopping',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'dev-1',
    deletedAt: null,
    title: `тест ${id}`,
    canonicalKey: id,
    qty: null,
    unit: null,
    category: null,
    store: null,
    horizon: 'now',
    note: null,
    done: false,
    doneAt: null,
    doneBy: null,
    ...patch,
  };
}

describe('writeMerged', () => {
  it('правка пользователя во время цикла переживает запись слияния', async () => {
    const before = row('a', 1);
    await db.shopping.put(before);
    const localBefore = { a: before };
    // Пользователь отметил купленным, пока цикл ещё крутится.
    const during = { ...before, rev: 2, done: true, updatedAt: '2026-10-01T10:00:00.000Z' };
    await db.shopping.put(during);
    // Синхронизация пишет результат, рассчитанный из снимка ДО её начала.
    await writeMerged('shopping', { a: before }, '2026-10-01T09:59:00.000Z', localBefore);
    const now = await db.shopping.get('a');
    expect(now?.rev).toBe(2);
    expect(now?.done).toBe(true);
  });

  it('base-снимок остаётся по синхронизированному rev — правка уходит в очередь', async () => {
    const meta = await db.syncMeta.get('shopping:a');
    expect(meta?.rev).toBe(1);
    // countPending считает rev > base: наша правка rev=2 обязана быть в очереди.
    const local = await db.shopping.toArray();
    const base = await db.syncMeta.where('kind').equals('shopping').toArray();
    const pending = local.filter((e) => e.rev > (base.find((b) => b.id === e.id)?.rev ?? 0));
    expect(pending.map((e) => e.id)).toContain('a');
  });

  it('локальное удаление во время цикла не воскрешается', async () => {
    const b = row('b', 1);
    await db.shopping.put(b);
    const localBefore = { b };
    await db.shopping.delete('b'); // физическое удаление (clearDone)
    await writeMerged('shopping', { b }, '2026-10-01T09:59:00.000Z', localBefore);
    expect(await db.shopping.get('b')).toBeUndefined();
  });

  it('без localBefore локальные строки не уничтожаются (защита от потери данных)', async () => {
    // localBefore передаёт только цикл синхронизации. Любой другой вызов не имеет
    // права стирать пользовательские строки: безопасное поведение — сохранить их.
    await db.shopping.put(row('c', 5));
    await writeMerged('shopping', {}, '2026-10-01T09:59:00.000Z');
    expect(await db.shopping.get('c')).toBeDefined();
  });
});
