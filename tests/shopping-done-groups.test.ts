/**
 * Раздел «Куплено» (просьба владельца 05.10.2026): одинаковые записи одного товара
 * показываются одной строкой с пометкой «×N» и раскрываются в отдельные записи.
 * Данные при этом не переписываются — каждая запись остаётся отдельной.
 */
import { describe, expect, it } from 'vitest';
import { groupDoneItems } from '../src/domain/shoppingDone';
import { canonicalKey } from '../src/domain/normalize';
import type { ShoppingItem } from '../src/domain/types';

function item(over: Partial<ShoppingItem> = {}): ShoppingItem {
  const title = over.title ?? 'Молоко';
  return {
    id: 'i1',
    rev: 1,
    kind: 'shopping',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'dev-1',
    deletedAt: null,
    title,
    canonicalKey: canonicalKey(title),
    qty: null,
    unit: null,
    category: null,
    store: null,
    horizon: 'now',
    note: null,
    done: true,
    doneAt: '2026-10-05T09:00:00.000Z',
    doneBy: 'dev-1',
    ...over,
  };
}

describe('groupDoneItems', () => {
  it('два одинаковых товара — одна строка с пометкой ×2, данные обеих записей целы', () => {
    const groups = groupDoneItems([
      item({ id: 'a', title: 'Молоко', doneAt: '2026-10-05T09:00:00.000Z' }),
      item({
        id: 'b',
        title: 'молоко',
        canonicalKey: canonicalKey('Молоко'),
        doneAt: '2026-10-05T08:00:00.000Z',
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['a', 'b']);
    // Свёрнутая строка показывает самую свежую запись.
    expect(groups[0]?.item.id).toBe('a');
  });

  it('разные единицы не смешиваются: «Молоко 1 л» и «Молоко 2 шт.» — разные строки', () => {
    const groups = groupDoneItems([
      item({ id: 'a', title: 'Молоко', unit: 'л', qty: 1 }),
      item({ id: 'b', title: 'Молоко', unit: 'шт', qty: 2 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('количества складываются только когда они есть у всех записей', () => {
    const withQty = groupDoneItems([
      item({ id: 'a', qty: 2, unit: 'шт' }),
      item({ id: 'b', qty: 3, unit: 'шт' }),
    ]);
    expect(withQty[0]?.qty).toBe(5);
    const partial = groupDoneItems([
      item({ id: 'a', qty: 2, unit: 'шт' }),
      item({ id: 'b', qty: null, unit: 'шт' }),
    ]);
    expect(partial[0]?.qty).toBeNull();
  });

  it('разные товары остаются разными строками, порядок — от свежих к старым', () => {
    const groups = groupDoneItems([
      item({ id: 'old', title: 'Хлеб', doneAt: '2026-10-05T07:00:00.000Z' }),
      item({ id: 'new', title: 'Сыр', doneAt: '2026-10-05T10:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.item.title)).toEqual(['Сыр', 'Хлеб']);
  });

  it('активные и удалённые записи в «Куплено» не попадают', () => {
    const groups = groupDoneItems([
      item({ id: 'active', done: false, doneAt: null }),
      item({ id: 'gone', deletedAt: '2026-10-05T09:00:00.000Z' }),
      item({ id: 'ok' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['ok']);
  });

  it('одна запись тоже становится группой из одной — экран показывает её как раньше', () => {
    const groups = groupDoneItems([item({ id: 'solo', title: 'Кефир' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(1);
  });
});
