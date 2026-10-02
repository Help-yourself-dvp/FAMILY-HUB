/**
 * Плашка «приложение обновилось с версии X»: молчаливое применение обновления
 * между запусками остаётся (стандарт PWA и желание владельца), но факт обновления
 * становится видимым. Отдельный файл — ради изоляции модулей и честного kv.
 */
import { describe, expect, it } from 'vitest';
import { startApp } from '../src/app/startApp';
import { db, kvGet, kvSet, KV_KEYS } from '../src/data/db';

describe('updatedFrom', () => {
  it('первый запуск: плашки нет, версия запомнена', async () => {
    expect(await kvGet<string>(KV_KEYS.lastSeenVersion)).toBeUndefined();
    const res = await startApp();
    expect(res.updatedFrom).toBeNull();
    expect(await kvGet<string>(KV_KEYS.lastSeenVersion)).toBe(__APP_VERSION__);
  });

  it('запуск после обновления: показываем, с какой версии пришли', async () => {
    await kvSet(KV_KEYS.lastSeenVersion, '0.0.9');
    const res = await startApp();
    expect(res.updatedFrom).toBe('0.0.9');
    expect(await kvGet<string>(KV_KEYS.lastSeenVersion)).toBe(__APP_VERSION__);
  });

  it('обновление с версии, не записывавшей номер: плашка без прежней версии', async () => {
    // Данные в базе уже есть (не первая установка), но kv последней версии пуст —
    // так выглядит устройство, пришедшее с 0.1.3 и ниже.
    await db.kv.delete(KV_KEYS.lastSeenVersion);
    const res = await startApp();
    expect(res.updatedFrom).toBe('unknown');
    expect(await kvGet<string>(KV_KEYS.lastSeenVersion)).toBe(__APP_VERSION__);
  });

  it('повторный запуск той же версии: плашки нет', async () => {
    const res = await startApp();
    expect(res.updatedFrom).toBeNull();
  });

  it('демо-данные при этом не пересоздаются', async () => {
    const before = await db.shopping.count();
    await startApp();
    expect(await db.shopping.count()).toBe(before);
  });
});
