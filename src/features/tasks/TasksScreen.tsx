/** База «Дела»: общий offline-first список, существующие навигация/Sheet/дизайн. */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { tasksRepo } from '../../data/repositories';
import { session } from '../../data/session';
import { useSyncState } from '../../app/hooks';
import { Banner, EmptyState, Icon, Skeleton } from '../../design/ui';
import { daysUntil, formatRu, isDateOnly } from '../../domain/dateOnly';
import {
  matchesTaskFilter,
  sortOpenTasks,
  taskDateLabel,
  TASK_SORT_LABEL,
  type TaskFilter,
  type TaskSort,
} from '../../domain/taskRules';
import type { Member, Task } from '../../domain/types';
import TaskSheet from './TaskSheet';
import { TONE_COLOR } from '../../domain/deadlineRules';

export default function TasksScreen({
  ready,
  composeKey = null,
}: {
  ready: boolean;
  composeKey?: string | null;
}) {
  const rows = useLiveQuery(() => db.tasks.toArray(), [], undefined);
  const members = useLiveQuery(() => db.members.toArray(), [], undefined);
  const sync = useSyncState();
  const [composeOpen, setComposeOpen] = useState(false);
  const [seenComposeKey, setSeenComposeKey] = useState<string | null>(null);
  if (composeKey && composeKey !== seenComposeKey) {
    setSeenComposeKey(composeKey);
    setComposeOpen(true);
  }
  const [editing, setEditing] = useState<Task | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [sort, setSort] = useState<TaskSort>('due');
  const [error, setError] = useState<string | null>(null);
  const liveMembers = useMemo(
    () =>
      members
        ?.filter((member) => !member.deletedAt)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')) ?? [],
    [members],
  );
  const live = useMemo(() => rows?.filter((task) => !task.deletedAt) ?? [], [rows]);

  if (!ready || !rows || !members)
    return (
      <div className="screen">
        <Skeleton />
      </div>
    );
  const selfId = session().deviceId;
  const shown = live.filter((task) => matchesTaskFilter(task, filter, selfId));
  const assigneeName = (id: string | null) => {
    if (!id) return 'Без исполнителя';
    return liveMembers.find((member) => member.id === id)?.name || 'Участник недоступен';
  };
  const open = sortOpenTasks(
    shown.filter((task) => task.status !== 'done'),
    sort,
    assigneeName,
  );
  const done = shown
    .filter((task) => task.status === 'done')
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '') || a.id.localeCompare(b.id));

  const changeDone = async (task: Task) => {
    try {
      setError(null);
      await tasksRepo.setDone(task.id, task.status !== 'done');
    } catch {
      setError('Не удалось изменить отметку. Повторите попытку.');
    }
  };
  const remove = async (task: Task) => {
    if (!window.confirm(`Удалить дело «${task.title}»?`)) return;
    try {
      setError(null);
      await tasksRepo.remove(task.id);
    } catch {
      setError('Не удалось удалить дело. Повторите попытку.');
    }
  };
  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      members={members}
      onEdit={() => setEditing(task)}
      onDone={() => void changeDone(task)}
      onRemove={() => void remove(task)}
    />
  );

  return (
    <div className="screen">
      <div className="screen-subtitle">
        {live.filter((task) => task.status !== 'done').length} дел к выполнению ·{' '}
        {live.filter((task) => task.status === 'done').length} выполнено
      </div>
      {!sync.configured && (
        <Banner tone="warn">
          <div className="grow">
            <div className="strong">Локальный режим</div>
            <div className="small">
              Дела сохраняются на устройстве. Подключите семейное хранилище в настройках, чтобы
              список был общим.
            </div>
          </div>
        </Banner>
      )}
      {error && (
        <Banner tone="err">
          <div className="grow small">{error}</div>
        </Banner>
      )}
      <label className="field">
        <span className="field-label">Сортировать по</span>
        <select
          className="select"
          aria-label="Сортировать дела"
          value={sort}
          onChange={(event) => setSort(event.target.value as TaskSort)}
        >
          {(Object.keys(TASK_SORT_LABEL) as TaskSort[]).map((value) => (
            <option key={value} value={value}>
              {TASK_SORT_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <div className="chips" role="group" aria-label="Фильтр дел">
        {(
          [
            ['all', 'Все дела'],
            ['mine', 'Мои дела'],
            ['unassigned', 'Без исполнителя'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {open.length ? (
        <section className="stack">
          <h2 className="section-title">К выполнению · {open.length}</h2>
          {open.map(row)}
        </section>
      ) : (
        <EmptyState
          emoji="✓"
          title={live.length ? 'Здесь нет открытых дел' : 'Добавьте первое дело'}
          hint={
            live.length
              ? 'Проверьте другой фильтр или выполненные дела ниже.'
              : 'Кто что сделает для семьи: добавьте название, при желании исполнителя и срок.'
          }
        />
      )}
      {done.length > 0 && (
        <details className="acc">
          <summary className="acc-summary">
            <span className="grow">Выполнено · {done.length}</span>
            <span className="acc-hint">Можно вернуть в работу</span>
            <Icon name="chevron" size={18} className="chev" />
          </summary>
          <div className="acc-body stack">{done.map(row)}</div>
        </details>
      )}
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => setComposeOpen(true)}
      >
        <Icon name="plus" size={20} /> Добавить дело
      </button>
      <p className="tiny muted" style={{ margin: 0 }}>
        База для повседневных дел. Повторения и автоматические уведомления добавим отдельно после
        проверки полезности.
      </p>
      <p className="tiny muted" style={{ margin: 0 }}>
        Дело с датой уходит в семейную ленту и попадает в календари семьи (телефоны Android —
        через «мост»). Поэтому добавлять его в календарь вручную отдельно не нужно: получится
        две записи — своя и общая.
      </p>
      {composeOpen && <TaskSheet members={liveMembers} onClose={() => setComposeOpen(false)} />}
      {editing && (
        <TaskSheet
          key={editing.id}
          editing={editing}
          members={liveMembers}
          onClose={() => setEditing(null)}
        />
      )}
      <div style={{ height: 64 }} aria-hidden="true" />
    </div>
  );
}

function TaskRow({
  task,
  members,
  onEdit,
  onDone,
  onRemove,
}: {
  task: Task;
  members: Member[];
  onEdit: () => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const done = task.status === 'done';
  const assignee = task.assigneeId ? members.find((member) => member.id === task.assigneeId) : null;
  const author = members.find((member) => member.id === task.updatedBy);
  const overdue = !done && isDateOnly(task.dueDate) && daysUntil(task.dueDate) < 0;
  return (
    <div className={`item${done ? ' item--done' : ''}`}>
      <button
        type="button"
        className="checkbox"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? 'Вернуть в работу' : 'Выполнить'} «${task.title}»`}
        onClick={onDone}
      />
      <button
        type="button"
        className="grow item-hit"
        aria-label={`Изменить дело «${task.title}»`}
        onClick={onEdit}
      >
        <div className="item-title">{task.title}</div>
        {task.note && (
          <div
            className="small muted"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 4 }}
          >
            {task.note}
          </div>
        )}
        <div className="item-meta">
          {task.assigneeId
            ? assignee?.deletedAt
              ? `${assignee.name} (недоступен)`
              : assignee?.name || 'Участник недоступен'
            : 'Без исполнителя'}{' '}
          ·{' '}
          {done && isDateOnly(task.dueDate) ? formatRu(task.dueDate) : taskDateLabel(task.dueDate)}
        </div>
        {author && <div className="tiny muted">Последнее изменение: {author.name}</div>}
        {overdue && (
          <span className="badge" style={{ color: TONE_COLOR.alert }}>
            Просрочено
          </span>
        )}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Удалить дело «${task.title}»`}
        onClick={onRemove}
      >
        <Icon name="trash" size={20} />
      </button>
    </div>
  );
}
