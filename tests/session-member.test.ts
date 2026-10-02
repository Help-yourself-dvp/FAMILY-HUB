/**
 * Профиль устройства публикуется в таблицу members (приёмка 0.1.5).
 * Без этой строки цвет автора живёт только в kv: семья и точки у позиций
 * его не видят — владелец менял цвет и не видел ни одной отметки.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../src/data/db';
import { loadSession, updateProfile } from '../src/data/session';

describe('профиль → members', () => {
  it('loadSession создаёт строку members с цветом профиля', async () => {
    const s = await loadSession();
    const row = await db.members.get(s.deviceId);
    expect(row).toBeDefined();
    expect(row?.color).toBe(s.color);
    expect(row?.kind).toBe('members');
  });

  it('смена цвета обновляет строку members и поднимает rev', async () => {
    const before = await loadSession();
    const revBefore = (await db.members.get(before.deviceId))?.rev ?? 0;
    const s = await updateProfile({ color: '#34c98e' });
    const row = await db.members.get(s.deviceId);
    expect(row?.color).toBe('#34c98e');
    expect((row?.rev ?? 0) > revBefore).toBe(true);
  });
});
