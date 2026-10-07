/**
 * «Для разработчика» (07.10.2026) — отдельная страница, а не блок внутри Настроек или
 * «О приложении»: заходят редко и по делу (диагностика, журнал, версия, схема данных).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kvGet, KV_KEYS } from '../../data/db';
import { useSyncLog, useSyncState } from '../../app/hooks';
import { isIos, isStandalone } from '../../notifications/channels';
import { SCHEMA_VERSION } from '../../domain/types';
import { Icon } from '../../design/ui';
import DiagnosticsSection from '../dev/DiagnosticsSection';
import { describeEvent } from '../settings/helpers';

const CODE_REPO = 'https://github.com/Help-yourself-dvp/FAMILY-HUB';

export default function DevScreen() {
  const sync = useSyncState();
  const entries = useSyncLog();
  const [remote, setRemote] = useState<{ owner: string; repo: string; branch: string } | null>(
    null,
  );

  useEffect(() => {
    void (async () => {
      const owner = await kvGet<string>(KV_KEYS.remoteOwner);
      const repo = await kvGet<string>(KV_KEYS.remoteRepo);
      const branch = (await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main';
      setRemote(owner && repo ? { owner, repo, branch } : null);
    })();
  }, []);

  return (
    <div className="screen">
      <div className="small muted">
        Технические подробности: состояние хранилища, диагностика устройства и журнал. Ничего
        семейного здесь нет — только служебные сведения.
      </div>

      <section className="stack" aria-label="Хранилище и код">
        <h2 className="section-title">Хранилище и код</h2>
        <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="small muted">
            Код приложения: <a href={CODE_REPO}>Help-yourself-dvp/FAMILY-HUB</a> — оттуда приходят
            обновления, там же лежит публичная страница (GitHub Pages).
          </div>
          <div className="small muted">
            Хранилище семьи:{' '}
            {remote ? (
              <>
                приватный репозиторий{' '}
                <span className="mono">
                  {remote.owner}/{remote.repo}
                </span>{' '}
                (ветка {remote.branch})
              </>
            ) : (
              'не подключено — данные пока только на этом телефоне'
            )}
            . <Link to="/settings">Открыть настройки подключения</Link>
          </div>
          <div className="tiny mono muted">
            Схема данных v{SCHEMA_VERSION} · семейных данных здесь нет
            {isIos() ? ' · iOS' : ' · Android или компьютер'}
            {isStandalone() ? ' · установлено как приложение' : ' · работает в браузере'}
          </div>
          <div className="tiny muted">
            Family Hub {__APP_VERSION__}
            {sync.rateRemaining !== null
              ? ` · связь с хранилищем: запас ${sync.rateRemaining} из 5000 запросов в час`
              : ''}
          </div>
        </div>
      </section>

      <DiagnosticsSection />

      <section className="stack" aria-label="Журнал синхронизации">
        <h2 className="section-title">Журнал синхронизации</h2>
        <div className="card stack" style={{ gap: 6, maxHeight: 240, overflowY: 'auto' }}>
          {entries.length === 0 && <div className="small muted">Событий пока нет.</div>}
          {entries
            .slice()
            .reverse()
            .slice(0, 40)
            .map((e, i) => (
              <div key={i} className="row" style={{ gap: 8 }}>
                <span className="tiny mono muted" style={{ flex: '0 0 auto' }}>
                  {new Date(e.at).toLocaleTimeString('ru-RU')}
                </span>
                <span className="tiny mono truncate">{describeEvent(e.event)}</span>
              </div>
            ))}
        </div>
        <div className="tiny muted">
          Журнал намеренно содержит только структурные события: ни содержимого покупок, ни токенов
          (§6.19).
        </div>
      </section>

      <div className="card stack" style={{ gap: 'var(--sp-2)' }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="info" size={16} />
          <span className="strong small">Как передать отчёт</span>
        </div>
        <div className="small muted">
          В диагностике выше есть кнопка «Скопировать отчёт»: она собирает версию приложения, схему
          данных, состояние хранилища и последние события — без содержимого покупок, дел и сроков.
          Скопированный текст можно переслать разработчику.
        </div>
      </div>
    </div>
  );
}
