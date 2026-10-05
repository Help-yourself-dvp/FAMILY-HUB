/**
 * Настройки · Уведомления · Лента (подписка) — 0.6.0.
 *
 * Смысл блока: календарь телефона сам скачивает наш .ics по постоянной ссылке, поэтому
 * события появляются у всех участников без галочек, файлов и системных окон. Ссылка —
 * «секретная» (неугадываемая часть адреса), её можно сменить одной кнопкой.
 *
 * Честные подписи в интерфейсе (владелец не должен удивляться):
 *  - календарь обновляет подписку не мгновенно — это часы, иногда сутки;
 *  - на iPhone у подписного календаря есть «Удалить будильники» — если включён, событие
 *    видно, а звонка не будет;
 *  - у дел будильников в ленте нет: дело будит только исполнителя.
 */
import { useEffect, useState } from 'react';
import { Banner, Icon, Sheet, Skeleton, Switch } from '../../design/ui';
import { copyText } from '../../shared/clipboard';
import {
  feedUrl,
  loadFeedConfig,
  readFeedState,
  rotateFeedLinks,
  setFeedSection,
  type FeedConfig,
  type FeedSection,
  type FeedState,
} from '../../data/remote/feed';
import { describeStorageFailure } from '../../notifications/channels';

/**
 * Когда лента обновлялась в последний раз. Время показываем в Москве (единый пояс семьи),
 * и только если отправитель действительно публиковал файл: иначе честнее сказать, что
 * файла ещё нет.
 */
export function formatPublishedAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'время неизвестно';
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  return `${parts} (Москва)`;
}

const SECTION_INFO: Record<FeedSection, { title: string; hint: string }> = {
  deadlines: {
    title: 'Сроки',
    hint: 'Документы, ТО, страховки, дни рождения. Будильники — по ступеням срока.',
  },
  tasks: {
    title: 'Дела с датой',
    hint: 'Открытые дела семьи. Без будильников: дело будит только исполнителя.',
  },
};

