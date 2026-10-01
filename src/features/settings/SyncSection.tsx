/** Настройки · SyncSection */
import { useState } from 'react';
import { flushNow, syncNow } from '../../data/sync/engine';
import { useSyncState } from '../../app/hooks';
import { PHASE_LABEL } from '../../data/sync/state';
import { Banner, Icon } from '../../design/ui';
import { suggestFix, toneColor } from './helpers';

export default function SyncSection() {
  const sync = useSyncState();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await syncNow('manual');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <h2 className="section-title">Синхронизация</h2>
      <div className="card stack">
        <div className="row row--between">
          <div className="row" style={{ gap: 8 }}>
            <span
              className={`dot ${sync.phase === 'syncing' ? 'dot--pulse' : ''}`}
              style={{ color: toneColor(sync.phase) }}
            />
            <span className="strong">{PHASE_LABEL[sync.phase]}</span>
          </div>
          <span className="badge">{sync.online ? 'сеть есть' : 'нет сети'}</span>
        </div>

        <div className="tiny muted">
          Последняя успешная:{' '}
          {sync.lastSuccessAt ? new Date(sync.lastSuccessAt).toLocaleString('ru-RU') : '—'}
        </div>
        <div className="tiny muted">
          Не отправлено изменений: <b>{sync.pendingCount}</b>
          {sync.lastDurationMs !== null
            ? ` · последняя синхронизация ${sync.lastDurationMs} мс`
            : ''}
        </div>
        {(sync.lastPushed > 0 || sync.lastPulled > 0 || sync.lastConflicts > 0) && (
          <div className="tiny muted">
            Последний цикл: отправлено {sync.lastPushed}, получено {sync.lastPulled}, конфликтов{' '}
            {sync.lastConflicts}
          </div>
        )}

        {sync.lastError && (
          <Banner tone="err">
            <div className="grow">
              <div className="strong small">{sync.lastError.code}</div>
              <div className="tiny mono">{sync.lastError.message}</div>
              <div className="tiny" style={{ marginTop: 4 }}>
                {suggestFix(sync.lastError.code)}
              </div>
            </div>
          </Banner>
        )}

        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button
            type="button"
            className="btn btn--primary grow"
            disabled={busy || !sync.configured}
            onClick={() => void run()}
          >
            <Icon name="refresh" size={18} /> {busy ? 'Синхронизация…' : 'Синхронизировать сейчас'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => flushNow('manual-settings')}
            disabled={!sync.configured}
          >
            Отправить очередь
          </button>
        </div>
      </div>
    </section>
  );
}
