/** Настройки · DataSection */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { wipeLocalData } from '../../data/remote/authStrategy';
import { restartSync } from '../../app/bootstrap';
import { SCHEMA_VERSION } from '../../domain/types';
import { Banner, Icon } from '../../design/ui';

export default function DataSection() {
  const [msg, setMsg] = useState<string | null>(null);
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
    const payload = {
      app: 'family-hub',
      format: 'family-hub-backup',
      schemaVersion: SCHEMA_VERSION,
      appVersion: __APP_VERSION__,
      exportedAt: new Date().toISOString(),
      data: {
        shopping: await db.shopping.toArray(),
        tasks: await db.tasks.toArray(),
        deadlines: await db.deadlines.toArray(),
        members: await db.members.toArray(),
        activity: await db.activity.toArray(),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `family-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setMsg('Резервная копия сохранена в загрузки');
  };

  const clearDemo = async () => {
    if (!window.confirm('Удалить демонстрационные покупки?')) return;
    const all = await db.shopping.toArray();
    const demo = all.filter((i) => i.note === 'демо');
    await db.shopping.bulkDelete(demo.map((d) => d.id));
    setMsg(`Удалено демо-позиций: ${demo.length}`);
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
    setMsg('Локальные данные удалены');
  };

  return (
    <section className="stack">
      <details className="acc">
        <summary className="acc-summary">
          <span className="grow">Данные</span>
          <span className="acc-hint">Демо-записи, локальная база, очистка</span>
          <Icon name="chevron" size={18} className="chev" />
        </summary>
        <div className="acc-body stack">
          <div className="card stack">
            <div className="tiny muted mono">
              {counts
                ? `покупок: ${counts.shopping} · дел: ${counts.tasks} · сроков: ${counts.deadlines} · профилей: ${counts.members} · событий: ${counts.activity}`
                : 'считаем…'}
            </div>
            {msg && <Banner tone="ok">{msg}</Banner>}
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <button type="button" className="btn grow" onClick={() => void exportBackup()}>
                Экспорт резервной копии
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void clearDemo()}>
                Удалить демо-данные
              </button>
            </div>
            <button
              type="button"
              className="btn btn--danger btn--block btn--sm"
              onClick={() => void wipe()}
            >
              Удалить все локальные данные
            </button>
            <div className="tiny muted">
              Импорт резервной копии с валидацией схемы — ЭТАП 10 (§6.14). Экспорт работает уже
              сейчас: это независимый канал восстановления, если GitHub станет недоступен.
            </div>
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

/* ------------------------------- Диагностика ------------------------------- */
