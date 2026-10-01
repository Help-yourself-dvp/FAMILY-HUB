/** Настройки · ThemeSection */
import { useEffect, useState } from 'react';
import { kvGet, KV_KEYS } from '../../data/db';
import { initTheme, setTheme, THEME_LABEL, THEME_MODES, type ThemeMode } from '../../app/theme';


export default function ThemeSection() {
  const [mode, setMode] = useState<ThemeMode>('system');
  useEffect(() => {
    void kvGet<ThemeMode>(KV_KEYS.theme).then((m) => setMode(m ?? 'system'));
  }, []);
  return (
    <section className="stack">
      <h2 className="section-title">Оформление</h2>
      <div className="card stack">
        <div className="chips" role="group" aria-label="Тема оформления">
          {THEME_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className="chip"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                void setTheme(m);
              }}
            >
              {THEME_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="tiny muted">
          Тема хранится только на этом устройстве и не попадает в общий семейный файл (§2.3).
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void initTheme()}>
          Применить заново
        </button>
      </div>
    </section>
  );
}

/* ------------------------------ Уведомления ------------------------------ */
