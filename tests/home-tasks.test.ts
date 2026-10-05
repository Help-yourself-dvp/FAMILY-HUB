/**
 * Главная, блок «Ближайшие дела» (просьба владельца 05.10.2026): показывать и дела без
 * даты (в том числе без исполнителя), но ставить их в конец списка, чтобы они не
 * оттесняли срочное.
 */
import { describe, expect, it } from 'vitest';
import { homeTaskList, nearestDatedTasks, taskDateLabel } from '../src/domain/taskRules';
import type { Task } from '../src/domain/types';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    rev: 1,
    kind: 'tasks',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'dev-1',
    deletedAt: null,
    title: 'Дело',
    assigneeId: null,
    dueDate: null,
    status: 'open',
    doneAt: null,
    note: null,
    ...over,
  } as Task;
}

describe('homeTaskList — ближайшие дела на Главной', () => {
  it('сначала датированные по дате, затем без даты — в конце', () => {
    const list = homeTaskList([
      task({ id: 'no-date', title: 'Без даты', dueDate: null }),
      task({ id: 'late', title: 'Позже', dueDate: '2026-12-01' }),
      task({ id: 'soon', title: 'Скоро', dueDate: '2026-10-10', assigneeId: 'm1' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['soon', 'late', 'no-date']);
  });

  it('дело без даты и без исполнителя тоже показывается', () => {
    const list = homeTaskList([task({ id: 'free', dueDate: null, assigneeId: null })]);
    expect(list.map((t) => t.id)).toEqual(['free']);
    expect(taskDateLabel(list[0]?.dueDate ?? null)).toBe('Без срока');
  });

  it('выполненные, удалённые и битые даты в список не попадают', () => {
    const list = homeTaskList([
      task({ id: 'done', status: 'done' }),
      task({ id: 'gone', deletedAt: '2026-10-04T00:00:00.000Z' }),
      task({ id: 'broken', dueDate: 'завтра' }),
      task({ id: 'ok', dueDate: '2026-10-09' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['ok']);
  });

  it('не раздувает экран: до трёх с датой и до трёх без', () => {
    const many = Array.from({ length: 9 }, (_v, n) =>
      task({ id: `d${n}`, dueDate: `2026-11-0${(n % 9) + 1}`, title: `Дело ${n}` }),
    );
    const undated = Array.from({ length: 9 }, (_v, n) => task({ id: `u${n}`, dueDate: null }));
    const list = homeTaskList([...many, ...undated]);
    expect(list.filter((t) => t.dueDate).length).toBe(3);
    expect(list.filter((t) => !t.dueDate).length).toBe(3);
    // Без даты — строго после датированных.
    expect(list.slice(3).every((t) => !t.dueDate)).toBe(true);
  });

  it('порядок внутри группы одинаков на разных телефонах (детерминированный)', () => {
    const rows = [
      task({ id: 'b', dueDate: null, createdAt: '2026-10-02T09:00:00.000Z' }),
      task({ id: 'a', dueDate: null, createdAt: '2026-10-03T09:00:00.000Z' }),
    ];
    expect(homeTaskList(rows).map((t) => t.id)).toEqual(
      homeTaskList([...rows].reverse()).map((t) => t.id),
    );
  });

  it('прежний список «только с датой» не изменился — он ещё используется в тестах', () => {
    const dated = nearestDatedTasks([task({ id: 'd', dueDate: '2026-10-10' }), task({ id: 'u' })]);
    expect(dated.map((t) => t.id)).toEqual(['d']);
  });
});
