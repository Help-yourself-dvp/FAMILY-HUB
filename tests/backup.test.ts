/**
 * Резервная копия: проверка файла, план восстановления и полный круг «копия → очистка →
 * восстановление» (0.6.29). Только fake-indexeddb, ни одного сетевого вызова.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/data/db';
import {
  applyRestore,
  buildBackup,
  parseBackup,
  planRestore,
  type BackupPayload,
} from '../src/data/backup';
import type { ActivityEntry, ShoppingItem, Task } from '../src/domain/types';

const T = (minute: number) => `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`;

function shopping(id: string, over: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id,
    rev: 1,
    createdAt: T(0),
    updatedAt: T(0),
    updatedBy: 'dev-test',
    deletedAt: null,
    kind: 'shopping',
    title: `Позиция ${id}`,
    canonicalKey: `poziciya ${id}`,
    qty: null,
    unit: null,
    category: null,
    store: null,
    horizon: 'soon',
    note: null,
    done: false,
    doneAt: null,
    doneBy: null,
    ...over,
  };
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    rev: 1,
    createdAt: T(0),
    updatedAt: T(0),
    updatedBy: 'dev-test',
    deletedAt: null,
    kind: 'tasks',
    title: `Дело ${id}`,
    note: null,
    assigneeId: null,
    dueDate: null,
    status: 'open',
    doneAt: null,
    recurrence: { type: 'none' },
    ...over,
  };
}

function activity(id: string): ActivityEntry {
  return {
    id,
    at: T(5),
    actorId: 'dev-test',
    actorName: 'Учебный участник',
    kind: 'shopping',
    action: 'created',
    title: 'Учебная запись',
    place: 'Покупки',
  };
}

function payloadWith(data: Partial<BackupPayload['data']>): BackupPayload {
  return {
    app: 'family-hub',
    format: 'family-hub-backup',
    schemaVersion: 1,
    appVersion: '0.6.29',
    exportedAt: T(30),
    data: {
      shopping: [],
      tasks: [],
      deadlines: [],
      members: [],
      activity: [],
      ...data,
    },
  };
}

beforeEach(async () => {
  await Promise.all([
    db.shopping.clear(),
    db.tasks.clear(),
    db.deadlines.clear(),
    db.members.clear(),
    db.activity.clear(),
    db.syncMeta.clear(),
    db.kv.clear(),
  ]);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
});

describe('buildBackup', () => {
  it('собирает файл из локальной базы: формат, версия, все разделы', async () => {
    await db.shopping.bulkPut([shopping('s1'), shopping('s2', { done: true })]);
    await db.tasks.put(task('t1'));
    await db.activity.put(activity('a1'));

    const payload = await buildBackup('0.6.29');

    expect(payload.app).toBe('family-hub');
    expect(payload.format).toBe('family-hub-backup');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.appVersion).toBe('0.6.29');
    expect(payload.exportedAt).toBeTruthy();
    expect(payload.data.shopping).toHaveLength(2);
    expect(payload.data.tasks).toHaveLength(1);
    expect(payload.data.activity).toHaveLength(1);
    // Файл должен читаться тем же кодом, что и восстановление.
    expect(parseBackup(JSON.stringify(payload)).ok).toBe(true);
  });
});

describe('parseBackup', () => {
  it('посторонний файл и мусор отклоняются с понятным текстом', () => {
    expect(parseBackup('не json вовсе')).toMatchObject({ ok: false });
    const wrong = parseBackup(JSON.stringify({ app: 'other', format: 'x' }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain('не резервная копия');
  });

  it('копия из более новой версии приложения не принимается', () => {
    const p = { ...payloadWith({}), schemaVersion: 99 };
    const res = parseBackup(JSON.stringify(p));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('более новой версией приложения');
  });

  it('копия без данных не принимается', () => {
    const res = parseBackup(JSON.stringify({ app: 'family-hub', format: 'family-hub-backup', schemaVersion: 1 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('нет данных');
  });

  it('в копии без раздела ленты остальные разделы читаются', () => {
    const raw = JSON.parse(JSON.stringify(payloadWith({ shopping: [shopping('s1')] }))) as Record<string, unknown>;
    delete (raw.data as Record<string, unknown>).activity;
    const res = parseBackup(JSON.stringify(raw));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.data.activity).toEqual([]);
  });
});

describe('planRestore', () => {
  it('добавляет отсутствующие и не трогает то, что на устройстве новее', async () => {
    await db.shopping.put(shopping('s1', { rev: 5, updatedAt: T(20) }));
    const plan = await planRestore(
      payloadWith({ shopping: [shopping('s1', { rev: 2 }), shopping('s2', { rev: 3 })] }),
    );

    expect(plan.shopping.adds.map((s) => s.id)).toEqual(['s2']);
    expect(plan.shopping.updates).toHaveLength(0);
    expect(plan.totals).toMatchObject({ added: 1, updated: 0, skipped: 1 });
  });

  it('более новая запись из файла обновляет устройство', async () => {
    await db.shopping.put(shopping('s1', { rev: 2, updatedAt: T(1) }));
    const plan = await planRestore(payloadWith({ shopping: [shopping('s1', { rev: 3 })] }));

    expect(plan.shopping.updates.map((s) => s.id)).toEqual(['s1']);
    expect(plan.totals).toMatchObject({ added: 0, updated: 1 });
  });

  it('удалённое позже не воскресает: старое из файла проигрывает по rev', async () => {
    await db.shopping.put(shopping('s1', { rev: 4, deletedAt: T(30) }));
    const plan = await planRestore(payloadWith({ shopping: [shopping('s1', { rev: 3 })] }));
    await applyRestore(plan);

    expect(plan.shopping.adds).toHaveLength(0);
    expect(plan.shopping.updates).toHaveLength(0);
    expect((await db.shopping.get('s1'))?.deletedAt).toBe(T(30));
  });

  it('лента восстанавливается без дублей', async () => {
    await db.activity.put(activity('a1'));
    const plan = await planRestore(payloadWith({ activity: [activity('a1'), activity('a2')] }));

    expect(plan.activity.adds.map((a) => a.id)).toEqual(['a2']);
    expect(plan.activity.skipped).toBe(1);
  });

  it('испорченные записи считаются отдельно и не мешают остальным', async () => {
    const plan = await planRestore(
      payloadWith({ shopping: [shopping('s1'), { id: 'битый' } as unknown as ShoppingItem] }),
    );
    expect(plan.shopping.adds.map((s) => s.id)).toEqual(['s1']);
    expect(plan.totals.skipped).toBe(1);
  });
});

describe('полный круг восстановления', () => {
  it('копия → очистка устройства → восстановление: данные возвращаются', async () => {
    await db.shopping.bulkPut([shopping('s1'), shopping('s2', { done: true, doneAt: T(10) })]);
    await db.tasks.put(task('t1', { rev: 3, title: 'Учебное дело' }));
    await db.activity.put(activity('a1'));

    const backup = await buildBackup('0.6.29');
    const file = JSON.stringify(backup);

    // Полная потеря локальных данных (переустановка, очистка данных сайта).
    await Promise.all([
      db.shopping.clear(),
      db.tasks.clear(),
      db.activity.clear(),
      db.syncMeta.clear(),
    ]);
    expect(await db.shopping.count()).toBe(0);

    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const plan = await planRestore(parsed.payload);
    expect(plan.totals.added).toBe(4);
    await applyRestore(plan);

    expect(await db.shopping.count()).toBe(2);
    expect((await db.tasks.get('t1'))?.title).toBe('Учебное дело');
    expect(await db.activity.count()).toBe(1);
    // Повторное восстановление того же файла ничего не дублирует.
    const again = await planRestore(parsed.payload);
    expect(again.totals.added).toBe(0);
    expect(again.totals.updated).toBe(0);
  });
});
