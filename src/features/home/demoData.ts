/**
 * Демонстрационные локальные данные (ТЗ §35 E).
 *
 * ВАЖНО: они обязаны быть ОЧЕВЬИДНО демонстрационными, а не притворяться данными
 * бэкенда. Поэтому каждая позиция помечена `note: 'демо'`, а в интерфейсе показан
 * явный бейдж «ДЕМО-ДАННЫЕ», который исчезает после первой реальной записи.
 */
import { db, kvGet, kvSet } from '../../data/db';
import { session } from '../../data/session';
import { canonicalKey } from '../../domain/normalize';
import type { ShoppingItem } from '../../domain/types';
import { newId } from '../../shared/id';

const DEMO: Array<Pick<ShoppingItem, 'title' | 'qty' | 'unit' | 'category' | 'horizon' | 'done'>> =
  [
    { title: 'Молоко', qty: 2, unit: 'л', category: 'Молочное', horizon: 'now', done: false },
    {
      title: 'Хлеб бородинский',
      qty: 1,
      unit: 'шт',
      category: 'Бакалея',
      horizon: 'now',
      done: false,
    },
    {
      title: 'Бананы',
      qty: 1.5,
      unit: 'кг',
      category: 'Овощи и фрукты',
      horizon: 'now',
      done: false,
    },
    { title: 'Яйца', qty: 10, unit: 'шт', category: 'Молочное', horizon: 'now', done: false },
    { title: 'Зубная паста', qty: 1, unit: 'шт', category: 'Гигиена', horizon: 'now', done: false },
    {
      title: 'Корм для кота',
      qty: 1,
      unit: 'уп',
      category: 'Для дома',
      horizon: 'soon',
      done: false,
    },
    {
      title: 'Фильтр для воды',
      qty: 1,
      unit: 'шт',
      category: 'Для дома',
      horizon: 'soon',
      done: false,
    },
    {
      title: 'Подарок на день рождения',
      qty: null,
      unit: null,
      category: 'Другое',
      horizon: 'someday',
      done: false,
    },
    { title: 'Сыр', qty: 300, unit: 'г', category: 'Молочное', horizon: 'now', done: true },
    { title: 'Кофе', qty: 1, unit: 'уп', category: 'Напитки', horizon: 'now', done: true },
  ];

export async function seedDemoData(): Promise<void> {
  if (await kvGet<boolean>('demo.seeded')) return;
  const s = session();
  const now = Date.now();
  const rows: ShoppingItem[] = DEMO.map((d, i) => {
    const created = new Date(now - (DEMO.length - i) * 3_600_000).toISOString();
    return {
      id: newId(),
      rev: 1,
      kind: 'shopping',
      createdAt: created,
      updatedAt: created,
      updatedBy: s.deviceId,
      deletedAt: null,
      title: d.title,
      canonicalKey: canonicalKey(d.title),
      qty: d.qty,
      unit: d.unit,
      category: d.category,
      store: null,
      horizon: d.horizon,
      note: 'демо',
      done: d.done,
      doneAt: d.done ? created : null,
      doneBy: d.done ? s.deviceId : null,
    };
  });
  await db.shopping.bulkPut(rows);
  await kvSet('demo.seeded', true);
}

/** Демо-данные считаются активными, пока есть позиции с пометкой «демо». */
export async function hasDemoData(): Promise<boolean> {
  const all = await db.shopping.toArray();
  return all.some((i) => i.note === 'демо');
}
