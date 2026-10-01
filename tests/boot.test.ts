/**
 * Порядок запуска приложения.
 *
 * Этот тест существует из-за реального дефекта, найденного 2026-10-01 на Honor Magic 8 Pro:
 * при ПЕРВОМ запуске приложение падало с «Сессия не инициализирована: сначала loadSession()»,
 * потому что демо-данные сажались до загрузки сессии. Домен-логика была покрыта тестами,
 * а порядок инициализации — нет, поэтому дефект доехал до устройства владельца.
 *
 * Инвариант, который здесь зафиксирован: **сначала сессия, потом любая запись в данные.**
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { startApp } from '../src/app/startApp';
import { db, kvGet } from '../src/data/db';
import { session } from '../src/data/session';
import { shoppingRepo } from '../src/data/repositories';

beforeEach(async () => {
  // Чистое хранилище = «первый запуск на устройстве».
  await db.transaction('rw', [db.shopping, db.tasks, db.deadlines, db.members, db.kv], async () => {
    await Promise.all([db.shopping.clear(), db.tasks.clear(), db.deadlines.clear(), db.members.clear(), db.kv.clear()]);
  });
});

describe('startApp — первый запуск на устройстве', () => {
  it('не бросает исключение (регрессия дефекта «Сессия не инициализирована»)', async () => {
    await expect(startApp()).resolves.toBeTruthy();
  });

  it('после запуска сессия доступна синхронно', async () => {
    await startApp();
    const s = session();
    expect(s.deviceId).toMatch(/./);
    expect(s.name).toBe('Я'); // имя по умолчанию проставляется на первом запуске
  });

  it('демо-данные сажаются ПОСЛЕ сессии и несут её deviceId', async () => {
    await startApp();
    const rows = await db.shopping.toArray();
    expect(rows.length).toBeGreaterThan(0);
    const s = session();
    for (const r of rows) {
      expect(r.updatedBy).toBe(s.deviceId);
      expect(r.note).toBe('демо'); // обязаны быть очевидно демонстрационными (ТЗ §35 E)
    }
    expect(await kvGet<boolean>('demo.seeded')).toBe(true);
  });

  it('запись через репозиторий сразу после запуска работает', async () => {
    await startApp();
    const item = await shoppingRepo.add({ title: 'Проверка после запуска' });
    expect(item.updatedBy).toBe(session().deviceId);
    expect(await db.shopping.get(item.id)).toBeTruthy();
  });

  it('локальный режим: без репозитория синхронизация честно помечена ненастроенной', async () => {
    const { config } = await startApp();
    expect(config.remote).toBeNull();
    expect(config.hasToken).toBe(false);
  });
});

describe('startApp — повторный запуск', () => {
  it('идемпотентен: демо-данные не дублируются', async () => {
    await startApp();
    const first = await db.shopping.count();
    await startApp();
    const second = await db.shopping.count();
    expect(second).toBe(first);
  });

  it('повторный startApp в пределах жизни приложения не меняет идентичность', async () => {
    await startApp();
    const first = session().deviceId;
    await startApp();
    expect(session().deviceId).toBe(first);
    // Примечание: kv здесь не сверяем — beforeEach этого файла очищает хранилище
    // между тестами, а кэш сессии живёт в модуле. В реальном запуске хранилище
    // из-под работающего приложения никто не очищает.
  });
});
