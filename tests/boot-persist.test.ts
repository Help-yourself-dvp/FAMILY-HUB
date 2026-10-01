/**
 * Отдельный файл намеренно: vitest изолирует модули по файлам, поэтому здесь
 * `startApp()` исполняется с НЕЗАГРУЖЕННОЙ сессией и пустым хранилищем — ровно так,
 * как это происходит при первом холодном старте на устройстве.
 *
 * Проверяется, что идентификатор устройства действительно записывается в IndexedDB:
 * без этого каждый запуск считал бы устройство новым, а `updatedBy` в сущностях
 * потерял бы смысл (и конфликт-резолвинг по устройству стал бы невозможным).
 */
import { describe, expect, it } from 'vitest';
import { startApp } from '../src/app/startApp';
import { db, kvGet, KV_KEYS } from '../src/data/db';
import { session } from '../src/data/session';

describe('холодный старт: идентичность устройства сохраняется', () => {
  it('записывает deviceId в kv и использует его в данных', async () => {
    expect(await db.shopping.count()).toBe(0);

    await startApp();

    const s = session();
    expect(await kvGet<string>(KV_KEYS.deviceId)).toBe(s.deviceId);
    expect(await kvGet<boolean>('demo.seeded')).toBe(true);

    const rows = await db.shopping.toArray();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.updatedBy === s.deviceId)).toBe(true);
  });
});
