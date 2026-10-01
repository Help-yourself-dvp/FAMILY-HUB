/**
 * Последний рубеж вместо белого экрана (приёмка 0.1.6).
 *
 * Любое необработанное исключение в рендере раньше убивало всё дерево React:
 * владелец видел белый экран и лечил его выгрузкой приложения. Теперь падение
 * локально: карточка с кнопками «повторить» и «перезагрузить», данные не трогаем.
 */
import { Component, type ReactNode } from 'react';
import { Icon } from '../design/ui';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;
    return (
      <div className="screen">
        <div className="banner banner--err" role="alert">
          <Icon name="alert" size={18} />
          <div className="grow">
            <div className="strong">Экран остановился из-за внутренней ошибки</div>
            <div className="small">
              Данные не потеряны: они в локальной базе и в семейном хранилище. Попробуйте продолжить
              или перезагрузите приложение.
            </div>
            <div className="tiny mono" style={{ marginTop: 6 }}>
              {err.name}: {err.message}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button
            type="button"
            className="btn btn--primary grow"
            onClick={() => this.setState({ error: null })}
          >
            Попробовать снова
          </button>
          <button type="button" className="btn grow" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
        <div className="tiny muted">
          Если ошибка повторяется: Настройки → Диагностика → «Скопировать отчёт» и пришлите
          разработчику (диагностика откроется после «Попробовать снова»).
        </div>
      </div>
    );
  }
}