export default function FeedSubscriptionSection() {
  const [state, setState] = useState<FeedState | null | undefined>(undefined);
  const [cfg, setCfg] = useState<FeedConfig | null>(null);
  const [busy, setBusy] = useState(false);
  // Отдельно от общего busy: пока раздел сохраняется на GitHub (~пара секунд), рядом с его
  // переключателем должна быть подпись «включаем…/выключаем…» — иначе выглядит как зависание
  // (владелец 05.10.2026, по образцу push-блока из приёмки 0.3.3).
  const [busySection, setBusySection] = useState<FeedSection | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [feedCfg, feedState] = await Promise.all([
        loadFeedConfig(),
        readFeedState().catch(() => null),
      ]);
      if (cancelled) return;
      setCfg(feedCfg);
      setState(feedState);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (section: FeedSection, enabled: boolean) => {
    setBusy(true);
    setBusySection(section);
    setNotice(null);
    try {
      const next = await setFeedSection(state ?? null, section, enabled);
      setState(next);
      setNotice({
        tone: 'ok',
        text: enabled
          ? `Раздел «${SECTION_INFO[section].title}» включён. Отправитель обновит ленту в ближайший запуск (обычно пара минут).`
          : `Раздел «${SECTION_INFO[section].title}» выключен — лента этого раздела станет пустой, и события из календаря уйдут.`,
      });
    } catch (e) {
      setNotice({ tone: 'err', text: describeStorageFailure(e) });
    } finally {
      setBusySection(null);
      setBusy(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await rotateFeedLinks(state ?? null);
      setState(next);
      setNotice({
        tone: 'warn',
        text: 'Новые ссылки созданы. Старые перестанут работать после ближайшей публикации — замените ссылку в календаре телефона.',
      });
    } catch (e) {
      setNotice({ tone: 'err', text: describeStorageFailure(e) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    const outcome = await copyText(url);
    setNotice(
      outcome === 'manual'
        ? { tone: 'warn', text: 'Ссылка показана выше: выделите её и скопируйте вручную.' }
        : { tone: 'ok', text: 'Ссылка скопирована — вставьте её в календарь телефона.' },
    );
  };

  const anyEnabled = state ? state.sections.deadlines || state.sections.tasks : false;

  return (
    <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
        <span className="badge" style={{ flex: '0 0 auto' }}>
          лента
        </span>
        <div className="strong grow truncate" style={{ fontSize: 'var(--fs-md)' }}>
          Лента (подписка на календарь)
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="О ленте подробнее"
          onClick={() => setHelpOpen(true)}
        >
          <Icon name="info" size={18} />
        </button>
      </div>

      <p className="small" style={{ margin: 0, lineHeight: 1.55, color: 'var(--text-2)' }}>
        События сами появляются в календаре телефона у всех участников: один раз подписались —
        дальше без галочек и файлов. Календарь перечитывает ленту несколько раз в сутки.
      </p>

      {state === undefined ? (
        <Skeleton />
      ) : !cfg ? (
        <Banner tone="warn">
          <div className="grow small">
            Не найден адрес публичного репозитория (vapid.json → feed). Лента недоступна.
          </div>
        </Banner>
      ) : (
        <>
          {(['deadlines', 'tasks'] as const).map((section) => (
            <div key={section} className="stack" style={{ gap: 'var(--sp-2)' }}>
              <div className="row--between row" style={{ gap: 'var(--sp-3)' }}>
                <div className="grow">
                  <div className="strong" style={{ fontSize: 'var(--fs-sm)' }}>
                    {SECTION_INFO[section].title}
                  </div>
                  <div className="tiny muted">{SECTION_INFO[section].hint}</div>
                </div>
                <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
                  <span
                    className="tiny muted"
                    style={{ whiteSpace: 'nowrap' }}
                    data-testid={`feed-state-${section}`}
                  >
                    {busySection === section
                      ? (state?.sections[section] ?? false)
                        ? 'выключаем…'
                        : 'включаем…'
                      : (state?.sections[section] ?? false)
                        ? 'включено'
                        : 'выключено'}
                  </span>
                  <Switch
                    checked={state?.sections[section] ?? false}
                    label={`Лента: ${SECTION_INFO[section].title}`}
                    disabled={busy}
                    onChange={(v) => void toggle(section, v)}
                  />
                </div>
              </div>
              {!state?.sections[section] && (
                <div className="tiny muted">
                  Раздел выключен — включите его, и ссылка появится сразу.
                </div>
              )}
              {state && state.sections[section] && (
                <div className="stack" style={{ gap: 6 }}>
                  <div
                    className="mono tiny"
                    style={{ overflowWrap: 'anywhere', userSelect: 'all' }}
                    data-testid={`feed-url-${section}`}
                  >
                    {feedUrl(cfg, state.slugs[section])}
                  </div>
                  <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void copy(feedUrl(cfg, state.slugs[section]))}
                    >
                      Скопировать ссылку
                    </button>
                    {state.publishedAt === null ? (
                      <span className="tiny muted">Файл появится после ближайшего запуска</span>
                    ) : (
                      <span className="tiny muted" data-testid={`feed-published-${section}`}>
                        Обновлено: {formatPublishedAt(state.publishedAt)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={busy || !anyEnabled}
              onClick={() => void rotate()}
            >
              Сменить ссылку
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setHelpOpen(true)}
            >
              Как подписаться
            </button>
          </div>
        </>
      )}

      {notice && (
        <Banner tone={notice.tone}>
          <div className="grow small">{notice.text}</div>
          <button type="button" className="btn btn--sm" onClick={() => setNotice(null)}>
            Понятно
          </button>
        </Banner>
      )}

      <Sheet open={helpOpen} title="Лента: как это работает" onClose={() => setHelpOpen(false)}>
        <div className="stack">
          <p className="small" style={{ margin: 0 }}>
            Лента — это календарь, который ваш телефон скачивает сам. Мы кладём по ссылке свежий
            список, календарь его перечитывает (несколько раз в сутки), поэтому события появляются у
            всех участников без ручной работы.
          </p>
          <div className="small">
            <div className="strong">Подписаться (один раз на телефон)</div>
            <div className="muted">
              iPhone: Настройки → Календарь → Учётные записи → Добавить → Другое → Подписной
              календарь → вставить ссылку.
            </div>
            <div className="muted">
              Android/Google: на компьютере calendar.google.com → «Другие календари» → «Создать
              календарь» → вкладка «Добавить по URL» → вставить ссылку.
            </div>
          </div>
          <div className="small">
            <div className="strong">Что важно знать</div>
            <div className="muted">
              Обновление не мгновенное: часы, иногда сутки — так работают календари.
            </div>
            <div className="muted">
              На iPhone у подписного календаря есть переключатель «Удалить будильники»: если он
              включён, событие будет видно, а звонка не будет.
            </div>
            <div className="muted">
              У дел будильников нет — уведомление о деле получает только исполнитель (иначе звонило
              бы всем).
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
