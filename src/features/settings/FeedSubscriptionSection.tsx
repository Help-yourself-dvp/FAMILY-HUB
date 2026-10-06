/**
 * Настройки · Уведомления · Лента (подписка) — 0.6.0.
 *
 * Смысл блока: календарь телефона сам скачивает наш .ics по постоянной ссылке, поэтому
 * события появляются у всех участников без галочек, файлов и системных окон. Ссылка —
 * «секретная» (неугадываемая часть адреса), её можно сменить одной кнопкой.
 *
 * Честные подписи в интерфейсе (владелец не должен удивляться):
 *  - Google перечитывает чужой .ics раз в 12–24 часа и ускорить это нельзя;
 *  - у календаря, добавленного в Google «по URL», синхронизация с устройствами выключена
 *    по умолчанию (видно на компьютере, на телефоне — нет): включается на странице
 *    calendar.google.com/calendar/syncselect или переключателем «Синхронизация» в
 *    приложении Google Календарь. На части Android-телефонов и это не помогает — тогда
 *    работает «мост»: скрипт в аккаунте владельца пишет события в настоящий Google-календарь
 *    (scripts/google-bridge/Code.gs, инструкция docs/GOOGLE-BRIDGE.md);
 *  - на iPhone у подписного календаря есть «Удалить будильники» — если включён, событие
 *    видно, а звонка не будет; темп обновления задаёт сам телефон («Обновлять: 15 минут»);
 *  - у дел будильников в ленте нет: дело будит только исполнителя.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banner, Icon, Sheet, Skeleton, Switch } from '../../design/ui';
import { db } from '../../data/db';
import { copyText } from '../../shared/clipboard';
import {
  checkFeedSection,
  feedUrl,
  fetchFeedIds,
  loadFeedConfig,
  readFeedState,
  rotateFeedLinks,
  setFeedSection,
  type FeedCheck,
  type FeedConfig,
  type FeedSection,
  type FeedState,
} from '../../data/remote/feed';
import { describeStorageFailure } from '../../notifications/channels';
import { wakeHint, wakePushSender } from '../../data/remote/wake';
import { eventsWord, formatPublishedAt } from './feedFormat';

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

/** Результат чтения файла: прочитан, ещё не создан или прочитать не удалось. */
type FeedCheckResult =
  | { kind: 'checking' }
  | { kind: 'ok'; check: FeedCheck }
  | { kind: 'not-published' }
  | { kind: 'unreachable' };

/**
 * Итог сверки под ссылкой: сколько событий в файле и что не попало. Показываем не больше
 * трёх названий — остальное владельцу не нужно, а длинный список ломает компактность.
 * Если файл не прочитался, честно объясняем, что это значит для подписки (ничего плохого:
 * календарь скачивает ленту со своей стороны) и как проверить вручную.
 */
function FeedCheckLine({ result, section }: { result: FeedCheckResult; section: FeedSection }) {
  if (result.kind === 'checking') {
    return (
      <span className="tiny muted" data-testid={`feed-check-${section}`}>
        Проверяю файл…
      </span>
    );
  }
  if (result.kind === 'not-published') {
    return (
      <div className="stack tiny muted" style={{ gap: 4 }} data-testid={`feed-check-${section}`}>
        <span>
          Файла по этой ссылке пока нет. Нажмите «Обновить ленту сейчас» — появится через 1–2
          минуты. Если недавно нажимали «Сменить ссылку», вставьте новый адрес в календарь.
        </span>
      </div>
    );
  }
  if (result.kind === 'unreachable') {
    return (
      <div className="stack tiny muted" style={{ gap: 4 }} data-testid={`feed-check-${section}`}>
        <span>
          С телефона прочитать не удалось — обычно так делает провайдер. На подписку это не влияет:
          календарь скачивает ленту сам.
        </span>
        <span>
          Проверить вручную: откройте ссылку выше в браузере — должен открыться текст, начинающийся
          с BEGIN:VCALENDAR.
        </span>
      </div>
    );
  }
  return <FeedCheckBody check={result.check} section={section} />;
}

