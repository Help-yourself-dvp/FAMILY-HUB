/**
 * «Повторить корзину» (ЭТАП 4) и отсутствие ping-понга профилей (приёмка 0.1.8).
 */
import { describe, expect, it } from 'vitest';
import { db } from '../src/data/db';
import { shoppingRepo } from '../src/data/repositories';
import { loadSession, updateProfile } from '../src/data/session';
import type { ShoppingItem } from '../src/domain/types';

function row(id: string, patch: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id,
    rev: 1,
    kind: 'shopping',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'dev-test',
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

describe('repeatBasket', () => {
  it('возвращает завершённые позиции активными с новым rev', async () => {
    await loadSession(); // appendActivity внутри repeatBasket требует сессию
    await db.shopping.bulkPut([
      row('r1', { done: true, doneAt: '2026-10-01T10:00:00.000Z' }),
      row('r2', { done: true, doneAt: '2026-10-01T10:00:00.000Z' }),
      row('r3'),
    ]);
    const n = await shoppingRepo.repeatBasket();
    expect(n).toBe(2);
    const r1 = await db.shopping.get('r1');
    expect(r1?.done).toBe(false);
    expect(r1?.rev).toBe(2);
    const r3 = await db.shopping.get('r3');
    expect(r3?.rev).toBe(1);
  });
});

describe('publishMember', () => {
  it('не поднимает rev профиля без реального изменения', async () => {
    const s = await loadSession();
    const before = (await db.members.get(s.deviceId))?.rev ?? 0;
    await updateProfile({ name: s.name });
    const after = (await db.members.get(s.deviceId))?.rev ?? 0;
    expect(after).toBe(before);
  });
});
