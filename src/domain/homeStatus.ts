/**
 * Правила Главной (07.10.2026): что попадает в «Требует внимания» и когда сверху
 * нужен баннер синхронизации. Вынесено из экрана чистыми функциями — их проверяют
 * тесты без DOM, а экран остаётся простым.
 */
import { daysUntil, isDateOnly } from './dateOnly';
import { deadlineTone } from './deadlineRules';
import type { Deadline, Task } from './types';

export interface AttentionRow {
  id: string;
  text: string;
  hint: string;
  /** Куда ведёт строка. */
  to: '/deadlines' | '/tasks' | '/settings';
}

/** Минимум от состояния синхронизации, нужный Главной (без зависимости от слоя данных). */
export interface SyncStatusLike {
  phase: 'idle' | 'offline' | 'syncing' | 'synced' | 'error' | 'not-configured';
  configured: boolean;
  pendingCount: number;
  lastError: { code: string; message: string } | null;
}

export interface SyncNote {
  tone: 'warn' | 'err';
  title: string;
  detail: string;
}

/**
 * Строки блока «Требует внимания». Пустой список — блока на экране нет: Главная не
 * должна начинаться с предупреждений, если всё в порядке.
 */
export function attentionRows({
  deadlines,
  tasks,
  configured,
}: {
  deadlines: Deadline[];
  tasks: Task[];
  configured: boolean;
}): AttentionRow[] {
  const rows: AttentionRow[] = [];

  const late = deadlines.filter((d) => !d.deletedAt && deadlineTone(d) === 'overdue');
  if (late.length > 0) {
    rows.push({
      id: 'deadlines',
      text:
        late.length === 1
          ? `Просрочен срок: ${late[0]?.title ?? ''}`
          : `Просрочено сроков: ${late.length}`,
      hint: 'Откройте раздел «Сроки» — можно сдвинуть дату или закрыть',
      to: '/deadlines',
    });
  }

  const open = tasks.filter((t) => !t.deletedAt && t.status === 'open');
  const lateTasks = open.filter((t) => isDateOnly(t.dueDate) && daysUntil(t.dueDate) < 0);
  if (lateTasks.length > 0) {
    rows.push({
      id: 'late-tasks',
      text:
        lateTasks.length === 1
          ? `Просрочено дело: ${lateTasks[0]?.title ?? ''}`
          : `Просрочено дел: ${lateTasks.length}`,
      hint: 'Отметьте выполнение или перенесите срок',
      to: '/tasks',
    });
  }

  const todayTasks = open.filter((t) => isDateOnly(t.dueDate) && daysUntil(t.dueDate) === 0);
  if (todayTasks.length > 0) {
    rows.push({
      id: 'today-tasks',
      text:
        todayTasks.length === 1
          ? `Сегодня дело: ${todayTasks[0]?.title ?? ''}`
          : `Сегодня дел: ${todayTasks.length}`,
      hint: 'Срок — сегодня',
      to: '/tasks',
    });
  }

  if (!configured) {
    rows.push({
      id: 'local-only',
      text: 'Данные только на этом телефоне',
      hint: 'Подключите семейное хранилище — список увидят все',
      to: '/settings',
    });
  }

  return rows;
}

/**
 * Проблема синхронизации — единственный случай, когда сверху нужен баннер.
 * Обычное состояние («Сохранено», пустая очередь) показывается тонкой строкой внизу.
 */
export function syncProblem(s: SyncStatusLike): boolean {
  return !s.configured || s.phase === 'offline' || s.phase === 'error' || s.pendingCount > 0;
}

/** Текст баннера для проблемы синхронизации; для исправного состояния — null. */
export function syncNote(s: SyncStatusLike): SyncNote | null {
  if (!s.configured) {
    return {
      tone: 'warn',
      title: 'Данные только на этом телефоне',
      detail: 'Подключите семейное хранилище, чтобы покупки, дела и сроки видела вся семья.',
    };
  }
  if (s.phase === 'error') {
    return {
      tone: 'err',
      title: 'Синхронизация не работает',
      detail: s.lastError
        ? `${s.lastError.code}: ${s.lastError.message}`
        : 'Изменения сохранены на телефоне и отправятся, как только получится.',
    };
  }
  if (s.phase === 'offline') {
    return {
      tone: 'warn',
      title: 'Нет сети',
      detail: 'Всё сохранено на телефоне. Отправим автоматически, когда появится интернет.',
    };
  }
  if (s.pendingCount > 0) {
    return {
      tone: 'warn',
      title: `Ждут отправки: ${s.pendingCount}`,
      detail: 'Изменения уже на телефоне, уедут к семье при первой возможности.',
    };
  }
  return null;
}