function FeedCheckBody({ check, section }: { check: FeedCheck; section: FeedSection }) {
  const [expanded, setExpanded] = useState(false);
  const notable = useMemo(
    () =>
      check.missing.filter((gap) => gap.reason !== 'ещё не опубликовано — подождите пару минут'),
    [check.missing],
  );
  const pending = check.missing.length - notable.length;
  const hasGaps = check.missing.length > 0;
  const shown = expanded ? notable : notable.slice(0, 3);
  return (
    <div className="stack tiny muted" style={{ gap: 4 }} data-testid={`feed-check-${section}`}>
      <span>
        В файле сейчас: {check.published} {eventsWord(check.published)}
        {check.published === 0 ? ' — пока пусто.' : '.'}
      </span>
      {pending > 0 && <span>Ещё не опубликовано: {pending} — подождите пару минут.</span>}
      {notable.length > 0 && (
        <span>
          Не попали: {shown.map((gap) => `«${gap.title}» — ${gap.reason}`).join('; ')}
          {notable.length > 3 && !expanded && (
            <>
              {' '}
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setExpanded(true)}
              >
                показать все ({notable.length})
              </button>
            </>
          )}
        </span>
      )}
      {hasGaps && (
        <span>Если в Google событий ещё нет — он обновит файл сам, раз в 12–24 часа.</span>
      )}
    </div>
  );
}

