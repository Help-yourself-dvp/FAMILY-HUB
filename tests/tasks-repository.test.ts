/** Новые дела: только fake-indexeddb/вымышленные поля, ни одного сетевого вызова. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { appendActivity, tasksRepo } from '../src/data/repositories';
import { loadSession } from '../src/data/session';
import { ACTIVE_SYNC_KINDS, countPending } from '../src/data/sync/engine';
import { matchesTaskFilter, compareOpenTasks, taskDateLabel } from '../src/domain/taskRules';

beforeEach(async () => {
  await Promise.all([
    db.tasks.clear(),
    db.shopping.clear(),
    db.deadlines.clear(),
    db.members.clear(),
    db.activity.clear(),
    db.syncMeta.clear(),
    db.kv.clear(),
  ]);
  await kvSet(KV_KEYS.profileName, 'Учебный участник');
  await loadSession();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
});

afterEach(() => vi.unstubAllGlobals());

describe('tasksRepo', () => {
  it('создаёт полноценную синхронизируемую запись без обязательной даты/исполнителя', async () => {
    const task = await tasksRepo.add({ title: '  Учебное дело  ' });
    expect(task).toMatchObject({
      title: 'Учебное дело',
      kind: 'tasks',
      rev: 1,
      status: 'open',
      note: null,
      assigneeId: null,
      dueDate: null,
      doneAt: null,
      recurrence: { type: 'none' },
      deletedAt: null,
    });
    expect(task.createdAt).toBe(task.updatedAt);
    expect(task.updatedBy).toBeTruthy();
    expect((await db.activity.toArray())[0]).toMatchObject({
      kind: 'tasks',
      place: 'Дела',
      action: 'created',
    });
  });

  it('сохраняет описание, назначение и date-only без timezone-конвертации', async () => {
    const task = await tasksRepo.add({
      title: 'Дело',
      note: '  Учебное описание  ',
      dueDate: '2028-02-29',
      assigneeId: 'fixture-peer',
    });
    expect(task).toMatchObject({
      note: 'Учебное описание',
      dueDate: '2028-02-29',
      assigneeId: 'fixture-peer',
    });
  });

  it('пустое название и невозможная дата не создают строки', async () => {
    await expect(tasksRepo.add({ title: '   ' })).rejects.toThrow(/Напишите/u);
    await expect(tasksRepo.add({ title: 'Дело', dueDate: '2026-02-30' })).rejects.toThrow(/дату/u);
    expect(await db.tasks.count()).toBe(0);
    expect(await db.activity.count()).toBe(0);
  });

  it('редактирование увеличивает rev, оставляет createdAt/статус/расширенные поля', async () => {
    const task = await tasksRepo.add({ title: 'Дело' });
    await db.tasks.update(task.id, { recurrence: { type: 'yearly' } });
    await tasksRepo.update(task.id, {
      note: 'Описание',
      dueDate: '2027-04-01',
      assigneeId: 'fixture-peer',
    });
    expect(await db.tasks.get(task.id)).toMatchObject({
      rev: 2,
      status: 'open',
      createdAt: task.createdAt,
      recurrence: { type: 'yearly' },
      note: 'Описание',
      assigneeId: 'fixture-peer',
    });
  });

  it('два одновременных setDone(true) — одно выполнение/одна версия', async () => {
    const task = await tasksRepo.add({ title: 'Дело' });
    await Promise.all([tasksRepo.setDone(task.id, true), tasksRepo.setDone(task.id, true)]);
    const completed = await db.tasks.get(task.id);
    expect(completed).toMatchObject({ rev: 2, status: 'done' });
    expect(completed?.doneAt).toBeTruthy();
    expect(
      (await db.activity.toArray()).filter((entry) => entry.action === 'completed').length,
    ).toBe(1);
  });

  it('возврат в работу очищает doneAt и не записывает completed', async () => {
    const task = await tasksRepo.add({ title: 'Дело' });
    await tasksRepo.setDone(task.id, true);
    await tasksRepo.setDone(task.id, false);
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'open', rev: 3, doneAt: null });
    expect((await db.activity.toArray()).filter((entry) => entry.action === 'updated').length).toBe(
      1,
    );
  });

  it('удаление — tombstone, повтор/правка/выполнение не воскрешают его', async () => {
    const task = await tasksRepo.add({ title: 'Дело' });
    await tasksRepo.remove(task.id);
    await tasksRepo.remove(task.id);
    await tasksRepo.update(task.id, { title: 'Не должно воскреснуть' });
    await tasksRepo.setDone(task.id, true);
    expect(await db.tasks.get(task.id)).toMatchObject({ title: 'Дело', rev: 2, status: 'open' });
    expect((await db.tasks.get(task.id))?.deletedAt).toBeTruthy();
  });

  it('неизменённый patch — не повышает rev и не создаёт служебных событий', async () => {
    const task = await tasksRepo.add({ title: 'Дело' });
    await tasksRepo.update(task.id, { title: 'Дело' });
    expect((await db.tasks.get(task.id))?.rev).toBe(1);
    expect(await db.activity.count()).toBe(1);
  });

  it('лента не склеивает одноимённые покупку и дело, tasks.kind сохранён', async () => {
    await appendActivity('created', 'Учебное название', undefined, { kind: 'shopping' });
    await tasksRepo.add({ title: 'Учебное название' });
    expect((await db.activity.toArray()).map((entry) => entry.kind).sort()).toEqual([
      'shopping',
      'tasks',
    ]);
  });

  it('дела включены в настоящий планировщик и очередь офлайн-изменений', async () => {
    const task = await tasksRepo.add({ title: 'Дело офлайн' });
    expect(ACTIVE_SYNC_KINDS).toContain('tasks');
    expect(await countPending()).toBe(1);
    await db.syncMeta.put({
      key: `tasks:${task.id}`,
      kind: 'tasks',
      id: task.id,
      rev: 1,
      syncedAt: task.updatedAt,
    });
    expect(await countPending()).toBe(0);
    await tasksRepo.setDone(task.id, true);
    expect(await countPending()).toBe(1);
  });
});

describe('чистые правила дел', () => {
  it('фильтры Все / Мои / Без исполнителя не теряют другие записи', async () => {
    const own = await tasksRepo.add({ title: 'Своё', assigneeId: 'fixture-self' });
    const none = await tasksRepo.add({ title: 'Общее' });
    expect(matchesTaskFilter(own, 'all', 'fixture-other')).toBe(true);
    expect(matchesTaskFilter(own, 'mine', 'fixture-self')).toBe(true);
    expect(matchesTaskFilter(own, 'mine', 'fixture-other')).toBe(false);
    expect(matchesTaskFilter(none, 'unassigned', 'fixture-self')).toBe(true);
  });

  it('сроки сортируются раньше недатированных, рано/поздно — календарные строки', async () => {
    const none = await tasksRepo.add({ title: 'Без даты' });
    const late = await tasksRepo.add({ title: 'Позже', dueDate: '2027-12-01' });
    const early = await tasksRepo.add({ title: 'Раньше', dueDate: '2027-02-01' });
    expect([none, late, early].sort(compareOpenTasks).map((task) => task.title)).toEqual([
      'Раньше',
      'Позже',
      'Без даты',
    ]);
  });

  it('сегодня/просрочка/без срока используют общий dateOnly', () => {
    expect(taskDateLabel(null, '2026-10-03')).toBe('Без срока');
    expect(taskDateLabel('2026-10-03', '2026-10-03')).toBe('03.10.2026 · сегодня');
    expect(taskDateLabel('2026-10-02', '2026-10-03')).toContain('просрочено');
    expect(taskDateLabel('bad')).toBe('Проверьте дату');
  });
});
