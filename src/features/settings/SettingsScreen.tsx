/**
 * Настройки (§24) + подключение к семейному репозиторию (§2.5) + Диагностика (§11).
 *
 * Самый важный экран ЭТАПА 1: именно здесь проверяется, работает ли синхронизация
 * между двумя телефонами. Секции вынесены в отдельные файлы (§6.18).
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

export default function SettingsScreen({ ready }: { ready: boolean }) {
  const sync = useSyncState();
  const entries = useSyncLog();

  return (
    <div className="screen">
      <div className="screen-subtitle">
        версия {__APP_VERSION__} · схема данных v{SCHEMA_VERSION}
      </div>

      {!ready && <Banner tone="warn">Инициализация…</Banner>}

      <ProfileSection />
      <ConnectionSection />
      <SyncSection />
      <ThemeSection />
      <NotificationsSection />
      <DataSection />
      <DiagnosticsSection />

      <section className="stack">
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
      </section>

      <section className="card stack">
        <div className="row" style={{ gap: 8 }}>
          <Icon name="info" size={16} />
          <span className="strong small">О приложении</span>
          <span className="badge" style={{ marginLeft: 'auto' }}>
            версия {__APP_VERSION__}
          </span>
        </div>
        <div className="tiny muted">
          Family Hub — приватное семейное приложение: общий список покупок и напоминания о сроках.
          Работает без интернета, синхронизируется через ваше личное хранилище GitHub, обновляется
          само. Приложение не хранит номера документов, пароли и сканы: для напоминания достаточно
          названия и даты.
        </div>
        <div className="tiny mono muted">
          Схема данных v{SCHEMA_VERSION}
          {isIos() ? ' · iOS' : ''}
          {isStandalone() ? ' · PWA установлено' : ' · работает в браузере'}
        </div>
      </section>

      <div style={{ height: 24 }} aria-hidden="true" />
      <div className="tiny muted" style={{ textAlign: 'center' }}>
        Family Hub {__APP_VERSION__}
        {sync.rateRemaining !== null
          ? ` · связь с хранилищем: запас ${sync.rateRemaining} из 5000 запросов в час (нам хватает с огромным запасом)`
          : ''}
      </div>
    </div>
  );
}
