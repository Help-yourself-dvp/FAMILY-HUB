/**
 * Оболочка приложения: нижняя навигация (Главная · Покупки · Дела · Сроки),
 * доступ к Настройкам через аватар (§13), центральное «+» с bottom sheet (§13),
 * индикатор синхронизации (§6) и сообщение о новой версии (§6.1).
 */
import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Icon, Sheet, type IconName } from '../design/ui';
import { useSyncState } from './hooks';
import { PHASE_LABEL } from '../data/sync/state';
import { flushNow } from '../data/sync/engine';
import HomeScreen from '../features/home/HomeScreen';
import ShoppingScreen from '../features/shopping/ShoppingScreen';
import TasksScreen from '../features/tasks/PlaceholderScreen';
import DeadlinesScreen from '../features/deadlines/PlaceholderScreen';
import SettingsScreen from '../features/settings/SettingsScreen';

const TABS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Главная', icon: 'home' },
  { to: '/shopping', label: 'Покупки', icon: 'cart' },
  { to: '/tasks', label: 'Дела', icon: 'check' },
  { to: '/deadlines', label: 'Сроки', icon: 'calendar' },
];

export default function App({
  ready,
  updatedFrom,
}: {
  ready: boolean;
  updatedFrom?: string | null;
}) {
  return (
    <HashRouter>
      <ShellInner ready={ready} updatedFrom={updatedFrom ?? null} />
    </HashRouter>
  );
}

function ShellInner({ ready, updatedFrom }: { ready: boolean; updatedFrom: string | null }) {
  const loc = useLocation();
  return (
    <>
      <div className="app-shell">
        <UpdateBanner />
        <UpdatedNotice from={updatedFrom} />
        <TopBar />
        <Routes>
          <Route path="/" element={<HomeScreen ready={ready} />} />
          <Route
            path="/shopping"
            element={
              <ShoppingScreen
                ready={ready}
                composeKey={
                  loc.pathname === '/shopping' &&
                  (loc.state as { compose?: boolean } | null)?.compose === true
                    ? loc.key
                    : null
                }
              />
            }
          />
          <Route path="/tasks" element={<TasksScreen />} />
          <Route path="/deadlines" element={<DeadlinesScreen />} />
          <Route path="/settings" element={<SettingsScreen ready={ready} />} />
          <Route path="*" element={<HomeScreen ready={ready} />} />
        </Routes>
        {/* key по маршруту: sheet закрывается при навигации без setState в эффекте */}
        <QuickAddFab key={loc.pathname} />
        <TabBar />
      </div>
    </>
  );
}

function TabBar() {
  return (
    <nav className="tabbar" aria-label="Основная навигация">
      {TABS.slice(0, 2).map((t) => (
        <TabItem key={t.to} {...t} />
      ))}
      {/* Резерв под центральную FAB (§13) */}
      <span className="tab tab--spacer" aria-hidden="true">
        <Icon name="plus" />
        <span>Добавить</span>
      </span>
      {TABS.slice(2).map((t) => (
        <TabItem key={t.to} {...t} />
      ))}
      <NavLink to="/settings" className="tab" aria-label="Настройки" title="Настройки">
        <Icon name="gear" />
        <span>Ещё</span>
      </NavLink>
    </nav>
  );
}

function TabItem({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink to={to} end={to === '/'} className="tab">
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
}

/** Центральное быстрое действие «+» → bottom sheet (§13). */
function QuickAddFab() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const onSettings = loc.pathname === '/settings';

  if (onSettings) return null;

  const go = (path: string) => {
    setOpen(false);
    void nav(path, { state: { compose: true } });
  };

  return (
    <>
      <button
        type="button"
        className="fab"
        aria-label="Добавить"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="plus" size={26} />
      </button>

      <Sheet open={open} title="Что добавим?" onClose={() => setOpen(false)}>
        <div className="stack">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => go('/shopping')}
          >
            <Icon name="cart" size={20} /> Добавить покупку
          </button>
          <button type="button" className="btn btn--block" onClick={() => go('/tasks')} disabled>
            <Icon name="check" size={20} /> Добавить дело
            <span className="badge">ЭТАП 7</span>
          </button>
          <button
            type="button"
            className="btn btn--block"
            onClick={() => go('/deadlines')}
            disabled
          >
            <Icon name="calendar" size={20} /> Добавить срок
            <span className="badge">ЭТАП 6</span>
          </button>
        </div>
      </Sheet>
    </>
  );
}

/**
 * Видимая пометка post factum: «приложение обновилось с версии X».
 *
 * Молчаливое применение обновления при перезапуске — нормальное поведение PWA
 * (ожидающий Service Worker активируется, когда старых клиентов не осталось), и владелец
 * явно хочет «всё подтягивается само». Но обновление не должно быть НЕВИДИМЫМ: эта
 * плашка показывает факт и версии, данных не трогает, закрывается одной кнопкой.
 */
