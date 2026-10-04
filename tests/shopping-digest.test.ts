/**
 * Дайджест «изменения корзины» (0.5.6).
 *
 * Владелец 04.10.2026: включил тумблер, добавил покупку с другого телефона — уведомление
 * не пришло. Причина была не в сети: код, который умел бы такое отправлять, отсутствовал.
 * Здесь проверяется логика этого кода на вымышленных данных: что попадает в дайджест,
 * что не попадает (своё, купленное, удалённое, старое) и как соблюдается «не чаще 30 минут».
 */
import { describe, expect, it } from 'vitest';
import { entityRows } from '../scripts/push-sender-data.mjs';
// Исходник отправителя — как текст: проверяем, что дайджест действительно подключён,
// а не просто написан рядом (статический сторож, живая сеть в тестах запрещена).
import senderSource from '../scripts/push-sender.mjs?raw';
import {
  SHOPPING_DIGEST_MIN_INTERVAL_MS,
  digestAllowed,
  digestText,
  shoppingChanges,
  type ShoppingDigestItem,
} from '../scripts/shopping-digest.mjs';

const item = (over: Partial<ShoppingDigestItem> = {}): ShoppingDigestItem => ({
  id: 'i1',
  title: 'Молоко',
  done: false,
  deletedAt: null,
  updatedAt: '2026-10-04T07:10:00.000Z',
  updatedBy: 'device-b',
  ...over,
});

const SINCE = '2026-10-04T07:00:00.000Z';

describe('shoppingChanges — что попадает в дайджест', () => {
  it('берёт позиции, изменённые после отметки, от старых к новым', () => {
    const rows = shoppingChanges(
      [
        item({ id: 'new', title: 'Хлеб', updatedAt: '2026-10-04T07:30:00.000Z' }),
        item({ id: 'old', title: 'Сыр', updatedAt: '2026-10-04T06:00:00.000Z' }),
        item({ id: 'mid', title: 'Яйца', updatedAt: '2026-10-04T07:05:00.000Z' }),
      ],
      { sinceIso: SINCE },
    );
    expect(rows.map((r) => r.id)).toEqual(['mid', 'new']);
  });

  it('не возвращает тому, кто внёс: свои устройства исключаются', () => {
    const rows = shoppingChanges(
      [item({ id: 'mine', updatedBy: 'device-a' }), item({ id: 'theirs', updatedBy: 'device-b' })],
      { sinceIso: SINCE, excludeIds: ['device-a', 'member-1'] },
    );
    expect(rows.map((r) => r.id)).toEqual(['theirs']);
  });

  it('купленное, удалённое и без названия в дайджест не идут', () => {
    const rows = shoppingChanges(
      [
        item({ id: 'done', done: true }),
        item({ id: 'gone', deletedAt: '2026-10-04T07:20:00.000Z' }),
        item({ id: 'empty', title: '   ' }),
        item({ id: 'ok' }),
      ],
      { sinceIso: SINCE },
    );
    expect(rows.map((r) => r.id)).toEqual(['ok']);
  });

  it('без отметки времени не сравнивает и молчит (не шлёт всю историю)', () => {
    expect(shoppingChanges([item()], { sinceIso: null })).toEqual([]);
    expect(shoppingChanges([item()], {})).toEqual([]);
    expect(shoppingChanges(null, { sinceIso: SINCE })).toEqual([]);
  });

  it('битая дата изменения не считается свежей', () => {
    const rows = shoppingChanges([item({ updatedAt: 'не-дата' })], { sinceIso: SINCE });
    expect(rows).toEqual([]);
  });
});

describe('digestText — текст уведомления', () => {
  it('одна позиция — без хвоста, три — без хвоста', () => {
    expect(digestText([item({ title: 'Молоко' })])).toBe('Новое в списке покупок: Молоко');
    expect(
      digestText([item({ title: 'Молоко' }), item({ title: 'Хлеб' }), item({ title: 'Яйца' })]),
    ).toBe('Новое в списке покупок: Молоко, Хлеб, Яйца');
  });

  it('больше трёх — честный хвост «и ещё N»', () => {
    const many = ['Молоко', 'Хлеб', 'Яйца', 'Сыр', 'Яблоки'].map((title, n) =>
      item({ id: `i${n}`, title }),
    );
    expect(digestText(many)).toBe('Новое в списке покупок: Молоко, Хлеб, Яйца — и ещё 2');
  });

  it('пустой список — пустой текст (такое уведомление не отправляется)', () => {
    expect(digestText([])).toBe('');
  });
});

describe('digestAllowed — не чаще раза в 30 минут', () => {
  const now = Date.parse('2026-10-04T08:00:00.000Z');

  it('без отметки — можно', () => {
    expect(digestAllowed(now, null)).toBe(true);
  });

  it('10 минут назад — нельзя, 31 минута — можно', () => {
    expect(digestAllowed(now, '2026-10-04T07:50:00.000Z')).toBe(false);
    expect(digestAllowed(now, '2026-10-04T07:29:00.000Z')).toBe(true);
  });

  it('ровно 30 минут — можно (границу не съедаем)', () => {
    expect(digestAllowed(now, '2026-10-04T07:30:00.000Z')).toBe(true);
    expect(SHOPPING_DIGEST_MIN_INTERVAL_MS).toBe(30 * 60 * 1000);
  });
});

describe('формат хранения покупок', () => {
  it('читается конверт entities, который пишет приложение (и старый массив)', () => {
    const rows = entityRows({ schemaVersion: 1, entities: { i1: item() } });
    expect(rows).toHaveLength(1);
    expect(entityRows([item()])).toHaveLength(1);
    expect(entityRows({ entities: {} })).toEqual([]);
  });
});

describe('отправитель подключён к дайджесту, а не просто содержит модуль', () => {
  it('отправляет только подпискам с согласием и ведёт отдельную отметку времени', () => {
    expect(senderSource).toContain('s.notifyShopping === true');
    expect(senderSource).toContain('digestAllowed(');
    expect(senderSource).toContain('digestText(');
    expect(senderSource).toContain('data/push-sent/shopping-digest.json');
    // Исключение своих устройств обязательно: иначе автор изменения получит эхо.
    expect(senderSource).toContain('excludeIds: [s.deviceId, s.memberId]');
    // Покупки должны читаться даже когда сроков и дел нет вовсе.
    expect(senderSource).toContain('data/shopping.json');
    expect(senderSource).toMatch(
      /deadlines\.length === 0 && tasks\.length === 0 && shopping\.length === 0/u,
    );
  });
});
