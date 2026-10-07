/** Общая форма обычного и быстрого добавления; запись локальная, сеть не блокирует UI. */
import { useState } from 'react';
import { Field, Sheet } from '../../design/ui';
import { tasksRepo } from '../../data/repositories';
import { isDateOnly, parseRuDate } from '../../domain/dateOnly';
import type { Member, Task } from '../../domain/types';

export default function TaskSheet({
  editing,
  members,
  onClose,
}: {
  editing?: Task;
  members: Member[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [assigneeId, setAssigneeId] = useState(editing?.assigneeId ?? '');
  const [date, setDate] = useState(editing?.dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousAssigneeUnavailable =
    assigneeId && !members.some((member) => member.id === assigneeId);
  // Кто последним менял дело — раньше это висело в каждой строке списка («Последнее
  // изменение: …»), что читалось как аудит. Теперь видно только при открытии дела (07.10.2026).
  const lastEditor = editing
    ? (members.find((member) => member.id === editing.updatedBy)?.name ?? editing.updatedBy)
    : null;

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) {
      setError('Напишите, что нужно сделать.');
      return;
    }
    const dueDate = date.trim() ? (isDateOnly(date) ? date : parseRuDate(date)) : null;
    if (date.trim() && !dueDate) {
      setError('Проверьте дату: ДД.ММ.ГГГГ или выбор в календаре.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { title, note, assigneeId: assigneeId || null, dueDate };
      if (editing) await tasksRepo.update(editing.id, input);
      else await tasksRepo.add(input);
      onClose();
    } catch {
      setError('Не удалось сохранить дело на устройстве. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title={editing ? 'Изменить дело' : 'Новое дело'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Что нужно сделать" error={error}>
          <input
            className="input"
            value={title}
            autoFocus
            placeholder="Например: Записаться к врачу"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Описание" hint="Необязательно: подробности для исполнителя">
          <textarea
            className="textarea"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Field label="Исполнитель">
          <select
            className="select"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">Без исполнителя</option>
            {members.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name || 'Без имени'}
              </option>
            ))}
            {previousAssigneeUnavailable && (
              <option value={assigneeId}>Прежний участник (недоступен)</option>
            )}
          </select>
        </Field>
        <Field label="Срок" hint="Необязательно — дело может быть без даты">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        {date && (
          <button type="button" className="btn btn--sm" onClick={() => setDate('')}>
            Убрать срок
          </button>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>
          Уведомление о деле получает исполнитель; без исполнителя уведомлений нет. Подробности —
          за значком «i» вверху раздела.
        </p>
        {lastEditor && (
          <p className="tiny muted" style={{ margin: 0 }}>
            Последнее изменение: {lastEditor}.
          </p>
        )}
        <div className="sheet-footer">
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить дело'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
