import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { bootstrap, registerServiceWorker } from './app/bootstrap';
import { db } from './data/db';
import { seedDemoData } from './features/home/demoData';
import './design/tokens.css';
import './design/base.css';
import './design/components.css';

function Root() {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Демо-данные — только если локальная база пуста. Они ОБЯЗАНЫ быть очевидно
        // демонстрационными, а не притворяться данными бэкенда (ТЗ §35 E).
        const count = await db.shopping.count();
        if (count === 0) await seedDemoData();
        await bootstrap();
        await registerServiceWorker();
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (fatal) {
    return (
      <div className="app-shell">
        <div className="screen">
          <div className="banner banner--err">
            <div className="grow">
              <div className="strong">Не удалось запустить приложение</div>
              <div className="small mono">{fatal}</div>
            </div>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      </div>
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
