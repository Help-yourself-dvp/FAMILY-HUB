/**
 * Группировка раздела «Куплено» (просьба владельца 05.10.2026).
 *
 * Владелец увидел «Молоко» двумя строками и спросил, не правильнее ли объединять. Правильнее —
 * но только честно: объединяем записи ОДНОГО товара с ОДНОЙ единицей измерения, данные при
 * этом не переписываем (каждая запись остаётся отдельной и раскрывается по нажатию).
 * Позиции с разными единицами (1 л и 2 шт.) не смешиваем: сумма была бы бессмыслицей.
 */
import type { ShoppingItem } from './types';

export interface DoneGroup {
  /** Новейшая запись группы: её название, автор и подпись показывает свёрнутая строка. */
  item: ShoppingItem;
  /** Все записи группы, от новых к старым — для раскрытия «показать все». */
  items: ShoppingItem[];
  count: number;
  /** Сумма количества, когда её можно сложить честно (у всех записей есть количество). */
  qty: number | null;
  unit: string | null;
}

function groupKey(item: ShoppingItem): string {
  return `${item.canonicalKey}\u0000${(item.unit ?? '').trim().toLowerCase()}`;
}

function byDoneAtDesc(a: ShoppingItem, b: ShoppingItem): number {
  return (
    (b.doneAt ?? b.updatedAt).localeCompare(a.doneAt ?? a.updatedAt) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.id.localeCompare(b.id)
  );
}

/** Купленные позиции: сгруппированы по товару и единице, порядок — «сначала свежие». */
export function groupDoneItems(items: ShoppingItem[]): DoneGroup[] {
  const done = items.filter((i) => i.done && !i.deletedAt).sort(byDoneAtDesc);
  const order: string[] = [];
  const map = new Map<string, ShoppingItem[]>();
  for (const item of done) {
    const key = groupKey(item);
    const list = map.get(key);
    if (list) list.push(item);
    else {
      map.set(key, [item]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const list = map.get(key) ?? [];
    const item = list[0];
    if (!item) throw new Error('группа без записей — этого не может быть');
    const allQty = list.every((i) => i.qty !== null);
    return {
      item,
      items: list,
      count: list.length,
      qty: allQty ? list.reduce((sum, i) => sum + (i.qty ?? 0), 0) : null,
      unit: item.unit,
    };
  });
}
