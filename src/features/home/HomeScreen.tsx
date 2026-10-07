/**
 * Главная — семейный dashboard (ТЗ §14: не перегружать).
 * На ЭТАПЕ 1 показывает реальные счётчики из локальной БД + «Семейную ленту».
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { daysUntil, formatRu, humanizeDelta } from '../../domain/dateOnly';
import { attentionRows, syncNote, syncProblem } from '../../domain/homeStatus';
import { deadlineTone, nearestDeadlines, TONE_TEXT_COLOR } from '../../domain/deadlineRules';
import { HORIZON_LABEL, type Horizon } from '../../domain/types';
import { Banner, Icon, Skeleton } from '../../design/ui';
import { useSyncState } from '../../app/hooks';
import { statusLine } from '../../data/sync/state';
import { homeTaskList, taskDateLabel } from '../../domain/taskRules';
import { ACTIVITY_SORT_LABEL, sortActivity, type ActivitySort } from '../../domain/activityRules';

export default function HomeScreen({ ready }: { ready: boolean }) {
  const items = useLiveQuery(() => db.shopping.toArray(), [], undefined);
  // Лента грузится «с запасом»: по умолчанию показываем 25 последних, а при сортировке
  // «по участнику»/«по типу» записи человека находятся даже среди давних (просьба 06.10.2026).
  const activity = useLiveQuery(
    () => db.activity.orderBy('at').reverse().limit(100).toArray(),
    [],
    undefined,
  );
  const activityTotal = useLiveQuery(() => db.activity.count(), [], undefined);
  const members = useLiveQuery(() => db.members.toArray(), [], undefined);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], undefined);
  const nearbyTasks = useMemo(() => homeTaskList(tasks ?? []), [tasks]);
  const deadlines = useLiveQuery(
    () => db.deadlines.filter((d) => !d.deletedAt && d.visibility === 'family').toArray(),
    [],
    undefined,
  );
  const sync = useSyncState();
  const [activitySort, setActivitySort] = useState<ActivitySort>('new');
  const [activityActor, setActivityActor] = useState<string>('all');

  // Участники для выпадающего фильтра берём из самой ленты: так в списке останутся даже
  // те, кого потом удалили из семьи (их записи всё равно в ленте).
  const activityActors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of activity ?? []) {
      if (!seen.has(entry.actorId)) seen.set(entry.actorId, entry.actorName || 'Участник');
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [activity]);

  const shownActivity = useMemo(() => {
    const list = (activity ?? []).filter(
      (a) => activityActor === 'all' || a.actorId === activityActor,
    );
    return sortActivity(list, activitySort).slice(0, 25);
  }, [activity, activitySort, activityActor]);

  const stats = useMemo(() => {
    if (!items) return null;
    const live = items.filter((i) => !i.deletedAt);
    const active = live.filter((i) => !i.done);
    const byHorizon = (h: Horizon) => active.filter((i) => i.horizon === h).length;
    return {
      now: byHorizon('now'),
      soon: byHorizon('soon'),
      someday: byHorizon('someday'),
      total: active.length,
      done: live.filter((i) => i.done).length,
      demo: live.some((i) => i.note === 'демо'),
    };
  }, [items]);

  /**
   * «Требует внимания» и баннер синхронизации — правила в `domain/homeStatus.ts`
   * (07.10.2026): блок появляется, только если есть на что смотреть, а баннер сверху —
   * только при проблеме. Обычное состояние живёт тонкой строкой внизу экрана.
   */
  const attention = useMemo(
    () =>
      attentionRows({
        deadlines: deadlines ?? [],
        tasks: tasks ?? [],
        configured: sync.configured,
      }),
    [deadlines, tasks, sync.configured],
  );
  const problem = syncProblem(sync);
  const note = syncNote(sync);

  if (!ready || !stats) {
    return (
      <div className="screen">
        <Skeleton h={92} count={2} />
      </div>
    );
  }

  return (
    <div className="screen">
      {problem && note && (
        <Banner
          tone={note.tone}
          action={
            <Link className="btn btn--sm" to="/settings">
              Настроить
            </Link>
          }
        >
          <div className="grow">
            <div className="strong small">{note.title}</div>
            <div className="small">{note.detail}</div>
          </div>
        </Banner>
      )}

      {stats.demo && (
        <Banner tone="warn">
          <div className="grow">
            <div className="row" style={{ gap: 6 }}>
              <span className="demo-flag">ДЕМО-ДАННЫЕ</span>
              <span className="strong">Это не настоящие покупки</span>
            </div>
            <div className="small">
              Позиции с пометкой «демо» созданы при первом запуске, чтобы интерфейс не был пустым.
              Удалите их или начните добавлять свои — бейдж исчезнет.
            </div>
          </div>
        </Banner>
      )}

      {attention.length > 0 && (
        <section className="stack" aria-label="Требует внимания">
          <h2 className="section-title">Требует внимания</h2>
          <div className="card stack" style={{ gap: 'var(--sp-3)' }} data-testid="attention">
            {attention.map((row) => (
              <Link key={row.id} to={row.to} className="row" style={{ gap: 'var(--sp-2)' }}>
                <span style={{ color: 'var(--warn-text)', flex: '0 0 auto' }}>
                  <Icon name="alert" size={18} />
                </span>
                <div className="grow">
                  <div className="small" style={{ overflowWrap: 'anywhere' }}>
                    {row.text}
                  </div>
                  <div className="tiny muted">{row.hint}</div>
                </div>
                <Icon name="chevron" size={16} className="chev" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="stack">
        <div className="row row--between">
          <h2 className="section-title">Ближайшие сроки</h2>
          <Link to="/deadlines" className="btn btn--sm btn--ghost">
            Все сроки
          </Link>
        </div>
        {deadlines && deadlines.length > 0 ? (
          <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
            {nearestDeadlines(deadlines).map((d) => {
              const left = daysUntil(d.dueDate);
              const toneKind = deadlineTone(d);
              const tone = TONE_TEXT_COLOR[toneKind];
              return (
                <div key={d.id} className="row" style={{ gap: 'var(--sp-3)' }}>
                  <div className="grow">
                    <div className="small" style={{ overflowWrap: 'anywhere' }}>
                      {d.title}
                    </div>
                    <div className="tiny muted">{formatRu(d.dueDate)}</div>
                  </div>
                  <span className="badge" style={{ color: tone, borderColor: tone }}>
                    {left < 0 ? `просрочено ${-left} дн.` : humanizeDelta(left)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="small muted">
            Сроков пока нет. Добавьте первый в разделе «Сроки» — напоминания придут сами.
          </div>
        )}
      </section>

      <section className="stack" aria-label="Ближайшие дела">
        <div className="row row--between">
          <h2 className="section-title">Ближайшие дела</h2>
          <Link to="/tasks" className="btn btn--sm btn--ghost">
            Все дела
          </Link>
        </div>
        {nearbyTasks.length ? (
          <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
            {nearbyTasks.map((task) => (
              <Link
                key={task.id}
                to="/tasks"
                className="row"
                style={{ color: 'inherit', textDecoration: 'none', gap: 'var(--sp-3)' }}
              >
                <div className="grow">
                  <div className="small" style={{ overflowWrap: 'anywhere' }}>
                    {task.title}
                  </div>
                  <div className="tiny muted">{taskDateLabel(task.dueDate)}</div>
                  <div className="tiny muted">
                    {task.assigneeId
                      ? members?.find((member) => member.id === task.assigneeId)?.name ||
                        'Участник недоступен'
                      : 'Без исполнителя'}
                  </div>
                </div>
                <Icon name="check" size={18} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="small muted">Открытых дел пока нет.</div>
        )}
      </section>

      <Link to="/shopping" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="row row--between" style={{ gap: 'var(--sp-2)' }}>
          <div className="card-title">Покупки</div>
          <div className="small">Нужно купить: {stats.total}</div>
        </div>
        <div className="tiny muted" style={{ marginTop: 4 }}>
          {HORIZON_LABEL.soon}: {stats.soon} · {HORIZON_LABEL.someday}: {stats.someday}
        </div>
      </Link>

      <section className="stack">
        <details className="acc">
          <summary className="acc-summary">
            <span className="grow">Семейная лента{activityTotal ? ` · ${activityTotal}` : ''}</span>
            <span className="acc-hint">Кто что добавил, купил или изменил</span>
            <Icon name="chevron" size={18} className="chev" />
          </summary>
          <div className="acc-body stack">
            {activity && activity.length > 0 ? (
              <>
                <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <label className="field grow" style={{ minWidth: 150 }}>
                    <span className="field-label">Сортировать по</span>
                    <select
                      className="select"
                      aria-label="Сортировать ленту"
                      value={activitySort}
                      onChange={(event) => setActivitySort(event.target.value as ActivitySort)}
                    >
                      {(Object.keys(ACTIVITY_SORT_LABEL) as ActivitySort[]).map((value) => (
                        <option key={value} value={value}>
                          {ACTIVITY_SORT_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {activityActors.length > 1 && (
                    <label className="field grow" style={{ minWidth: 150 }}>
                      <span className="field-label">Кто</span>
                      <select
                        className="select"
                        aria-label="Кто в ленте"
                        value={activityActor}
                        onChange={(event) => setActivityActor(event.target.value)}
                      >
                        <option value="all">Все участники</option>
                        {activityActors.map((actor) => (
                          <option key={actor.id} value={actor.id}>
                            {actor.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div
                  className="card stack"
                  style={{ gap: 'var(--sp-3)' }}
                  data-testid="activity-list"
                >
                  {shownActivity.map((a) => (
                    <div
                      key={a.id}
                      className="row"
                      style={{ gap: 'var(--sp-3)' }}
                      data-testid="activity-item"
                    >
                      <span className="badge badge--accent">{actionLabel(a.action, a.kind)}</span>
                      <div className="grow">
                        {a.place && (
                          <div className="tiny" style={{ color: 'var(--accent)', marginBottom: 2 }}>
                            {a.place}
                          </div>
                        )}
                        <div className="small" style={{ overflowWrap: 'anywhere' }}>
                          {a.title}
                        </div>
                        <div className="row tiny muted" style={{ gap: 6 }}>
                          <span
                            className="dot"
                            style={{ color: memberColor(members, a.actorId), flex: '0 0 auto' }}
                          />
                          <span className="truncate">
                            {members?.find((m) => m.id === a.actorId)?.name ?? a.actorName} ·{' '}
                            {formatTime(a.at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {shownActivity.length < (activity ?? []).length && (
                    <div className="tiny muted">
                      Показаны 25 из {activity.length} последних записей — выберите участника, чтобы
                      найти его изменения.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="small muted">Пока пусто. Действия семьи появятся здесь.</div>
            )}
          </div>
        </details>
      </section>

      <div className="tiny muted sync-line">
        {statusLine(sync.phase, sync.pendingCount)}
        {sync.pendingCount > 0 ? ` · не отправлено: ${sync.pendingCount}` : ''} ·{' '}
        <Link to="/settings">Настройки</Link>
      </div>
    </div>
  );
}

/* Заголовок и вход в настройки вынесены в верхнюю панель и нижнюю навигацию
   (приёмка 0.1.5: два входа в настройки и съедаемая строка заголовка). */

function actionLabel(a: string, kind: string): string {
  switch (a) {
    case 'created':
      return 'добавлено';
    case 'updated':
      return 'изменено';
    case 'completed':
      return kind === 'tasks' ? 'выполнено' : 'куплено';
    case 'deleted':
      return 'удалено';
    default:
      return a;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? time
    : d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) + ', ' + time;
}

function memberColor(
  members: Array<{ id: string; color: string }> | undefined,
  actorId: string,
): string {
  return members?.find((m) => m.id === actorId)?.color ?? 'var(--text-3)';
}
