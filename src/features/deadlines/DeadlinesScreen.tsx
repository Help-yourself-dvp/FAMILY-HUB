/**
 * Сроки семьи — ЭТАП 6-минимум: документы, мероприятия и прочее с датами и
 * напоминаниями (решение владельца 2026-10-01: редкие, но важные уведомления).
 *
 * Минимум осознанно: название, тип, дата, ступени напоминаний. Повторения,
 * история замен и приватность — следующие куски ЭТАПА 6.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, kvGet, kvSet, KV_KEYS } from '../../data/db';
import { deadlinesRepo } from '../../data/repositories';
import { daysUntil, formatRu, humanizeDelta, isDateOnly, parseRuDate } from '../../domain/dateOnly';
import type { Deadline, DeadlineKind } from '../../domain/types';
import { Banner, Field, Icon, Sheet, Skeleton } from '../../design/ui';
import {
  calendarAddTarget,
  calendarExportSummary,
  downloadIcs,
  downloadSingleDeadlineIcs,
  isAndroidClient,
  isIosClient,
  openSingleDeadlineIcs,
  type IcsDownloadResult,
} from '../../notifications/ics';
import {
  deadlineTone,
  KIND_THRESHOLDS,
  TONE_COLOR,
  thresholdsFor,
} from '../../domain/deadlineRules';
import { useSyncState } from '../../app/hooks';

export const KIND_LABEL: Record<DeadlineKind, string> = {
  document: 'Документ',
  vehicle: 'Машина',
  home: 'Дом и ЖКХ',
  insurance: 'Страховка',
  service: 'Подписка/сервис',
  birthday: 'День рождения',
  custom: 'Другое',
};

const REMINDER_STEPS: Array<{ days: number; label: string }> = [
  { days: 90, label: 'за 90 дней' },
  { days: 30, label: 'за 30 дней' },
  { days: 7, label: 'за 7 дней' },
  { days: 0, label: 'в день срока' },
];

export default function DeadlinesScreen({
  ready,
  composeKey = null,
}: {
  ready: boolean;
  /** Одноразовый запрос из круглого +, как в Покупках; сохраняется до готовности экрана. */
  composeKey?: string | null;
}) {
  const rows = useLiveQuery(() => db.deadlines.toArray(), [], undefined);
  const sync = useSyncState();
  // На iPhone/iPad календарь Apple сайт открыть не может (только файлом .ics),
  // а Google-формы там обычно нет — окно после сохранения ведёт к файлу.
  const ios = isIosClient();
  const android = isAndroidClient();
  // Честная подпись: что именно произойдёт после нажатия. Скрыть системный шаг нельзя —
  // календарь всегда спрашивает подтверждение сам.
  const calendarHelp = ios
    ? 'Откроется системное окно Календаря: выберите календарь и нажмите «Добавить». Если окно не появилось — нажмите «Скачать файлом».'
    : android
      ? 'Файл скачается. Нажмите «Открыть» в плашке загрузки (или откройте «Загрузки») — календарь покажет окно события: выберите календарь и нажмите «Сохранить».'
      : 'Файл скачается — откройте его, чтобы добавить событие в календарь.';
  const [editing, setEditing] = useState<Deadline | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [seenComposeKey, setSeenComposeKey] = useState<string | null>(null);
  if (composeKey && composeKey !== seenComposeKey) {
    setSeenComposeKey(composeKey);
    setComposeOpen(true);
  }
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarNotice, setCalendarNotice] = useState<{
    tone: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);
  // После сохранения с галочкой: окно-вопрос «добавить событие в календарь?».
  // Ничего не открываем само: скачивание и переход делает кнопка, по нажатию человека
  // (браузеры разрешают запуск/скачивание только из действия человека — это не обойти).
  const [calendarPrompt, setCalendarPrompt] = useState<{ deadline: Deadline } | null>(null);

  const live = useMemo(() => {
    if (!rows) return null;
    return rows
      .filter((r) => !r.deletedAt && r.visibility === 'family')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [rows]);

  const handleSaved = (d: Deadline, addToCalendar: boolean) => {
    setCalendarNotice(null);
    setCalendarPrompt(addToCalendar ? { deadline: d } : null);
  };

  /**
   * Кнопка окна-вопроса. На iPhone — сразу системное окно календаря (Safari показывает
   * его при прямом переходе на .ics). На Android и компьютере — скачивание файла: открыть
   * его за пользователя сайт не может, поэтому в подписи честно сказано, что нажать дальше.
   */
  const addOneToCalendar = (d: Deadline) => {
    if (ios) {
      const opened = openSingleDeadlineIcs(d);
      setCalendarNotice(
        opened
          ? {
              tone: 'ok',
              text: 'Открылось системное окно события: выберите календарь и нажмите «Добавить». Если окно не появилось — нажмите «Скачать файлом».',
            }
          : {
              tone: 'warn',
              text: 'Браузер не открыл окно сам. Нажмите «Скачать файлом» и коснитесь файла в «Загрузках» — Календарь покажет то же окно события.',
            },
      );
      return;
    }
    downloadOneForCalendar(d);
  };

  const downloadOneForCalendar = (d: Deadline) => {
    void downloadSingleDeadlineIcs(d)
      .then((date) => {
        setCalendarPrompt(null);
        setCalendarNotice({
          tone: 'ok',
          text: ios
            ? `Скачан файл: «${d.title}» (${formatRu(date)}), 09:00. Откройте «Файлы» → «Загрузки» и коснитесь файла — Календарь iPhone покажет событие, нажмите «Добавить».`
            : `Скачан файл: «${d.title}» (${formatRu(date)}), 09:00. Нажмите «Открыть» в плашке загрузки (или откройте «Загрузки») — календарь покажет окно события, выберите календарь и нажмите «Сохранить».`,
        });
      })
      .catch(() =>
        setCalendarNotice({
          tone: 'err',
          text: 'Не удалось подготовить событие для календаря. Повторите попытку.',
        }),
      );
  };

  if (!ready || !live) {
    return (
      <div className="screen">
        <Skeleton />
      </div>
    );
  }

  const overdue = live.filter((d) => daysUntil(d.dueDate) < 0);
  const soon = live.filter((d) => daysUntil(d.dueDate) >= 0 && daysUntil(d.dueDate) <= 30);
  const later = live.filter((d) => daysUntil(d.dueDate) > 30);

  return (
    <div className="screen">
      <div className="screen-subtitle">
        {live.length > 0 ? `${live.length} срок(ов) под наблюдением` : 'пока пусто'}
      </div>

      {!sync.configured && (
        <Banner tone="warn">
          <div className="grow">
            <div className="strong">Локальный режим</div>
            <div className="small">
              Сроки хранятся только на этом устройстве. Подключите семейное хранилище в настройках,
              чтобы напоминания были общими для всей семьи.
            </div>
          </div>
        </Banner>
      )}

      {live.length === 0 && (
        <Banner tone="ok">
          <div className="grow">
            <div className="strong">Добавьте первый срок</div>
            <div className="small">
              Например: «Паспорт РФ — замена» с датой и напоминаниями за 30 и 7 дней. Приложение
              напомнит само: в приложении — сразу, push для закрытого приложения появится на ЭТАПЕ
              3.
            </div>
          </div>
        </Banner>
      )}

      {overdue.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Просрочено · {overdue.length}</h2>
          <div className="stack">
            {overdue.map((d) => (
              <DeadlineRow key={d.id} d={d} onEdit={setEditing} />
            ))}
          </div>
        </section>
      )}

      {soon.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Ближайшие · {soon.length}</h2>
          <div className="stack">
            {soon.map((d) => (
              <DeadlineRow key={d.id} d={d} onEdit={setEditing} />
            ))}
          </div>
        </section>
      )}

      {later.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Впереди · {later.length}</h2>
          <div className="stack">
            {later.map((d) => (
              <DeadlineRow key={d.id} d={d} onEdit={setEditing} />
            ))}
          </div>
        </section>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block"
        style={{ marginTop: 'var(--sp-2)' }}
        onClick={() => setComposeOpen(true)}
      >
        <Icon name="plus" size={20} /> Добавить срок
      </button>
      <button
        type="button"
        className="btn btn--block"
        style={{ marginTop: 'var(--sp-2)' }}
        disabled={calendarBusy || live.length === 0}
        onClick={() => {
          setCalendarBusy(true);
          void downloadIcs(live)
            .then((result: IcsDownloadResult) => {
              setCalendarNotice({ tone: 'ok', text: calendarExportSummary(result) });
            })
            .catch(() => {
              setCalendarNotice({
                tone: 'err',
                text: 'Не удалось скачать календарь. Проверьте наличие семейных сроков с датой и повторите.',
              });
            })
            .finally(() => setCalendarBusy(false));
        }}
      >
        <Icon name="calendar" size={20} />{' '}
        {calendarBusy ? 'Готовим файл…' : 'Выгрузить все сроки файлом (.ics)'}
      </button>
      <p className="tiny muted" style={{ margin: 'var(--sp-1) 0 0' }}>
        Обычный способ — галочка «Добавить в календарь телефона» в форме срока: после сохранения
        приложение спросит, добавить ли событие, и подготовит его одним нажатием. Файл нужен редко:
        в нём сразу все сроки, и телефон добавит их все.
      </p>
      {calendarPrompt && (
        <Banner tone="warn">
          <div className="stack" data-testid="calendar-prompt" style={{ gap: 'var(--sp-2)' }}>
            <div className="strong" style={{ fontSize: 'var(--fs-md)' }}>
              Добавить событие в календарь телефона?
            </div>
            <div className="strong" style={{ fontSize: 'var(--fs-md)' }}>
              {`[Срок] ${calendarPrompt.deadline.title}`}
            </div>
            <div className="small">
              {`${formatRu(calendarPrompt.deadline.dueDate)}, 09:00–09:15 (Москва)`}
            </div>
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={() => addOneToCalendar(calendarPrompt.deadline)}
              >
                {ios ? 'Открыть окно события' : 'Скачать файл события'}
              </button>
              {ios && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => downloadOneForCalendar(calendarPrompt.deadline)}
                >
                  Скачать файлом
                </button>
              )}
              {!ios && (
                <a
                  className="btn btn--sm"
                  href={calendarAddTarget(calendarPrompt.deadline).url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Календарь
                </a>
              )}
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setCalendarPrompt(null)}
              >
                Не нужно
              </button>
            </div>
            <div className="tiny muted">{calendarHelp}</div>
          </div>
        </Banner>
      )}
      {calendarNotice && (
        <Banner tone={calendarNotice.tone}>
          <div className="grow small">{calendarNotice.text}</div>
        </Banner>
      )}

      {composeOpen && <DeadlineSheet onClose={() => setComposeOpen(false)} onSaved={handleSaved} />}
      {editing && (
        <DeadlineSheet editing={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}
      <div style={{ height: 64 }} aria-hidden="true" />
    </div>
  );
}

