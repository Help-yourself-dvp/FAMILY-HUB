/**
 * Тесты entity-level merge — сердце синхронизации.
 * Обязательный сценарий из ТЗ §7: два телефона добавили РАЗНЫЕ позиции на основе
 * одной версии → ни одна не должна потеряться.
 */
import { describe, expect, it } from 'vitest';
import { canCompactTombstone, dirtyIds, mergeEntities, nextBaseSnapshot } from '../src/domain/merge';
import type { ShoppingItem, Syncable } from '../src/domain/types';

const NOW = '2026-10-01T10:00:00.000Z';

function item(id: string, over: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id,
    rev: 1,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'dev-A',
    deletedAt: null,
    kind: 'shopping',
    title: `item-${id}`,
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
    ...over,
  };
}

function map<T extends Syncable>(...items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const i of items) out[i.id] = i;
  return out;
}

describe('сценарий из ТЗ §7: два телефона добавили разные позиции', () => {
  it('молоко (Honor) и хлеб (iPhone) оба выживают', () => {
    const milk = item('milk', { title: 'Молоко', updatedBy: 'dev-honor' });
    const bread = item('bread', { title: 'Хлеб', updatedBy: 'dev-iphone' });

    // base пуст: ни одно устройство ещё не синхронизировалось
    const base: Record<string, number> = {};
    const local = map(milk); // Honor
    const remote = map(bread); // iPhone уже закоммитил хлеб

    const r = mergeEntities(base, local, remote, 'shopping', NOW);

    expect(Object.keys(r.merged).sort()).toEqual(['bread', 'milk']);
    expect(r.conflicts).toHaveLength(0);
    // Honor должен отправить молоко, iPhone-данные приняты локально
    expect(r.localWins).toContain('milk');
    expect(r.remoteWins).toContain('bread');
  });

  it('тот же результат на обоих устройствах (детерминизм обязателен)', () => {
    const a = item('a', { updatedBy: 'dev-honor', updatedAt: '2026-10-01T09:00:00Z' });
    const b = item('b', { updatedBy: 'dev-iphone', updatedAt: '2026-10-01T09:00:00Z' });
    const one = mergeEntities({}, map(a), map(b), 'shopping', NOW);
    const two = mergeEntities({}, map(b), map(a), 'shopping', NOW);
    expect(Object.keys(one.merged).sort()).toEqual(Object.keys(two.merged).sort());
  });
});

describe('изменение только одной стороны', () => {
  it('локальная правка побеждает, remote не трогается', () => {
    const synced = item('milk', { title: 'Молоко' });
    const edited = { ...synced, title: 'Молоко 3.2%', rev: 2, updatedAt: '2026-10-01T11:00:00Z' };
    const r = mergeEntities({ milk: 1 }, map(edited), map(synced), 'shopping', NOW);
    expect(r.merged['milk']!.title).toBe('Молоко 3.2%');
    expect(r.conflicts).toHaveLength(0);
    expect(r.localWins).toEqual(['milk']);
  });

  it('удалённая правка побеждает, локальных изменений нет', () => {
    const synced = item('milk', { title: 'Молоко' });
    const remoteEdit = { ...synced, qty: 2, rev: 2, updatedBy: 'dev-iphone' };
    const r = mergeEntities({ milk: 1 }, map(synced), map(remoteEdit), 'shopping', NOW);
    expect(r.merged['milk']!.qty).toBe(2);
    expect(r.conflicts).toHaveLength(0);
    expect(r.remoteWins).toEqual(['milk']);
  });
});

