/**
 * «О приложении» (07.10.2026): короткая справка о самом приложении.
 * Технические подробности (хранилище, диагностика, журнал) — на отдельной
 * странице «Для разработчика» (просьба владельца 07.10.2026).
 */
import { Link } from 'react-router-dom';
import { isIos, isStandalone } from '../../notifications/channels';
import { SCHEMA_VERSION } from '../../domain/types';
import { Icon } from '../../design/ui';

export default function AboutScreen() {
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

      <div className="card stack" style={{ gap: 'var(--sp-2)' }}>
        <div className="strong small">Нужны подробности?</div>
        <div className="small muted">
          Как устроены покупки, дела, сроки и календарь — в «Справке». Техническое состояние
          хранилища, диагностика и журнал — на странице «Для разработчика».
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Link className="btn btn--sm" to="/help">
            Справка
          </Link>
          <Link className="btn btn--sm" to="/dev">
            Для разработчика
          </Link>
        </div>
      </div>
    </div>
  );
}
