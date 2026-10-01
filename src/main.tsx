import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { startApp, resetLocalAndReload } from './app/startApp';
import './design/tokens.css';
import './design/base.css';
import './design/components.css';

/** Экран, который показывается, если приложение не смогло стартовать. */
function FatalScreen({ error, onReset }: { error: string; onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const lower = error.toLowerCase();
  // Честная подсказка о самой частой внешней причине: браузер запретил локальное
  // хранилище (приватный режим, «блокировать файлы cookie», очистка хранилища).
  const storageBlocked =
    lower.includes('indexeddb') || lower.includes('storage') || lower.includes('idb') || lower.includes('openDatabase');

  return (
    <div className="app-shell">
      <div className="screen">
        <div className="banner banner--err">
          <div className="grow">
            <div className="strong">Не удалось запустить приложение</div>
            <div className="small mono">{error}</div>
          </div>
        </div>

        {storageBlocked ? (
          <p className="small">
            Похоже, браузер запретил этому сайту локальное хранилище. Проверьте: не открыт ли
            приватный режим и не включена ли настройка «блокировать файлы cookie и данные сайтов».
            Family Hub хранит данные только на этом устройстве и без хранилища запуститься не может.
          </p>
        ) : null}

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
          {confirming ? (
            <>
              <button type="button" className="btn btn--danger" onClick={onReset}>
                Да, сбросить и открыть
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Отмена
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirming(true)}>
              Сбросить локальные данные…
            </button>
          )}
        </div>

        {confirming ? (
          <p className="small">
            Будут удалены данные этого устройства (покупки, дела, сроки, профиль) и заново создан
            идентификатор устройства. Данные, уже отправленные в семейный репозиторий, останутся там
            и вернутся при следующей синхронизации. Действие нужно, только если приложение не
            открывается вообще.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Root() {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Порядок инициализации определён в src/app/startApp.ts и покрыт тестом
        // tests/boot.test.ts. Не переносить шаги в компонент: сессия обязана быть
        // загружена до любой записи в данные (дефект первого запуска 2026-10-01).
        await startApp();
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setFatal(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (fatal) {
    return (
      <FatalScreen
        error={fatal}
        onReset={() => {
          void resetLocalAndReload().catch(() => window.location.reload());
        }}
      />
    );
  }

  return <App ready={ready} />;
}

const container = document.getElementById('root');
if (!container) throw new Error('Не найден контейнер #root');

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
