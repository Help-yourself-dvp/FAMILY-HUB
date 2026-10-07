/**
 * Настройки (§24) + подключение к семейному репозиторию (§2.5) + «Для разработчика» (§11).
 *
 * Структура с 0.6.24 (просьба владельца 07.10.2026): группы по смыслу —
 * «Профиль», «Семья и синхронизация», «Уведомления», «Оформление», «Данные»,
 * «Для разработчика». Технические подробности (версия, схема, журнал, диагностика)
 * живут в последней группе, чтобы не мешать обычной настройке.
 */
import { useSyncLog, useSyncState } from '../../app/hooks';
import { isIos, isStandalone } from '../../notifications/channels';
import { SCHEMA_VERSION } from '../../domain/types';
import { Banner, Icon } from '../../design/ui';
import { describeEvent } from './helpers';
import ProfileSection from './ProfileSection';
import ConnectionSection from './ConnectionSection';
import SyncSection from './SyncSection';
import ThemeSection from './ThemeSection';
import NotificationsSection from './NotificationsSection';
import DataSection from './DataSection';
import DiagnosticsSection from './DiagnosticsSection';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stack" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsScreen({ ready }: { ready: boolean }) {
  const sync = useSyncState();
  const entries = useSyncLog();

  return (
    <div className="screen">
      <div className="screen-subtitle">версия {__APP_VERSION__}</div>

      {!ready && <Banner tone="warn">Инициализация…</Banner>}

      <Group title="Профиль">
        <ProfileSection />
      </Group>

      <Group title="Семья и синхронизация">
        <ConnectionSection />
        <SyncSection />
      </Group>

      <Group title="Уведомления">
        <NotificationsSection />
      </Group>

      <Group title="Оформление">
        <ThemeSection />
      </Group>

      <Group title="Данные">
        <DataSection />
      </Group>

      <Group title="Для разработчика">
        <DiagnosticsSection />

        <details className="acc">
          <summary className="acc-summary">
            <span className="grow">Журнал синхронизации</span>
            <span className="acc-hint">События и времена запросов — для отчёта</span>
            <Icon name="chevron" size={18} className="chev" />
          </summary>
          <div className="acc-body stack">
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
              Журнал намеренно содержит только структурные события: ни содержимого покупок, ни
              токенов (§6.19).
            </div>
          </div>
        </details>

        <div className="card stack" style={{ gap: 6 }}>
          <div className="small muted">
            Схема данных v{SCHEMA_VERSION}
            {isIos() ? ' · iOS' : ''}
            {isStandalone() ? ' · PWA установлено' : ' · работает в браузере'}
          </div>
          <div className="tiny muted">
            Family Hub {__APP_VERSION__}
            {sync.rateRemaining !== null
              ? ` · связь с хранилищем: запас ${sync.rateRemaining} из 5000 запросов в час`
              : ''}
          </div>
        </div>
      </Group>
    </div>
  );
}
