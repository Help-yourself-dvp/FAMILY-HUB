/**
 * Правила Главной (07.10.2026): «Требует внимания» и когда сверху нужен баннер
 * синхронизации. Чистые функции из `src/domain/homeStatus.ts` — без DOM и сети.
 */
import { describe, expect, it } from 'vitest';
import {
  attentionRows,
  syncNote,
  syncProblem,
  type SyncStatusLike,
} from '../src/domain/homeStatus';
import type { Deadline, Task } from '../src/domain/types';

function dayShift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const deadline = (over: Partial<Deadline> & { id: string; title: string }): Deadline =>
  ({
    rev: 1,
    kind: 'deadlines',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'me',
    deletedAt: null,
    deadlineKind: 'custom',
    dueDate: dayShift(30),
    remindersDays: [7, 0],
    recurrence: { type: 'none' },
    history: [],
    visibility: 'family',
    note: null,
    alertDays: null,
    warnDays: null,
    ...over,
  }) as Deadline;

const task = (over: Partial<Task> & { id: string; title: string }): Task =>
  ({
    rev: 1,
    kind: 'tasks',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'me',
    deletedAt: null,
    note: null,
    assigneeId: null,
    dueDate: null,
    status: 'open',
    doneAt: null,
    ...over,
  }) as Task;

const synced: SyncStatusLike = {
  phase: 'synced',
  configured: true,
  pendingCount: 0,
  lastError: null,
};

describe('attentionRows', () => {
  it('всё в порядке — блок пуст (на экране его не будет)', () => {
    expect(
      attentionRows({
        deadlines: [deadline({ id: 'd1', title: 'Учебный техосмотр' })],
        tasks: [task({ id: 't1', title: 'Учебное дело', dueDate: dayShift(3) })],
        configured: true,
      }),
    ).toEqual([]);
  });

  it('просроченный срок и просроченное дело — отдельные строки со своими разделами', () => {
    const rows = attentionRows({
      deadlines: [deadline({ id: 'd1', title: 'Учебный техосмотр', dueDate: dayShift(-2) })],
      tasks: [task({ id: 't1', title: 'Учебная оплата', dueDate: dayShift(-1) })],
      configured: true,
    });
    expect(rows.map((r) => r.text)).toEqual([
      'Просрочен срок: Учебный техосмотр',
      'Просрочено дело: Учебная оплата',
    ]);
    expect(rows[0]?.to).toBe('/deadlines');
    expect(rows[1]?.to).toBe('/tasks');
  });

  it('несколько просроченных — одной строкой со счётчиком', () => {
    const rows = attentionRows({
      deadlines: [
        deadline({ id: 'd1', title: 'Первый', dueDate: dayShift(-2) }),
        deadline({ id: 'd2', title: 'Второй', dueDate: dayShift(-5) }),
      ],
      tasks: [],
      configured: true,
    });
    expect(rows.map((r) => r.text)).toEqual(['Просрочено сроков: 2']);
  });

  it('дело на сегодня показывается, дело на завтра — нет', () => {
    const rows = attentionRows({
      deadlines: [],
      tasks: [
        task({ id: 't1', title: 'Сегодняшнее', dueDate: dayShift(0) }),
        task({ id: 't2', title: 'Завтрашнее', dueDate: dayShift(1) }),
        task({ id: 't3', title: 'Без даты' }),
      ],
      configured: true,
    });
    expect(rows.map((r) => r.text)).toEqual(['Сегодня дело: Сегодняшнее']);
  });

  it('выполненные и удалённые дела не считаются', () => {
    const rows = attentionRows({
      deadlines: [],
      tasks: [
        task({ id: 't1', title: 'Выполнено', dueDate: dayShift(-1), status: 'done' }),
        task({
          id: 't2',
          title: 'Удалено',
          dueDate: dayShift(-1),
          deletedAt: '2026-10-05T00:00:00.000Z',
        }),
      ],
      configured: true,
    });
    expect(rows).toEqual([]);
  });

  it('без подключения строка ведёт в «Ещё» (настройки)', () => {
    const rows = attentionRows({ deadlines: [], tasks: [], configured: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('Данные только на этом телефоне');
    expect(rows[0]?.to).toBe('/settings');
  });
});

describe('syncProblem и syncNote', () => {
  it('исправное состояние — баннера нет', () => {
    expect(syncProblem(synced)).toBe(false);
    expect(syncNote(synced)).toBeNull();
  });

  it('«Сохранено», но есть очередь — предупреждение со счётчиком', () => {
    const s: SyncStatusLike = { ...synced, phase: 'idle', pendingCount: 3 };
    expect(syncProblem(s)).toBe(true);
    expect(syncNote(s)).toMatchObject({ tone: 'warn', title: 'Ждут отправки: 3' });
  });

  it('нет подключения — «Данные только на этом телефоне»', () => {
    const s: SyncStatusLike = { ...synced, configured: false, phase: 'not-configured' };
    expect(syncNote(s)?.title).toBe('Данные только на этом телефоне');
  });

  it('нет сети — предупреждение, а не ошибка', () => {
    const s: SyncStatusLike = { ...synced, phase: 'offline' };
    expect(syncNote(s)).toMatchObject({ tone: 'warn', title: 'Нет сети' });
  });

  it('ошибка — красный баннер с кодом и текстом ошибки', () => {
    const s: SyncStatusLike = {
      ...synced,
      phase: 'error',
      lastError: { code: 'E401', message: 'Ключ истёк' },
    };
    expect(syncNote(s)).toMatchObject({ tone: 'err', title: 'Синхронизация не работает' });
    expect(syncNote(s)?.detail).toBe('E401: Ключ истёк');
  });
});
