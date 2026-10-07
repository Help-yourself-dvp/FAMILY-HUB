/**
 * Оболочка приложения: нижняя навигация (Главная · Покупки · Дела · Сроки),
 * доступ к Настройкам через аватар (§13), центральное «+» с bottom sheet (§13),
 * индикатор синхронизации (§6) и сообщение о новой версии (§6.1).
 */
import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Icon, Sheet, type IconName } from '../design/ui';
import { useSyncState } from './hooks';
import { phaseLabel } from '../data/sync/state';
import { flushNow } from '../data/sync/engine';
import { ErrorBoundary } from './ErrorBoundary';
import HomeScreen from '../features/home/HomeScreen';
import ShoppingScreen from '../features/shopping/ShoppingScreen';
import TasksScreen from '../features/tasks/TasksScreen';
import DeadlinesScreen from '../features/deadlines/DeadlinesScreen';
import SettingsScreen from '../features/settings/SettingsScreen';
import MoreScreen from '../features/more/MoreScreen';
import HelpScreen from '../features/more/HelpScreen';
import AboutScreen from '../features/more/AboutScreen';

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
  const navigate = useNavigate();
  const composeIntent = (loc.state as { compose?: boolean } | null)?.compose === true;

  // Запрос «открыть форму создания» из круглого «+» — одноразовый. Он лежит в состоянии
  // записи истории, а оно переживает перезагрузку страницы: свайп вниз на телефоне
  // перезагружает приложение, и форма открывалась заново при каждом обновлении, пока
  // пользователь не уходил в другой раздел. Гасим запрос сразу после того, как экран его
  // прочитал (эффект выполняется после отрисовки, поэтому форма успевает открыться),
  // и заодно заменяем запись истории, а не добавляем новую — «назад» работает как раньше.
  useEffect(() => {
    if (!composeIntent) return;
    void navigate(`${loc.pathname}${loc.search}`, { replace: true });
  }, [composeIntent, loc.pathname, loc.search, navigate]);

  return (
    <>
      <ErrorBoundary>
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
                  composeKey={loc.pathname === '/shopping' && composeIntent ? loc.key : null}
                />
              }
            />
            <Route
              path="/tasks"
              element={
                <TasksScreen
                  ready={ready}
                  composeKey={loc.pathname === '/tasks' && composeIntent ? loc.key : null}
                />
              }
            />
            <Route
              path="/deadlines"
              element={
                <DeadlinesScreen
                  ready={ready}
                  composeKey={loc.pathname === '/deadlines' && composeIntent ? loc.key : null}
                />
              }
            />
            <Route path="/settings" element={<SettingsScreen ready={ready} />} />
            <Route path="/more" element={<MoreScreen />} />
            <Route path="/help" element={<HelpScreen />} />
            <Route path="/about" element={<AboutScreen />} />
            <Route path="*" element={<HomeScreen ready={ready} />} />
          </Routes>
          {/* key по маршруту: sheet закрывается при навигации без setState в эффекте */}
          <QuickAddFab key={loc.pathname} />
          <TabBar />
        </div>
      </ErrorBoundary>
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
      {/* «Ещё» — хаб (Настройки · Справка · О приложении), решение владельца 07.10.2026. */}
      <NavLink to="/more" className="tab" aria-label="Ещё" title="Ещё">
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
  // «Ещё», справка и «О приложении» — не про добавление записей: кнопки «+» там нет.
  const quietRoute = ['/settings', '/more', '/help', '/about'].includes(loc.pathname);

  if (quietRoute) return null;

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
          <button type="button" className="btn btn--block" onClick={() => go('/tasks')}>
            <Icon name="check" size={20} /> Добавить дело
          </button>
          <button type="button" className="btn btn--block" onClick={() => go('/deadlines')}>
            <Icon name="calendar" size={20} /> Добавить срок
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
  '/more': 'Ещё',
  '/help': 'Справка',
  '/about': 'О приложении',
};

/**
 * Одна верхняя строка: название раздела слева, статус синхронизации справа.
 * Приёмка 0.1.5: раньше статус занимал первую строку один, а название приложения
 * начиналось ниже — место съедалось зря.
 */
/** Короткая справка раздела (просьба владельца 2026-10-02): пара слов, зачем блок. */
/**
 * Пояснения «О разделе» — сюда переносим длинные абзацы с экранов (07.10.2026):
 * на самих экранах остаются короткие подсказки, подробности — за значком «i».
 */
