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
      <details className="acc">
        <summary className="acc-summary">
          <span className="grow">Синхронизация</span>
          <span className="acc-hint">Статус, очередь отправки, когда была последняя</span>
          <Icon name="chevron" size={18} className="chev" />
        </summary>
        <div className="acc-body stack">
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
              В очереди на отправку: <b>{sync.pendingCount}</b>
              {sync.lastDurationMs !== null
                ? ` · последний цикл ${(sync.lastDurationMs / 1000).toFixed(1)} с`
                : ''}
            </div>
            {sync.phase === 'offline' && sync.online && (
              <div className="tiny" style={{ color: 'var(--warn)' }}>
                Сеть снова есть — синхронизация повторится автоматически.
              </div>
            )}
            {sync.lastError && (
              <div className="tiny" style={{ color: 'var(--err)' }}>
                Последний цикл завершился ошибкой: изменения в очереди{' '}
                {sync.pendingCount > 0 ? 'ждут отправки' : 'обработаны до сбоя'}.
              </div>
            )}
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
                <Icon name="refresh" size={18} />{' '}
                {busy ? 'Синхронизация…' : 'Синхронизировать сейчас'}
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
        </div>
      </details>
    </section>
  );
}