export default function FeedSubscriptionSection() {
  const [state, setState] = useState<FeedState | null | undefined>(undefined);
  const [cfg, setCfg] = useState<FeedConfig | null>(null);
  const [busy, setBusy] = useState(false);
  // «Обновить ленту сейчас»: просим GitHub запустить отправителя, не дожидаясь расписания
  // (оно берёт код из main и до переноса ленту не публикует). После запуска сами
  // перечитываем файл, чтобы владелец увидел результат, не заходя в GitHub.
  const [wakeBusy, setWakeBusy] = useState(false);
  const [checkTick, setCheckTick] = useState(0);
  // Сверка с опубликованным файлом: сколько событий реально лежит по ссылке и что из
  // семейных записей туда не попало. Нужна, чтобы владелец не гадал, кто виноват —
  // приложение, публикация или календарь (Google перечитывает подписку сам, часами).
  const [checks, setChecks] = useState<Partial<Record<FeedSection, FeedCheckResult>>>({});
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

  const publishNow = async () => {
    setWakeBusy(true);
    setNotice(null);
    const outcome = await wakePushSender('feed', { force: true });
    setWakeBusy(false);
    if (outcome.kind === 'sent') {
      setNotice({
        tone: 'ok',
        text: 'Запуск принят. Через 1–2 минуты лента обновится — перечитаю файл автоматически.',
      });
      // Перечитываем файл после публикации: не сразу, а когда отправитель успеет отработать.
      window.setTimeout(() => setCheckTick((n) => n + 1), 90_000);
    } else {
      setNotice({ tone: 'warn', text: wakeHint(outcome) });
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

  const localDeadlines = useLiveQuery(() => db.deadlines.toArray(), [], []);
  const localTasks = useLiveQuery(() => db.tasks.toArray(), [], []);

  // Сверяем только включённые разделы и только когда отправитель уже публиковал файл.
  useEffect(() => {
    if (!cfg || !state) return;
    let cancelled = false;
    void (async () => {
      for (const section of ['deadlines', 'tasks'] as const) {
        if (!state.sections[section] || state.publishedAt === null) continue;
        // Метка «проверяю…» сразу: чтение файла занимает до нескольких секунд, и без неё
        // нажатие кнопки выглядит так, будто ничего не произошло (жалоба владельца 05.10.2026).
        setChecks((prev) => ({ ...prev, [section]: { kind: 'checking' } }));
        const file = await fetchFeedIds(cfg, state.slugs[section]);
        if (cancelled) return;
        if (file.kind !== 'ok') {
          setChecks((prev) => ({ ...prev, [section]: { kind: file.kind } }));
          continue;
        }
        const items = section === 'deadlines' ? localDeadlines : localTasks;
        setChecks((prev) => ({
          ...prev,
          [section]: { kind: 'ok', check: checkFeedSection(section, items, file.ids) },
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg, state, localDeadlines, localTasks, checkTick]);

  const anyEnabled = state ? state.sections.deadlines || state.sections.tasks : false;
  const anyChecking = (['deadlines', 'tasks'] as const).some((s) => checks[s]?.kind === 'checking');

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
        События сами появляются в календаре телефона. Подпишитесь один раз — дальше без файлов.
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
              disabled={wakeBusy}
              onClick={() => void publishNow()}
            >
              {wakeBusy ? 'просим запуск…' : 'Обновить ленту сейчас'}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={!anyEnabled || anyChecking}
              onClick={() => setCheckTick((n) => n + 1)}
            >
              {anyChecking ? 'читаю файл…' : 'Перечитать файл'}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setHelpOpen(true)}
            >
              Как подписаться
            </button>
          </div>

          {state && anyEnabled && state.publishedAt !== null && (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              {(['deadlines', 'tasks'] as const).map((section) =>
                state.sections[section] && checks[section] ? (
                  <div key={section} className="stack" style={{ gap: 2 }}>
                    <span className="tiny strong">{SECTION_INFO[section].title}:</span>
                    <FeedCheckLine result={checks[section]} section={section} />
                  </div>
                ) : null,
              )}
            </div>
          )}
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
            Лента — календарь, который телефон скачивает сам. Ссылка одна на всю семью; календарь
            перечитывает её сам: на iPhone это настраивается (можно поставить 15 минут), Google
            обновляет чужой файл раз в 12–24 часа — быстрее нельзя.
          </p>
          <div className="small">
            <div className="strong">Подписаться (один раз на телефон)</div>
            <div className="muted">
              iPhone: Настройки → Приложения → Календарь → Учётные записи → Добавить → Другое →
              Подписной календарь → вставить ссылку. Затем откройте этот календарь в списке
              учётных записей и поставьте «Обновлять: каждые 15 минут» (по умолчанию реже).
            </div>
            <div className="muted">
              Android/Google: на компьютере calendar.google.com → «Другие календари» → «+» →
              «Добавить по URL» → вставить ссылку. Затем обязательно включите синхронизацию этого
              календаря с телефоном (см. ниже) — без неё событий на телефоне не будет.
            </div>
          </div>
          <div className="small">
            <div className="strong">Видно в Google на компьютере, а на телефоне нет</div>
            <div className="muted">
              Так бывает с календарями, добавленными в Google «по URL»: у них синхронизация с
              телефоном выключена по умолчанию. Включите её: откройте
              calendar.google.com/calendar/syncselect → галочка у календаря Ленты → «Сохранить»
              (если на телефоне есть приложение Google Календарь — Настройки → выбрать календарь →
              «Синхронизация»).
            </div>
            <div className="muted">
              Если и это не помогло (на части Android-телефонов подписки по URL не доходят вовсе) —
              нужен «мост»: события ленты записываются прямо в настоящий Google-календарь
              «Family Hub (мост)», и телефон видит их как обычные. Это разовая настройка в своём Google-аккаунте, без
              приложений на телефоне; пошаговая инструкция — docs/GOOGLE-BRIDGE.md в репозитории.
            </div>
            <div className="muted">
              Мост работает сам по себе: он читает файл ленты из интернета и не зависит от
              приложения на телефоне. Даже если удалить приложение и поставить заново, уже
              перенесённые события останутся, а мост продолжит обновлять календарь.
            </div>
          </div>
          <div className="small">
            <div className="strong">Что важно знать</div>
            <div className="muted">
              Обновление не мгновенное: Google перечитывает чужой файл раз в 12–24 часа, а на
              Android-телефоны такие подписки часто не доходят вовсе — поэтому в приложении есть
              «мост» (выше). Сам файл ленты обновляется через 1–2 минуты после правки.
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
