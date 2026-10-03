/** База «Дела»: date-only и фильтрация, без второго движка напоминаний/рекурренции. */
import { daysUntil, formatRu, humanizeDelta, isDateOnly, today, type DateOnly } from './dateOnly';
import type { Task } from './types';

export type TaskFilter = 'all' | 'mine' | 'unassigned';

export function matchesTaskFilter(task: Task, filter: TaskFilter, selfId: string): boolean {
  if (filter === 'mine') return task.assigneeId === selfId;
  if (filter === 'unassigned') return !task.assigneeId;
  return true;
}

export function taskDateLabel(dueDate: DateOnly | null, from: DateOnly = today()): string {
  if (!dueDate) return 'Без срока';
  if (!isDateOnly(dueDate)) return 'Проверьте дату';
  const left = daysUntil(dueDate, from);
  return `${formatRu(dueDate)} · ${left < 0 ? `просрочено: ${humanizeDelta(left)}` : humanizeDelta(left)}`;
}

/** Датированные сначала, без срока после них; детерминированный порядок на телефонах. */
export function compareOpenTasks(a: Task, b: Task): number {
  const aDate = isDateOnly(a.dueDate) ? a.dueDate : null;
  const bDate = isDateOnly(b.dueDate) ? b.dueDate : null;
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
  return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}
