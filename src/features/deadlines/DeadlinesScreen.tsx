/**
 * Сроки семьи — ЭТАП 6-минимум: документы, мероприятия и прочее с датами и
 * напоминаниями (решение владельца 2026-10-01: редкие, но важные уведомления).
 *
 * Минимум осознанно: название, тип, дата, ступени напоминаний. Повторения,
 * история замен и приватность — следующие куски ЭТАПА 6.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { deadlinesRepo } from '../../data/repositories';
import { daysUntil, formatRu, humanizeDelta, isDateOnly, parseRuDate } from '../../domain/dateOnly';
import type { Deadline, DeadlineKind } from '../../domain/types';
import { Banner, Field, Icon, Sheet, Skeleton } from '../../design/ui';
import { downloadIcs } from '../../notifications/ics';
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

export default function DeadlinesScreen({ ready }: { ready: boolean }) {
  const rows = useLiveQuery(() => db.deadlines.toArray(), [], undefined);
  const sync = useSyncState();
  const [editing, setEditing] = useState<Deadline | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const live = useMemo(() => {
    if (!rows) return null;
    return rows
      .filter((r) => !r.deletedAt && r.visibility === 'family')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [rows]);

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
        onClick={() => {
          void db.deadlines.toArray().then((all) => downloadIcs(all.filter((d) => !d.deletedAt)));
        }}
      >
        <Icon name="calendar" size={20} /> В календарь телефона (резервно)
      </button>

      {composeOpen && <DeadlineSheet onClose={() => setComposeOpen(false)} />}
      {editing && <DeadlineSheet editing={editing} onClose={() => setEditing(null)} />}
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

function DeadlineSheet({ onClose, editing }: { onClose: () => void; editing?: Deadline | null }) {
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
    try {
      if (editing) {
        await deadlinesRepo.update(editing.id, {
          title: raw,
          deadlineKind: kind,
          dueDate: due,
          remindersDays: steps,
          alertDays: alertD,
          warnDays: warnD,
        });
      } else {
        await deadlinesRepo.add({
          title: raw,
          deadlineKind: kind,
          dueDate: due,
          remindersDays: steps,
          alertDays: alertD,
          warnDays: warnD,
        });
      }
      onClose();
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
