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

/** Главная: только открытые/неудалённые с корректной датой, без недатированных. */
export function nearestDatedTasks(tasks: Task[], limit = 3): Task[] {
  return tasks
    .filter((task) => !task.deletedAt && task.status === 'open' && isDateOnly(task.dueDate))
    .sort(compareOpenTasks)
    .slice(0, limit);
}

/**
 * Главная: список «Ближайшие дела» (просьба владельца 05.10.2026).
 * Сначала дела с датой (как раньше, ближайшие), затем — дела без даты (в том числе без
 * исполнителя): они не теряются, но и не оттесняют срочное. Порядок внутри группы
 * детерминированный (compareOpenTasks), поэтому на разных телефонах список одинаков.
 */
export function homeTaskList(tasks: Task[], datedLimit = 3, undatedLimit = 3): Task[] {
  const open = tasks.filter((task) => !task.deletedAt && task.status === 'open');
  const dated = open
    .filter((task) => isDateOnly(task.dueDate))
    .sort(compareOpenTasks)
    .slice(0, datedLimit);
  // «Без даты» — это именно отсутствие даты; задача с испорченной датой остаётся в
  // разделе «Дела», чтобы на Главной не путать её с планом без срока.
  const undated = open
    .filter((task) => !task.dueDate)
    .sort(compareOpenTasks)
    .slice(0, undatedLimit);
  return [...dated, ...undated];
}

/** Сортировка дел (просьба владельца 06.10.2026: не только по сроку). */
export type TaskSort = 'due' | 'assignee' | 'title' | 'created';

export const TASK_SORT_LABEL: Record<TaskSort, string> = {
  due: 'По сроку',
  assignee: 'По исполнителю',
  title: 'По названию',
  created: 'Сначала новые',
};

/**
 * Порядок открытых дел. Имя исполнителя передаёт экран (`assigneeName`): домен не знает
 * про базу участников. Внутри группы — `compareOpenTasks`, чтобы порядок был
 * детерминированным и одинаковым на телефонах.
 */
export function sortOpenTasks(
  tasks: Task[],
  sort: TaskSort,
  assigneeName: (id: string | null) => string,
): Task[] {
  const copy = [...tasks];
  switch (sort) {
    case 'assignee':
      return copy.sort(
        (a, b) => assigneeName(a.assigneeId).localeCompare(assigneeName(b.assigneeId), 'ru') || compareOpenTasks(a, b),
      );
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'ru') || compareOpenTasks(a, b));
    case 'created':
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    default:
      return copy.sort(compareOpenTasks);
  }
}