function DeadlineRow({ d, onEdit }: { d: Deadline; onEdit: (d: Deadline) => void }) {
  const left = daysUntil(d.dueDate);
  const toneKind = deadlineTone(d);
  const color = toneKind === 'ok' ? 'var(--text-2)' : TONE_COLOR[toneKind];
  const t = thresholdsFor(d);
  return (
    <div
      className="item"
      style={{ borderLeft: `4px solid ${TONE_COLOR[toneKind]}`, paddingLeft: 'var(--sp-3)' }}
    >
      <button
        type="button"
        className="grow item-hit"
        aria-label={`Изменить «${d.title}»`}
        onClick={() => onEdit(d)}
      >
        <div className="item-title">{d.title}</div>
        <div className="item-meta">
          {KIND_LABEL[d.deadlineKind]} · {formatRu(d.dueDate)} · напоминания:{' '}
          {d.remindersDays.length
            ? d.remindersDays.map((r) => (r === 0 ? 'в день' : r)).join(', ')
            : 'нет'}{' '}
          · цвет: красный за {t.alertDays}, жёлтый за {t.warnDays} дн.
        </div>
      </button>
      <div className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
        <span className="badge" style={{ color, borderColor: color }}>
          {left < 0 ? `просрочено ${-left} дн.` : humanizeDelta(left)}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Удалить «${d.title}»`}
          onClick={() => void deadlinesRepo.remove(d.id)}
        >
          <Icon name="trash" size={20} />
        </button>
      </div>
    </div>
  );
}

function DeadlineSheet({
  onClose,
  editing,
  onSaved,
}: {
  onClose: () => void;
  editing?: Deadline | null;
  /** Вызывается после сохранения: экран покажет окно-вопрос про календарь. */
  onSaved?: (d: Deadline, addToCalendar: boolean) => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [kind, setKind] = useState<DeadlineKind>(editing?.deadlineKind ?? 'document');
  const [date, setDate] = useState(editing?.dueDate ?? '');
  const [steps, setSteps] = useState<number[]>(editing?.remindersDays ?? [30, 7, 0]);
  const [customStep, setCustomStep] = useState('');
  const [alertD, setAlertD] = useState<number>(
    editing?.alertDays ?? KIND_THRESHOLDS[editing?.deadlineKind ?? 'document'].alertDays,
  );
  const [warnD, setWarnD] = useState<number>(
    editing?.warnDays ?? KIND_THRESHOLDS[editing?.deadlineKind ?? 'document'].warnDays,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Галочка «Добавить в календарь телефона» — решение владельца 03.10: открывается
  // окно создания события, сохранение подтверждает человек. Выбор запоминаем.
  const [addToCalendar, setAddToCalendar] = useState(true);
  useEffect(() => {
    void kvGet<boolean>(KV_KEYS.notifyCalendarAddOnSave).then((v) => {
      if (typeof v === 'boolean') setAddToCalendar(v);
    });
  }, []);

  const submit = async () => {
    const raw = title.trim();
    if (!raw) {
      setError('Введите название');
      return;
    }
    let due = date;
    if (!isDateOnly(due)) {
      // Прощаем ввод «18.10.2030» с клавиатуры телефона.
      const parsed = parseRuDate(due);
      if (!parsed) {
        setError('Дата в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД');
        return;
      }
      due = parsed;
    }
    setBusy(true);
    setError(null);
    // Календарь открываем СИНХРОННО, до любых await: Chrome запускает внешнее
    // приложение только из действия человека, а после ожидания жест «сгорает»
    // (developer.chrome.com/docs/android/intents). Данные для ссылки — из формы,
    // сохранение срока к ссылке не относится.
    // На iPhone (kind = none) не открываем ничего: веб-форма Google там бесполезна,
    // а окно создания в Календаре Apple недоступно сайту — человека ведёт окно экрана.
    try {
      await kvSet(KV_KEYS.notifyCalendarAddOnSave, addToCalendar);
      const patch = {
        title: raw,
        deadlineKind: kind,
        dueDate: due,
        remindersDays: steps,
        alertDays: alertD,
        warnDays: warnD,
      };
      const saved = editing
        ? await deadlinesRepo.update(editing.id, patch)
        : await deadlinesRepo.add(patch);
      onClose();
      const deadline = saved ?? (editing ? { ...editing, ...patch } : null);
      if (deadline) onSaved?.(deadline, addToCalendar);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title={editing ? 'Изменить срок' : 'Новый срок'} onClose={onClose}>
      <div className="stack">
        <Field label="Что за срок" error={error}>
          <input
            className="input"
            value={title}
            autoFocus
            placeholder="Например: Паспорт РФ — замена"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="field">
          <span className="field-label">Тип</span>
          <div className="chips" role="group" aria-label="Тип срока">
            {(Object.keys(KIND_LABEL) as DeadlineKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className="chip"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  // Цветовые правила подставляются из типа (можно поправить ниже).
                  setAlertD(KIND_THRESHOLDS[k].alertDays);
                  setWarnD(KIND_THRESHOLDS[k].warnDays);
                }}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Цвет рамки: красный и жёлтый за сколько дней</span>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <input
              className="input grow"
              type="number"
              min={0}
              max={3650}
              inputMode="numeric"
              value={alertD}
              aria-label="Красным за N дней"
              onChange={(e) => setAlertD(Math.max(0, Number(e.target.value) || 0))}
            />
            <input
              className="input grow"
              type="number"
              min={0}
              max={3650}
              inputMode="numeric"
              value={warnD}
              aria-label="Жёлтым за N дней"
              onChange={(e) => setWarnD(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Например: налог — красный за 7, жёлтый за 14; загранпаспорт — жёлтый за 365.
          </div>
        </div>
        <Field label="Дата" hint="ДД.ММ.ГГГГ или выбор в календаре">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div className="field">
          <span className="field-label">Напоминать</span>
          {/* Своя ступень (просьба владельца 2026-10-01): паспорт — за полгода,
              загранпаспорт — хоть за год (365). */}
          <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
            <input
              className="input grow"
              type="number"
              min={1}
              max={3650}
              inputMode="numeric"
              value={customStep}
              placeholder="Своя ступень: дней до срока (например, 180 или 365)"
              onChange={(e) => setCustomStep(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--sm"
              style={{ flex: '0 0 auto' }}
              onClick={() => {
                const n = Number(customStep);
                if (!Number.isFinite(n) || n < 1 || n > 3650) return;
                const whole = Math.round(n);
                setSteps((p) => (p.includes(whole) ? p : [...p, whole].sort((a, b) => b - a)));
                setCustomStep('');
              }}
            >
              <Icon name="plus" size={16} /> Добавить
            </button>
          </div>
          <div className="chips" role="group" aria-label="Ступени напоминаний">
            {[
              ...REMINDER_STEPS,
              ...steps
                .filter((d) => !REMINDER_STEPS.some((r) => r.days === d))
                .map((d) => ({ days: d, label: `за ${d} дн.` })),
            ]
              .sort((a, b) => b.days - a.days)
              .map((s) => (
                <button
                  key={s.days}
                  type="button"
                  className="chip"
                  aria-pressed={steps.includes(s.days)}
                  onClick={() =>
                    setSteps((p) =>
                      p.includes(s.days)
                        ? p.filter((x) => x !== s.days)
                        : [...p, s.days].sort((a, b) => b - a),
                    )
                  }
                >
                  {s.label}
                </button>
              ))}
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
          <button
            type="button"
            className="checkbox"
            role="checkbox"
            aria-checked={addToCalendar}
            aria-label="Добавить в календарь телефона"
            onClick={() => setAddToCalendar((v) => !v)}
          />
          <div className="grow">
            <div>Добавить в календарь телефона</div>
            <div className="tiny muted">
              Откроется окно создания события с названием, датой и временем — сохраните его там.
              Напоминания в окне обычные (из настроек календаря); наши ступени ведёт приложение.
            </div>
          </div>
        </div>
        <div className="sheet-footer">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