const HELP_TEXTS: Record<string, string[]> = {
  '/': [
    'Главный экран показывает только то, что требует внимания: просроченные сроки и дела, дела на сегодня и предупреждение, если данные пока живут только на этом телефоне. Ниже — ближайшие сроки, ближайшие дела, покупки и свёрнутая «Семейная лента»: кто что добавил, купил или изменил.',
    '«Сроки» — документы, техосмотр, страховки, дни рождения: у каждой записи есть дата, приложение напоминает заранее, а цвет рамки показывает срочность. Созданный срок можно добавить событием в календарь телефона галочкой в форме.',
    '«Дела» — общий список поручений: что сделать, кто исполнит, необязательный срок и отметка выполнения. Уведомление о деле получает его исполнитель; без исполнителя уведомлений нет.',
    'Покупки — общий список: добавили на своём телефоне — появилось у всех, отметили купленным — пропало у всех. Всё работает и без интернета, а сеть появится — изменения уедут сами.',
    'Строка внизу экрана показывает состояние синхронизации. Если всё в порядке, там написано «Сохранено»; если что-то не отправлено — сколько записей ждёт и почему.',
  ],
  '/shopping': [
    'Общий список покупок семьи: добавили на своём телефоне — появилось у всех, отметили купленным — пропало у всех. Работает без интернета: список дождётся сети и синхронизируется сам.',
    'Над списком — «Группировать:»: «По сроку» делит покупки на «Сейчас», «Скоро» и «Когда-нибудь», «По категориям» собирает вместе молочку, овощи и прочее, как заведено в семье.',
    'Удалили позицию по ошибке — внизу появится строка «Удалено: …» с кнопкой «Вернуть». Массовая уборка — «···» у заголовка «Куплено»: там «Очистить купленное», оно спросит подтверждение.',
  ],
  '/tasks': [
    'Общие дела семьи: что сделать, кто исполнит, необязательный срок и отметка выполнения. Можно исправить, удалить или вернуть в работу. Работает офлайн и синхронизируется.',
    'Уведомление о деле получает его исполнитель; без исполнителя уведомлений нет. В день срока приходит ещё одно напоминание.',
    'Кто последним менял дело, видно в форме правки — в самом списке эта подпись не показывается.',
  ],
  '/deadlines': [
    'Сроки: документы, техосмотр, страховки, дни рождения — всё, у чего есть дата. Приложение напомнит заранее, а цвет рамки показывает срочность; правила цвета («красный за N дней», «жёлтый за N дней») настраиваются в форме срока.',
    'Google-календарь не принимает напоминания дальше 4 недель (28 дней): если у срока стоит ступень «за 30» или «за 90 дней», звонка по ней не будет. Поэтому в форме рядом включается рабочая ступень «за 4 недели» — она сработает и на телефоне, и в Google.',
    'Удаление срока спрашивает подтверждение — сроки заведены один раз и надолго.',
  ],
  '/settings': [
    'Профиль, хранилище семьи, уведомления, оформление и данные — каждая группа открывается нажатием. Подробности про синхронизацию и диагностику — в группе «Для разработчика».',
  ],
  '/more': [
    'Сюда заходят редко: настройки, справка и сведения о приложении. Всё, что нужно каждый день, — на четырёх вкладках внизу.',
  ],
  '/help': [
    'Короткие пояснения по разделам: покупки, дела, сроки, календарь телефона и синхронизация. Те же тексты открываются значком «i» в верхней панели раздела.',
  ],
  '/about': [
    'Версия приложения, схема данных и «Для разработчика»: ссылка на код, хранилище семьи и диагностика.',
  ],
};

function TopBar() {
  const loc = useLocation();
  const title = ROUTE_TITLES[loc.pathname] ?? 'Family Hub';
  const help = HELP_TEXTS[loc.pathname] ?? [];
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <>
      <div className="topbar">
        <div className="topbar-title truncate">{title}</div>
        {help && (
          <button
            type="button"
            className="topbar-help"
            aria-label={`О разделе «${title}»`}
            onClick={() => setHelpOpen(true)}
          >
            <Icon name="info" size={17} />
          </button>
        )}
        <StatusPill />
      </div>
      <Sheet open={helpOpen} title={`О разделе «${title}»`} onClose={() => setHelpOpen(false)}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          {help.map((paragraph) => (
            <p key={paragraph.slice(0, 24)} className="small" style={{ margin: 0 }}>
              {paragraph}
            </p>
          ))}
        </div>
      </Sheet>
    </>
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

  const label = phaseLabel(s.phase, s.pendingCount);

  const explanation =
    s.phase === 'not-configured'
      ? 'Данные хранятся только на этом телефоне. Нажмите, чтобы подключить семейное хранилище.'
      : s.phase === 'offline'
        ? s.pendingCount > 0
          ? `Нет подключения. Изменений ждут отправки: ${s.pendingCount}. Они уйдут сами, когда появится интернет.`
          : 'Нет подключения. Приложение работает без интернета, изменения уедут сами.'
        : s.phase === 'error'
          ? 'Последняя отправка не удалась. Нажмите, чтобы открыть подробности.'
          : 'Нажмите, чтобы отправить изменения сейчас.';

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
