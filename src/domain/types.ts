/**
 * Централизованные доменные типы (ТЗ §30). Все сущности наследуют Syncable —
 * это то, что делает возможным общий алгоритм слияния и общий слой синхронизации.
 */
import type { DateOnly } from './dateOnly';

/** Какой доменный файл в удалённом репозитории хранит эту сущность. */
export type EntityKind = 'shopping' | 'tasks' | 'deadlines' | 'dictionary' | 'members';

export const ENTITY_KINDS: readonly EntityKind[] = [
  'shopping',
  'tasks',
  'deadlines',
  'dictionary',
  'members',
] as const;

/** Путь файла в репозитории данных для каждого вида сущностей (PROJECT.md §2.3). */
export const REMOTE_PATH: Record<EntityKind, string> = {
  shopping: 'data/shopping.json',
  tasks: 'data/tasks.json',
  deadlines: 'data/deadlines.json',
  dictionary: 'data/dictionary.json',
  members: 'data/members.json',
};

/** Минимальный контракт синхронизируемой сущности (ТЗ §8). */
export interface Syncable {
  /** Уникальный ID сущности. */
  id: string;
  /** Локальный счётчик версий. Растёт на каждое изменение. Основа 3-way merge. */
  rev: number;
  createdAt: string;
  updatedAt: string;
  /** ID устройства/профиля, последним изменившим сущность. */
  updatedBy: string;
  /** Tombstone: сущность удалена, но запись остаётся, чтобы не «воскреснуть» при merge. */
  deletedAt?: string | null;
}

export type Horizon = 'now' | 'soon' | 'someday';

export const HORIZONS: readonly Horizon[] = ['now', 'soon', 'someday'] as const;

export const HORIZON_LABEL: Record<Horizon, string> = {
  now: 'Сейчас',
  soon: 'Скоро',
  someday: 'Когда-нибудь',
};

/** Покупка. Магазин и категория — РАЗНЫЕ свойства (ТЗ §15). */
export interface ShoppingItem extends Syncable {
  kind: 'shopping';
  /** Отображаемое название как ввёл пользователь. */
  title: string;
  /** Нормализованный ключ для поиска дубликатов (ТЗ §16-18). */
  canonicalKey: string;
  qty: number | null;
  unit: string | null;
  category: string | null;
  /** Магазин — простой тег, а не управляемая сущность (PROJECT.md §3, п.3). */
  store: string | null;
  /** Временной горизонт. «Приоритет» вырезан (§3, п.4). */
  horizon: Horizon;
  note: string | null;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
}

export type DeadlineKind =
  'document' | 'vehicle' | 'home' | 'insurance' | 'service' | 'birthday' | 'custom';

export type RecurrenceRule =
  | { type: 'none' }
  | { type: 'yearly' }
  | { type: 'monthly' }
  | { type: 'everyDays'; days: number }
  | { type: 'everyMonths'; months: number }
  | { type: 'afterCompletion'; days?: number; months?: number };

export interface Deadline extends Syncable {
  kind: 'deadlines';
  title: string;
  deadlineKind: DeadlineKind;
  /** date-only, НЕ timestamp — см. domain/dateOnly.ts */
  dueDate: DateOnly;
  /** Дней до даты, за которые напоминать (90/30/7/0 — ТЗ §22). */
  remindersDays: number[];
  recurrence: RecurrenceRule;
  /** Интервальные сроки: когда последний раз выполнялось (фильтр заменён 15.10.2026). */
  lastCompletedAt?: DateOnly | null;
  /** История прежних сроков (ТЗ §23) — единственное место с полной историей (§3, п.2). */
  history: Array<{ dueDate: DateOnly; replacedAt: string; replacedBy: string }>;
  /** Видимость: семья / только владелец (§6.21, упрощённо). */
  visibility: 'family' | 'private';
  ownerId?: string | null;
  note: string | null;
}

export type TaskStatus = 'open' | 'done';

export interface Task extends Syncable {
  kind: 'tasks';
  title: string;
  note: string | null;
  assigneeId: string | null;
  dueDate: DateOnly | null;
  status: TaskStatus;
  doneAt: string | null;
  recurrence: RecurrenceRule;
}

export interface Member extends Syncable {
  kind: 'members';
  name: string;
  color: string;
  emoji: string | null;
}

/** Формат удалённого файла (PROJECT.md §2.2). Один файл на вид сущностей, не «один бесконечный JSON». */
export interface RemoteFile<T extends Syncable> {
  schemaVersion: number;
  /** Растёт на каждую успешную запись. Используется для диагностики, не для merge. */
  fileRev: number;
  updatedAt: string;
  entities: Record<string, T>;
}

export const SCHEMA_VERSION = 1;

export function emptyRemoteFile<T extends Syncable>(): RemoteFile<T> {
  return { schemaVersion: SCHEMA_VERSION, fileRev: 0, updatedAt: '', entities: {} };
}

/** Записи «Семейной ленты» (§3, п.2 — замена per-entity audit log). */
export interface ActivityEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  kind: EntityKind;
  action: 'created' | 'updated' | 'completed' | 'deleted';
  /** ТОЛЬКО короткий заголовок, без приватных подробностей. */
  title: string;
}
