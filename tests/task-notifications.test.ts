/** Правила адресности, дедупликация, только синтетические поля и mock transport. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { loadSession } from '../src/data/session';
import { tasksRepo } from '../src/data/repositories';
import { taskNotificationEvents } from '../src/domain/taskNotificationRules.mjs';
import { runTaskNotificationCheck } from '../src/notifications/tasksWatch';
import { sendTaskPush } from '../scripts/task-push.mjs';
import { nearestDatedTasks } from '../src/domain/taskRules';
import type { Task } from '../src/domain/types';

const TODAY = '2026-10-03';
function task(patch: Partial<Task> = {}): Task {
  return {
    id: 'fixture-task',
    kind: 'tasks',
    rev: 1,
    createdAt: '2026-10-03T07:00:00Z',
    updatedAt: '2026-10-03T07:00:00Z',
    updatedBy: 'fixture-other',
    deletedAt: null,
    title: 'Учебное поручение',
    note: null,
    status: 'open',
    dueDate: TODAY,
    doneAt: null,
    assigneeId: 'fixture-self',
    recurrence: { type: 'none' },
    assignmentId: 'fixture-assignment',
    assignedBy: 'fixture-other',
    assignedAt: '2026-10-03T07:00:00Z',
    ...patch,
  };
}
let selfId = '';
const show = vi.fn<(title: string, options: NotificationOptions) => Promise<void>>();
beforeEach(async () => {
  await Promise.all([db.kv.clear(), db.tasks.clear(), db.members.clear(), db.activity.clear()]);
  await kvSet(KV_KEYS.profileName, 'Учебный участник');
  selfId = (await loadSession()).deviceId;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T09:00:00Z'));
  show.mockReset().mockResolvedValue();
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({
        scope: 'https://fixture.example/FAMILY-HUB/',
        showNotification: show,
      }),
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const events = (patch: Partial<Task> = {}) =>
  taskNotificationEvents(task(patch), ['fixture-self'], TODAY);
describe('правило пользователя для дел', () => {
  it('назначение другим + дата сегодня дают два разных смысловых события', () => {
    expect(events().map((event) => event.kind)).toEqual(['assigned', 'due']);
    expect(events()[0]?.tag).not.toBe(events()[1]?.tag);
  });
  it('назначение себе не уведомляет о назначении, но дата действует', () => {
    expect(events({ assignedBy: 'fixture-self' }).map((event) => event.kind)).toEqual(['due']);
  });
  it('без исполнителя — ни назначение, ни дата', () => {
    expect(events({ assigneeId: null })).toEqual([]);
  });
  it('чужое, выполненное и удалённое дело молчат', () => {
    expect(events({ assigneeId: 'fixture-peer' })).toEqual([]);
    expect(events({ status: 'done' })).toEqual([]);
    expect(events({ deletedAt: '2026-10-03T08:00:00Z' })).toEqual([]);
  });
  it('без даты назначение остаётся единственным, будущая дата ещё не сработала', () => {
    expect(events({ dueDate: null }).map((event) => event.kind)).toEqual(['assigned']);
    expect(events({ dueDate: '2026-10-04' }).map((event) => event.kind)).toEqual(['assigned']);
  });
  it('старые задачи не получают выдуманную рассылку назначения', () => {
    expect(events({ assignmentId: null, assignedBy: null }).map((event) => event.kind)).toEqual([
      'due',
    ]);
  });
  it('title/note/rev-правки не меняют назначение, новое assignmentId даёт новый tag', () => {
    expect(events({ title: 'Другая правка', rev: 2 })[0]?.tag).toBe(events()[0]?.tag);
    expect(events({ assignmentId: 'new' })[0]?.tag).not.toBe(events()[0]?.tag);
  });
});

describe('локальные уведомления только получателя', () => {
  it('показывает один раз после синхронизации и ведёт в Дела', async () => {
    await db.tasks.put(task({ assigneeId: selfId, dueDate: null }));
    expect(await runTaskNotificationCheck()).toBe(1);
    expect(show.mock.calls[0]?.[1]).toMatchObject({ data: { route: '#/tasks' } });
    expect(await runTaskNotificationCheck()).toBe(0);
  });
  it('чужое и неназначенное не показывается на этом устройстве', async () => {
    await db.tasks.bulkPut([
      task({ assigneeId: null }),
      task({ id: 'other', assigneeId: 'fixture-peer' }),
    ]);
    expect(await runTaskNotificationCheck()).toBe(0);
    expect(show).not.toHaveBeenCalled();
  });
  it('сбой показа не помечается успехом, следующая попытка срабатывает', async () => {
    await db.tasks.put(task({ assigneeId: selfId, dueDate: null }));
    show.mockRejectedValueOnce(new Error('Fixture show failure'));
    expect(await runTaskNotificationCheck()).toBe(0);
    expect(await runTaskNotificationCheck()).toBe(1);
  });
  it('полученный push не дублируется локально при открытии', async () => {
    const current = task({ assigneeId: selfId, dueDate: null });
    await db.tasks.put(current);
    const event = taskNotificationEvents(current, [selfId], TODAY)[0]!;
    await kvSet(`remind.push.${event.tag}`, true);
    expect(await runTaskNotificationCheck()).toBe(0);
    expect(show).not.toHaveBeenCalled();
  });
});

describe('метаданные назначения не зависят от обычного editedBy', () => {
  it('новое назначение хранит автора/nonce, обычная правка их сохраняет', async () => {
    const created = await tasksRepo.add({ title: 'Дело', assigneeId: 'fixture-peer' });
    expect(created.assignmentId).toBeTruthy();
    expect(created.assignedBy).toBe(selfId);
    await tasksRepo.update(created.id, { note: 'Только описание' });
    expect((await db.tasks.get(created.id))?.assignmentId).toBe(created.assignmentId);
    await tasksRepo.update(created.id, { assigneeId: null });
    expect((await db.tasks.get(created.id))?.assignmentId).toBeNull();
    await tasksRepo.update(created.id, { assigneeId: 'fixture-peer' });
    expect((await db.tasks.get(created.id))?.assignmentId).not.toBe(created.assignmentId);
  });
});

describe('server адресный, не broadcast', () => {
  it('отправляет только исполнителю, после mark второй цикл пропускается', async () => {
    const markers = new Set<string>();
    const send = vi.fn().mockResolvedValue({});
    const ports = {
      send,
      wasSent: (marker: string) => Promise.resolve(markers.has(marker)),
      markSent: (marker: string) => {
        markers.add(marker);
        return Promise.resolve();
      },
    };
    const subs = [
      { deviceId: 'fixture-self', sub: {} },
      { deviceId: 'fixture-peer', sub: {} },
    ];
    expect(await sendTaskPush([task({ dueDate: null })], subs, TODAY, ports)).toMatchObject({
      accepted: 1,
      failed: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(send.mock.calls[0]?.[1]))).toMatchObject({ route: '#/tasks' });
    expect(await sendTaskPush([task({ dueDate: null })], subs, TODAY, ports)).toMatchObject({
      accepted: 0,
      skipped: 1,
    });
  });
  it('сбой одного устройства не записывает его маркер и не блокирует retry', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('private endpoint must not appear'))
      .mockResolvedValue({});
    const markers = new Set<string>();
    const ports = {
      send,
      wasSent: (marker: string) => Promise.resolve(markers.has(marker)),
      markSent: (marker: string) => {
        markers.add(marker);
        return Promise.resolve();
      },
    };
    const subs = [{ deviceId: 'fixture-self', sub: {} }];
    const first = await sendTaskPush([task({ dueDate: null })], subs, TODAY, ports);
    expect(first).toEqual({ accepted: 0, skipped: 0, failed: 1 });
    expect(markers.size).toBe(0);
    expect(JSON.stringify(first)).not.toContain('endpoint');
    expect((await sendTaskPush([task({ dueDate: null })], subs, TODAY, ports)).accepted).toBe(1);
  });
  it('memberId алиас подписки получает дело, чужой device не подменяет исполнителя', async () => {
    const send = vi.fn().mockResolvedValue({});
    const result = await sendTaskPush(
      [task({ dueDate: null })],
      [{ deviceId: 'fixture-device', memberId: 'fixture-self', sub: {} }],
      TODAY,
      { send, wasSent: () => Promise.resolve(false), markSent: () => Promise.resolve() },
    );
    expect(result.accepted).toBe(1);
  });
});

it('ближайшие дела: только открытые датированные, правильный порядок/лимит', () => {
  const rows = [
    task({ id: 'none', dueDate: null }),
    task({ id: 'done', status: 'done' }),
    task({ id: 'removed', deletedAt: 'x' }),
    task({ id: 'later', dueDate: '2026-10-05' }),
    task({ id: 'now' }),
  ];
  expect(nearestDatedTasks(rows).map((row) => row.id)).toEqual(['now', 'later']);
  expect(nearestDatedTasks(rows, 1).map((row) => row.id)).toEqual(['now']);
});
