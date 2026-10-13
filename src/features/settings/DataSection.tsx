/** Настройки · DataSection */
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { wipeLocalData } from '../../data/remote/authStrategy';
import { restartSync } from '../../app/bootstrap';
import { plural } from '../../domain/plural';
import { applyRestore, buildBackup, parseBackup, planRestore } from '../../data/backup';
import { Banner, Icon } from '../../design/ui';

type Feedback = { text: string; tone: 'ok' | 'warn' | 'err' };

export default function DataSection() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const counts = useLiveQuery(
    async () => ({
      shopping: await db.shopping.count(),
      tasks: await db.tasks.count(),
      deadlines: await db.deadlines.count(),
      members: await db.members.count(),
      activity: await db.activity.count(),
    }),
    [],
    undefined,
  );

  const exportBackup = async () => {
    const payload = await buildBackup(__APP_VERSION__);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `family-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setFeedback({ text: 'Резервная копия сохранена в загрузки', tone: 'ok' });
  };

  /** Восстановление из выбранного файла: сначала показываем план, потом пишем. */
  const restoreFromFile = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFeedback({ text: 'Не удалось прочитать файл. Попробуйте выбрать его ещё раз.', tone: 'err' });
      return;
    }

    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setFeedback({ text: parsed.error, tone: 'err' });
      return;
    }

    const plan = await planRestore(parsed.payload);
    const { added, updated, skipped } = plan.totals;
    if (added + updated === 0) {
      setFeedback({
        text:
          'Всё из этой копии уже есть на устройстве — восстанавливать нечего.' +
          (skipped ? ` Совпало записей: ${skipped}.` : ''),
        tone: 'warn',
      });
      return;
    }

    const when = parsed.payload.exportedAt
      ? ` от ${new Date(parsed.payload.exportedAt).toLocaleDateString('ru-RU')}`
      : '';
    const ok = window.confirm(
      `Восстановить данные из копии${when}?\n\n` +
        `Будет добавлено: ${added} ${plural(added, 'запись', 'записи', 'записей')}.\n` +
        `Будет обновлено: ${updated}.\n` +
        (skipped ? `Уже есть, остаётся как есть: ${skipped}.\n` : '') +
        '\nНичего не удаляется. Синхронизированные данные останутся в семейном хранилище.',
    );
    if (!ok) return;

    try {
      await applyRestore(plan);
    } catch {
      setFeedback({ text: 'Восстановить не получилось — данные не изменены. Попробуйте ещё раз.', tone: 'err' });
      return;
    }
    const synced = await restartSync();
    setFeedback({
      text:
        `Восстановлено: добавлено ${added}, обновлено ${updated}.` +
        (synced
          ? ' Отправляем в семейное хранилище.'
          : ' Синхронизация не подключена — данные сохранены на этом устройстве.'),
      tone: 'ok',
    });
  };

  const clearDemo = async () => {
    if (!window.confirm('Удалить демонстрационные покупки?')) return;
    const all = await db.shopping.toArray();
    const demo = all.filter((i) => i.note === 'демо');
    await db.shopping.bulkDelete(demo.map((d) => d.id));
    setFeedback({ text: `Удалено демо-позиций: ${demo.length}`, tone: 'ok' });
  };

  const wipe = async () => {
    const ok = window.confirm(
      'Удалить ВСЕ локальные данные на этом устройстве?\n\n' +
        'Если синхронизация подключена, данные останутся в репозитории и загрузятся снова.\n' +
        'Если не подключена — они будут потеряны безвозвратно.',
    );
    if (!ok) return;
    const ok2 = window.confirm('Точно удалить? Это действие нельзя отменить.');
    if (!ok2) return;
    await wipeLocalData();
    setFeedback({ text: 'Локальные данные удалены', tone: 'ok' });
  };

  return (
    <section className="stack">
      <details className="acc" open={false}>
        <summary className="acc-summary">
          <span className="grow">Данные</span>
          <span className="acc-hint">Резервная копия, демо-записи, очистка</span>
          <Icon name="chevron" size={18} className="chev" />
        </summary>
        <div className="acc-body stack">
          <div className="card stack">
            <div className="tiny muted mono">
              {counts
                ? `покупок: ${counts.shopping} · дел: ${counts.tasks} · сроков: ${counts.deadlines} · профилей: ${counts.members} · событий: ${counts.activity}`
                : 'считаем…'}
            </div>
            {feedback && <Banner tone={feedback.tone}>{feedback.text}</Banner>}
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <button type="button" className="btn grow" onClick={() => void exportBackup()}>
                Экспорт резервной копии
              </button>
              <button
                type="button"
                className="btn btn--ghost grow"
                onClick={() => fileRef.current?.click()}
              >
                Восстановить из копии
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Сбрасываем значение: тот же файл можно выбрать повторно.
                  e.target.value = '';
                  if (file) void restoreFromFile(file);
                }}
              />
            </div>
            <button type="button" className="btn btn--ghost" onClick={() => void clearDemo()}>
              Удалить демо-данные
            </button>
            <div className="tiny muted">
              Копия — независимый канал: она нужна, если семейное хранилище (GitHub) окажется
              недоступно, если данные случайно удалят и синхронизация разнесёт удаление на все
              устройства, или при переносе на новый телефон. «Восстановить из копии» добавляет
              записи из файла и обновляет устаревшие; ничего не удаляется.
            </div>
            <button
              type="button"
              className="btn btn--danger btn--block btn--sm"
              onClick={() => void wipe()}
            >
              Удалить все локальные данные
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block btn--sm"
              onClick={() => void restartSync()}
            >
              Переподключить синхронизацию
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
