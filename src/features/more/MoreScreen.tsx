/**
 * Хаб «Ещё» (07.10.2026): сюда заходят редко — за настройками, справкой или чтобы
 * посмотреть версию. Поэтому это не сразу настройки, а три понятных входа.
 */
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../design/ui';
import { isIos, isStandalone } from '../../notifications/channels';

const ROWS: Array<{ to: string; icon: IconName; title: string; hint: string }> = [
  {
    to: '/settings',
    icon: 'gear',
    title: 'Настройки',
    hint: 'Профиль, хранилище семьи, уведомления, оформление, данные',
  },
  {
    to: '/help',
    icon: 'info',
    title: 'Справка',
    hint: 'Как всё устроено: покупки, дела, сроки, календарь телефона',
  },
  {
    to: '/about',
    icon: 'shield',
    title: 'О приложении',
    hint: 'Версия, что это за приложение и где что хранится',
  },
  {
    // Просьба владельца 07.10.2026: не прятать в «О приложении» — отдельная страница,
    // как «Справка» и «Настройки».
    to: '/dev',
    icon: 'cloud',
    title: 'Для разработчика',
    hint: 'Хранилище семьи, диагностика, журнал синхронизации',
  },
];

export default function MoreScreen() {
  return (
    <div className="screen">
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        {ROWS.map((row) => (
          <Link
            key={row.to}
            to={row.to}
            className="card row"
            style={{ gap: 'var(--sp-3)', textDecoration: 'none', color: 'inherit' }}
          >
            <span style={{ color: 'var(--accent)', flex: '0 0 auto' }}>
              <Icon name={row.icon} size={22} />
            </span>
            <span className="grow">
              <span className="strong small" style={{ display: 'block' }}>
                {row.title}
              </span>
              <span className="tiny muted">{row.hint}</span>
            </span>
            <Icon name="chevron" size={16} className="chev" />
          </Link>
        ))}
      </div>

      <div className="tiny muted" style={{ textAlign: 'center' }}>
        Family Hub {__APP_VERSION__}
        {isIos() ? ' · iOS' : ''}
        {isStandalone() ? ' · установлено как приложение' : ''}
      </div>
    </div>
  );
}