describe('настоящий конфликт: обе стороны правили одну сущность', () => {
  it('побеждает более поздний updatedAt, проигравшая версия сохраняется', () => {
    const base1 = item('milk', { title: 'Молоко' });
    const local = { ...base1, qty: 1, rev: 2, updatedAt: '2026-10-01T10:00:00Z', updatedBy: 'dev-honor' };
    const remote = { ...base1, qty: 5, rev: 2, updatedAt: '2026-10-01T11:00:00Z', updatedBy: 'dev-iphone' };

    const r = mergeEntities({ milk: 1 }, map(local), map(remote), 'shopping', NOW);

    expect(r.merged['milk']!.qty).toBe(5); // remote позже
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.winner).toBe('remote');
    expect(r.conflicts[0]!.loser.qty).toBe(1); // проигравшую версию не выбрасываем
    expect(r.conflicts[0]!.reason).toBe('updatedAt');
  });

  it('при равном updatedAt — детерминированный tie-break по updatedBy', () => {
    const mk = (by: string) => ({ ...item('milk'), rev: 2, updatedAt: NOW, updatedBy: by });
    const r = mergeEntities({ milk: 1 }, map(mk('dev-z')), map(mk('dev-a')), 'shopping', NOW);
    expect(r.conflicts[0]!.winner).toBe('local'); // 'dev-z' > 'dev-a'
    expect(r.conflicts[0]!.reason).toBe('updatedBy');
  });
});

describe('tombstone: удалённое не воскресает (PROJECT.md §2.2, п.5)', () => {
  it('удаление с одного устройства распространяется, даже если второе не меняло запись', () => {
    const synced = item('milk');
    const tombstone = { ...synced, deletedAt: NOW, rev: 2, updatedAt: NOW };
    const r = mergeEntities({ milk: 1 }, map(tombstone), map(synced), 'shopping', NOW);
    expect(r.merged['milk']!.deletedAt).toBe(NOW);
    expect(r.conflicts).toHaveLength(0);
  });

  it('удаление НЕ перетирается одновременной правкой с другого устройства — это конфликт', () => {
    const base = item('milk');
    const deleted = { ...base, deletedAt: NOW, rev: 2, updatedAt: '2026-10-01T10:00:00Z', updatedBy: 'dev-A' };
    const edited: ShoppingItem = { ...base, qty: 3, rev: 2, updatedAt: '2026-10-01T11:00:00Z', updatedBy: 'dev-B' };
    const r = mergeEntities({ milk: 1 }, map(deleted), map(edited), 'shopping', NOW);
    expect(r.conflicts).toHaveLength(1);
    // победитель — более поздняя правка (qty=3), tombstone сохранён как loser для Диагностики
    expect(r.merged['milk']!.qty).toBe(3);
    expect(r.conflicts[0]!.loser.deletedAt).toBe(NOW);
  });

  it('canCompactTombstone: только синхронизированное и старше TTL', () => {
    const old = { ...item('milk'), deletedAt: '2026-01-01T00:00:00Z' };
    const recent = { ...item('milk'), deletedAt: NOW };
    const dirty = { ...item('milk'), deletedAt: '2026-01-01T00:00:00Z', rev: 5 };
    const t = Date.parse('2026-10-01T00:00:00Z');
    expect(canCompactTombstone(old, 1, t)).toBe(true);
    expect(canCompactTombstone(recent, 1, t)).toBe(false);
    expect(canCompactTombstone(dirty, 1, t)).toBe(false); // rev !== base → не синхронизировано
    expect(canCompactTombstone(item('milk'), 1, t)).toBe(false); // не tombstone
  });
});

describe('вспомогательные функции', () => {
  it('dirtyIds считает только несохранённые', () => {
    const a = item('a', { rev: 3 });
    const b = item('b', { rev: 1 });
    expect(dirtyIds(map(a, b), { a: 3, b: 1 })).toEqual([]);
    expect(dirtyIds(map(a, b), { a: 2, b: 1 })).toEqual(['a']);
    expect(dirtyIds(map(a, b), {})).toEqual(['a', 'b']);
  });

  it('nextBaseSnapshot фиксирует rev для следующего цикла', () => {
    const s = nextBaseSnapshot(map(item('a', { rev: 7 })));
    expect(s).toEqual({ a: 7 });
  });
});
