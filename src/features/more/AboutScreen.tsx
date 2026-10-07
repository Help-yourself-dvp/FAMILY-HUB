/**
 * «О приложении» (07.10.2026): короткая справка о самом приложении и блок
 * «Для разработчика» — версия, схема данных, где что лежит, ссылки на репозитории.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kvGet, KV_KEYS } from '../../data/db';
import { useSyncState } from '../../app/hooks';
import { isIos, isStandalone } from '../../notifications/channels';
import { SCHEMA_VERSION } from '../../domain/types';
import { Icon } from '../../design/ui';

const CODE_REPO = 'https://github.com/Help-yourself-dvp/FAMILY-HUB';

export default function AboutScreen() {
  const sync = useSyncState();
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
      <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="info" size={16} />
          <span className="strong small">Family Hub</span>
          <span className="badge" style={{ marginLeft: 'auto' }}>
            версия {__APP_VERSION__}
          </span>
        </div>
        <div className="small muted">
          Приватное семейное приложение: общий список покупок, общие дела и напоминания о сроках.
          Работает без интернета, синхронизируется через ваше личное хранилище на GitHub и
          обновляется само.
        </div>
        <div className="small muted">
          Приложение не хранит номера документов, пароли и сканы: для напоминания достаточно
          названия и даты. Ни рекламы, ни аналитики, ни подписок — 0 ₽ и только GitHub.
        </div>
        <div className="tiny mono muted">
          Схема данных v{SCHEMA_VERSION}
          {isIos() ? ' · iOS' : ' · Android или компьютер'}
          {isStandalone() ? ' · установлено как приложение' : ' · работает в браузере'}
        </div>
      </div>

      <section className="stack" aria-label="Для разработчика">
        <h2 className="section-title">Для разработчика</h2>
        <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="small muted">
            Код приложения: <a href={CODE_REPO}>Help-yourself-dvp/FAMILY-HUB</a>. Обновления
            публикуются туда же, страница приложения — GitHub Pages.
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
            .
          </div>
          <div className="small muted">
            Схема данных v{SCHEMA_VERSION}; записи хранятся файлами по видам (покупки, дела, сроки,
            участники) — формат описан в проекте.
          </div>
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <Link className="btn btn--sm" to="/settings">
              Настройки и диагностика
            </Link>
          </div>
        </div>
      </section>

      <div className="tiny muted" style={{ textAlign: 'center' }}>
        Family Hub {__APP_VERSION__}
        {sync.rateRemaining !== null
          ? ` · связь с хранилищем: запас ${sync.rateRemaining} из 5000 запросов в час`
          : ''}
      </div>
    </div>
  );
}