function UpdatedNotice({ from }: { from: string | null }) {
  const [hidden, setHidden] = useState(false);
  if (!from || hidden) return null;
  return (
    <div style={{ padding: 'calc(var(--sat) + 8px) var(--sp-4) 0' }}>
      <div className="banner">
        <Icon name="refresh" size={18} />
        <div className="grow">
          Приложение обновилось с версии {from} до {__APP_VERSION__}. Данные и настройки сохранены.
        </div>
        <button type="button" className="btn btn--sm" onClick={() => setHidden(true)}>
          Понятно
        </button>
      </div>
    </div>
  );
}

/**
 * Индикатор синхронизации В ПОТОКЕ РАЗМЕТКИ (не fixed!).
 *
 * Раньше он висел `position: fixed` в правом верхнем углу и перекрывал строки
 * интерфейса при прокрутке — владелец видел «наезжающий» значок и не мог прочитать
 * кнопку под ним. Теперь это обычная верхняя полоса: ничего не перекрывает никогда.
 *
 * Число рядом с надписью показывается ТОЛЬКО когда синхронизация подключена и есть
 * неотправленные изменения («Офлайн · 3 в очереди»). В локальном режиме числа нет:
 * там оно бессмысленно и пугает (дефект «Локальный режим 10» из приёмки 0.1.2).
 */
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Family Hub',
  '/shopping': 'Покупки',
  '/tasks': 'Дела',
  '/deadlines': 'Сроки',
  '/settings': 'Настройки',
};

/**
 * Одна верхняя строка: название раздела слева, статус синхронизации справа.
 * Приёмка 0.1.5: раньше статус занимал первую строку один, а название приложения
 * начиналось ниже — место съедалось зря.
 */
function TopBar() {
  const loc = useLocation();
  const title = ROUTE_TITLES[loc.pathname] ?? 'Family Hub';
  return (
    <div className="topbar">
      <div className="topbar-title truncate">{title}</div>
      <StatusPill />
    </div>
  );
}

function StatusPill() {
  const s = useSyncState();
  const nav = useNavigate();
  const tone =
    s.phase === 'error'
      ? 'err'
      : s.phase === 'synced'
        ? 'ok'
        : s.phase === 'offline'
          ? 'warn'
          : 'muted';
  const icon: IconName = s.online ? (s.phase === 'error' ? 'alert' : 'cloud') : 'cloud-off';

  const label =
    s.phase === 'not-configured'
      ? 'Локальный режим'
      : s.phase === 'offline'
        ? s.pendingCount > 0
          ? `Офлайн · ${s.pendingCount} в очереди`
          : 'Офлайн'
        : PHASE_LABEL[s.phase];

  const explanation =
    s.phase === 'not-configured'
      ? 'Данные хранятся только на этом устройстве. Нажмите, чтобы подключить семейное хранилище.'
      : s.phase === 'offline'
        ? s.pendingCount > 0
          ? `Нет сети. Изменений ждут отправки: ${s.pendingCount}. Они уйдут сами, когда сеть появится.`
          : 'Нет сети. Приложение работает офлайн.'
        : s.phase === 'error'
          ? 'Последняя синхронизация не удалась. Нажмите, чтобы открыть подробности.'
          : 'Нажмите, чтобы синхронизировать сейчас.';

  const onTap = () => {
    if (s.phase === 'not-configured' || s.phase === 'error') void nav('/settings');
    else void flushNow('manual');
  };

  return (
    <button
      type="button"
      className={`badge badge--${tone === 'muted' ? 'accent' : tone}`}
      style={{ opacity: s.phase === 'idle' && !s.configured ? 0 : 1, transition: 'opacity 200ms' }}
      onClick={onTap}
      aria-label={`Состояние синхронизации: ${label}. ${explanation}`}
      title={explanation}
    >
      <Icon name={icon} size={13} />
      {s.phase === 'syncing' && <span className="dot dot--pulse" />}
      <span>{label}</span>
    </button>
  );
}

/** Понятное сообщение при появлении новой версии (§6.1). */
function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const h = () => setAvailable(true);
    window.addEventListener('fh:update-available', h);
    return () => window.removeEventListener('fh:update-available', h);
  }, []);

  if (!available) return null;
  return (
    <div style={{ padding: 'calc(var(--sat) + 8px) var(--sp-4) 0' }}>
      <div className="banner banner--ok">
        <Icon name="refresh" size={18} />
        <div className="grow">Доступна новая версия приложения</div>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={() => {
            // §10: обновление применяется только по согласию пользователя.
            const reg = navigator.serviceWorker;
            void reg?.getRegistration().then((r) => {
              r?.waiting?.postMessage({ type: 'SKIP_WAITING' });
              setTimeout(() => window.location.reload(), 250);
            });
          }}
        >
          Обновить
        </button>
      </div>
    </div>
  );
}
