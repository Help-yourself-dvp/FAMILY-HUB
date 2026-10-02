/**
 * Цветовые правила сроков (приёмка 0.3.2): пресеты по типу и ручные пороги.
 */
import { describe, expect, it } from 'vitest';
import { deadlineTone, thresholdsFor } from '../src/domain/deadlineRules';
import type { Deadline } from '../src/domain/types';

function dl(dueDate: string, patch: Partial<Deadline> = {}): Deadline {
  return {
    id: 'd',
    rev: 1,
    kind: 'deadlines',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'dev-1',
    deletedAt: null,
    title: 'Налог',
    deadlineKind: 'custom',
    dueDate,
    remindersDays: [7, 0],
    recurrence: { type: 'none' },
    lastCompletedAt: null,
    history: [],
    visibility: 'family',
    note: null,
    ...patch,
  };
}

describe('deadlineTone', () => {
  it('просрочка всегда красная', () => {
    expect(deadlineTone(dl('2026-09-30'), '2026-10-01')).toBe('overdue');
  });
  it('пресет типа: налог(custom) красный за 7, жёлтый за 30', () => {
    expect(deadlineTone(dl('2026-10-08'), '2026-10-01')).toBe('alert'); // 7 дней
    expect(deadlineTone(dl('2026-10-15'), '2026-10-01')).toBe('warn'); // 14 дней
    expect(deadlineTone(dl('2026-12-01'), '2026-10-01')).toBe('ok'); // 61 день
  });
  it('документ: жёлтый уже за год', () => {
    expect(deadlineTone(dl('2027-06-01', { deadlineKind: 'document' }), '2026-10-01')).toBe('warn');
    expect(thresholdsFor(dl('2027-01-01', { deadlineKind: 'document' }))).toEqual({
      alertDays: 90,
      warnDays: 365,
    });
  });
  it('ручные пороги переопределяют пресет', () => {
    const d = dl('2026-10-15', { alertDays: 20, warnDays: 60 });
    expect(deadlineTone(d, '2026-10-01')).toBe('alert'); // 14 <= 20
    expect(thresholdsFor(d)).toEqual({ alertDays: 20, warnDays: 60 });
  });
});
