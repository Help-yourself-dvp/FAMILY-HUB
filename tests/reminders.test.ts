/**
 * Напоминания о сроках (ЭТАП 6-минимум): ступени срабатывают ровно в свой день,
 * просрочка напоминает один раз, пустой список ступеней молчит.
 */
import { describe, expect, it } from 'vitest';
import { reminderHits } from '../src/notifications/remindersWatch';
import type { Deadline } from '../src/domain/types';

function dl(dueDate: string, remindersDays: number[]): Deadline {
  return {
    id: 'd1',
    rev: 1,
    kind: 'deadlines',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'dev-1',
    deletedAt: null,
    title: 'Паспорт',
    deadlineKind: 'document',
    dueDate,
    remindersDays,
    recurrence: { type: 'none' },
    lastCompletedAt: null,
    history: [],
    visibility: 'family',
    note: null,
  };
}

describe('reminderHits', () => {
  it('срабатывает ровно в день ступени', () => {
    const d = dl('2026-10-08', [30, 7, 0]);
    expect(reminderHits(d, '2026-10-01')).toEqual([7]);
    expect(reminderHits(d, '2026-10-08')).toEqual([0]);
    expect(reminderHits(d, '2026-10-02')).toEqual([]);
  });
  it('просрочка напоминает один раз', () => {
    const d = dl('2026-09-01', [7, 0]);
    expect(reminderHits(d, '2026-10-01')).toEqual(['overdue']);
    expect(reminderHits(d, '2026-10-02')).toEqual(['overdue']);
  });
  it('пустой список ступеней молчит', () => {
    expect(reminderHits(dl('2026-10-01', []), '2026-10-01')).toEqual([]);
    expect(reminderHits(dl('2026-09-01', []), '2026-10-01')).toEqual([]);
  });
});
