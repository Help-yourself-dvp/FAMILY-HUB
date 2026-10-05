/** Два вымышленных устройства, общий fake-remote. Настоящий syncKind без сети. */
import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  syncKind,
  type LocalStorePort,
  type RemoteStorePort,
} from '../src/data/sync/core';
import {
  REMOTE_PATH,
  emptyRemoteFile,
  type EntityKind,
  type RemoteFile,
  type Syncable,
  type Task,
} from '../src/domain/types';

const NOW = '2026-10-03T07:00:00.000Z';
function task(id = 'fixture-task'): Task {
  return {
    id,
    kind: 'tasks',
    rev: 1,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'fixture-A',
    deletedAt: null,
    title: 'Учебное дело',
    note: 'Учебное описание',
    assigneeId: 'fixture-B',
    dueDate: '2026-10-05',
    status: 'open',
    doneAt: null,
    recurrence: { type: 'none' },
  };
}
class Device implements LocalStorePort {
  rows: Record<string, Syncable> = {};
  base: Record<string, number> = {};
  read<T extends Syncable>(kind: EntityKind): Promise<Record<string, T>> {
    expect(kind).toBe('tasks');
    return Promise.resolve({ ...this.rows } as Record<string, T>);
  }
  readBase(): Promise<Record<string, number>> {
    return Promise.resolve({ ...this.base });
  }
  write<T extends Syncable>(_kind: EntityKind, rows: Record<string, T>): Promise<void> {
    this.rows = { ...rows };
    this.base = Object.fromEntries(Object.values(rows).map((row) => [row.id, row.rev]));
    return Promise.resolve();
  }
}
class SharedRemote implements RemoteStorePort {
  file: RemoteFile<Syncable> = emptyRemoteFile();
  sha: string | null = null;
  writes = 0;
  read<T extends Syncable>(kind: EntityKind): Promise<{ file: RemoteFile<T>; sha: string | null }> {
    expect(REMOTE_PATH[kind]).toBe('data/tasks.json');
    return Promise.resolve({ file: this.file as RemoteFile<T>, sha: this.sha });
  }
  write<T extends Syncable>(
    _kind: EntityKind,
    file: RemoteFile<T>,
    sha: string | null,
  ): Promise<string> {
    if (sha !== this.sha) return Promise.reject(new ConflictError());
    this.file = file;
    this.sha = `fixture-${++this.writes}`;
    return Promise.resolve(this.sha);
  }
}
const sync = (device: Device, remote: SharedRemote) =>
  syncKind('tasks', device, remote, { nowIso: () => NOW });

async function familyFixture() {
  const a = new Device(),
    b = new Device(),
    remote = new SharedRemote();
  a.rows = { 'fixture-task': task() };
  await sync(a, remote);
  await sync(b, remote);
  return { a, b, remote };
}

describe('синхронизация Дела', () => {
  it('офлайн-созданное дело уезжает и появляется у второго устройства со всеми полями', async () => {
    const { b, remote } = await familyFixture();
    expect(b.rows['fixture-task']).toMatchObject(task());
    expect(remote.writes).toBe(1);
    expect(remote.file.schemaVersion).toBe(1);
  });

  it('выполнение на втором устройстве приходит первому как completed, не покупка', async () => {
    const { a, b, remote } = await familyFixture();
    b.rows['fixture-task'] = {
      ...task(),
      status: 'done',
      doneAt: '2026-10-03T08:00:00Z',
      rev: 2,
      updatedAt: '2026-10-03T08:00:00Z',
      updatedBy: 'fixture-B',
    } as Task;
    await sync(b, remote);
    const received = await sync(a, remote);
    expect(a.rows['fixture-task']).toMatchObject({ status: 'done', updatedBy: 'fixture-B' });
    expect(received.remoteEvents[0]).toMatchObject({
      action: 'completed',
      meaningful: true,
      actorId: 'fixture-B',
    });
  });

  it('назначение/описание/дата без смены заголовка считаются реальным изменением для ленты', async () => {
    const { a, b, remote } = await familyFixture();
    b.rows['fixture-task'] = {
      ...task(),
      assigneeId: null,
      note: 'Другой учебный текст',
      dueDate: null,
      rev: 2,
      updatedAt: '2026-10-03T08:00:00Z',
      updatedBy: 'fixture-B',
    } as Task;
    await sync(b, remote);
    const received = await sync(a, remote);
    expect(received.remoteEvents[0]).toMatchObject({ action: 'updated', meaningful: true });
    expect(a.rows['fixture-task']).toMatchObject({ assigneeId: null, dueDate: null });
  });

  it('удалённое дело не воскресает от устаревшей копии другого телефона', async () => {
    const { a, b, remote } = await familyFixture();
    a.rows['fixture-task'] = {
      ...task(),
      rev: 2,
      deletedAt: '2026-10-03T08:00:00Z',
      updatedAt: '2026-10-03T08:00:00Z',
    };
    await sync(a, remote);
    await sync(b, remote);
    expect(b.rows['fixture-task']?.deletedAt).toBeTruthy();
    await sync(b, remote);
    await sync(a, remote);
    expect(a.rows['fixture-task'].deletedAt).toBeTruthy();
    expect(remote.file.entities['fixture-task']?.deletedAt).toBeTruthy();
  });

  it('одновременно добавленные разные дела сохраняются оба; повторный цикл не пишет', async () => {
    const a = new Device(),
      b = new Device(),
      remote = new SharedRemote();
    a.rows = { a: task('a') };
    b.rows = { b: { ...task('b'), updatedBy: 'fixture-B' } };
    await sync(a, remote);
    await sync(b, remote);
    await sync(a, remote);
    expect(Object.keys(a.rows).sort()).toEqual(['a', 'b']);
    expect(Object.keys(b.rows).sort()).toEqual(['a', 'b']);
    const before = remote.writes;
    await sync(a, remote);
    await sync(b, remote);
    expect(remote.writes).toBe(before);
  });
});
