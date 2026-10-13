/**
 * Настройки (§24) + подключение к семейному репозиторию (§2.5).
 *
 * Структура с 0.6.24 (просьба владельца 07.10.2026): группы по смыслу —
 * «Профиль», «Семья и синхронизация», «Уведомления», «Оформление», «Данные».
 * Технические подробности (диагностика, журнал, схема данных) живут на отдельной
 * странице «Для разработчика» (0.6.25) — обычная настройка от них не зависит.
 */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSyncState } from '../../app/hooks';
import { Banner } from '../../design/ui';
import ProfileSection from './ProfileSection';
import ConnectionSection from './ConnectionSection';
import SyncSection from './SyncSection';
import ThemeSection from './ThemeSection';
import NotificationsSection from './NotificationsSection';
import DataSection from './DataSection';

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
  const [params] = useSearchParams();
  // Переход из «Для разработчика» сразу к подключению: /settings?open=connection.
  const focusConnection = params.get('open') === 'connection';

  useEffect(() => {
    if (!focusConnection) return;
    // Секция раскрывается пропом, здесь только прокручиваем к ней (после отрисовки).
    const el = document.getElementById('connection');
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusConnection]);

  return (
    <div className="screen">
      <div className="screen-subtitle">версия {__APP_VERSION__}</div>

      {!ready && <Banner tone="warn">Инициализация…</Banner>}

      <Group title="Профиль">
        <ProfileSection />
      </Group>

      <Group title="Семья и синхронизация">
        <ConnectionSection initialOpen={focusConnection} />
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

      <div className="tiny muted" style={{ textAlign: 'center' }}>
        Family Hub {__APP_VERSION__}
        {sync.rateRemaining !== null
          ? ` · связь с хранилищем: запас ${sync.rateRemaining} из 5000 запросов в час`
          : ''}
      </div>
    </div>
  );
}
