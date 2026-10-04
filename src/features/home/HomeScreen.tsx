/**
 * Главная — семейный dashboard (ТЗ §14: не перегружать).
 * На ЭТАПЕ 1 показывает реальные счётчики из локальной БД + «Семейную ленту».
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { daysUntil, formatRu, humanizeDelta } from '../../domain/dateOnly';
import { deadlineTone, TONE_COLOR } from '../../domain/deadlineRules';
import { HORIZON_LABEL, type Horizon } from '../../domain/types';
import { Banner, Icon, Skeleton, Stat } from '../../design/ui';
import { useSyncState } from '../../app/hooks';
import { PHASE_LABEL } from '../../data/sync/state';
import { nearestDatedTasks, taskDateLabel } from '../../domain/taskRules';

export default function HomeScreen({ ready }: { ready: boolean }) {
  const items = useLiveQuery(() => db.shopping.toArray(), [], undefined);
  const activity = useLiveQuery(
    () => db.activity.orderBy('at').reverse().limit(15).toArray(),
    [],
    undefined,
  );
  const members = useLiveQuery(() => db.members.toArray(), [], undefined);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], undefined);
  const nearbyTasks = useMemo(() => nearestDatedTasks(tasks ?? []), [tasks]);
  const deadlines = useLiveQuery(
    () => db.deadlines.filter((d) => !d.deletedAt && d.visibility === 'family').toArray(),
    [],
    undefined,
  );
  const sync = useSyncState();

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

  if (!ready || !stats) {
    return (
      <div className="screen">
        <Skeleton h={92} count={2} />
      </div>
    );
  }

  return (
    <div className="screen">
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

      <Link
        to="/shopping"
        className="card card--glass"
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <div className="card-title">Покупки</div>
        <div className="row row--between" style={{ marginTop: 'var(--sp-3)' }}>
          <Stat value={`${stats.now} / ${stats.soon}`} label="сейчас / скоро" />
          <Stat value={stats.someday} label={HORIZON_LABEL.someday.toLowerCase()} />
          <Stat value={stats.done} label="куплено" />
        </div>
      </Link>

      <div className="card">
        <div className="card-title">Синхронизация</div>
        <div className="row row--between" style={{ marginTop: 'var(--sp-3)' }}>
          <Stat
            value={PHASE_LABEL[sync.phase]}
            label={sync.configured ? 'подключено' : 'локальный режим'}
          />
          <Stat value={sync.pendingCount} label="не отправлено" />
        </div>
        {!sync.configured && (
          <div className="small muted" style={{ marginTop: 'var(--sp-3)' }}>
            Это приложение для совместного использования. Без подключения данные видны только на
            этом устройстве. <Link to="/settings">Подключить семейный репозиторий →</Link>
          </div>
        )}
        {sync.lastError && (
          <div className="banner banner--err" style={{ marginTop: 'var(--sp-3)' }}>
            <Icon name="alert" size={16} />
            <div className="grow">
              <div className="strong small">Ошибка: {sync.lastError.code}</div>
              <div className="tiny mono">{sync.lastError.message}</div>
            </div>
          </div>
        )}
      </div>

      <section className="stack">
        <div className="row row--between">
          <h2 className="section-title">Ближайшие сроки</h2>
          <Link to="/deadlines" className="btn btn--sm btn--ghost">
            Все сроки
          </Link>
        </div>
        {deadlines && deadlines.length > 0 ? (
          <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
            {deadlines.slice(0, 3).map((d) => {
              const left = daysUntil(d.dueDate);
              const toneKind = deadlineTone(d);
              const tone = toneKind === 'ok' ? 'var(--text-2)' : TONE_COLOR[toneKind];
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
          <div className="small muted">Открытых дел с датой пока нет.</div>
        )}
      </section>

      <section className="stack">
        <details className="acc">
          <summary className="acc-summary">
            <span className="grow">
              Семейная лента{activity && activity.length > 0 ? ` · ${activity.length}` : ''}
            </span>
            <span className="acc-hint">Кто что добавил, купил или изменил</span>
            <Icon name="chevron" size={18} className="chev" />
          </summary>
          <div className="acc-body stack">
            {activity && activity.length > 0 ? (
              <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
                {activity.map((a) => (
                  <div key={a.id} className="row" style={{ gap: 'var(--sp-3)' }}>
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
              </div>
            ) : (
              <div className="small muted">Пока пусто. Действия семьи появятся здесь.</div>
            )}
          </div>
        </details>
      </section>

      <div className="card">
        <div className="card-title">Дела и сроки</div>
        <div className="small muted" style={{ marginTop: 'var(--sp-3)' }}>
          «Сроки»: документы, ТО, дни рождения — с напоминаниями и добавлением события в календарь
          телефона. <Link to="/deadlines">Открыть сроки</Link>. «Дела» — общий список с
          исполнителем, необязательным сроком и отметкой выполнения; уведомление о деле получает его
          исполнитель. <Link to="/tasks">Открыть дела</Link>.
        </div>
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
