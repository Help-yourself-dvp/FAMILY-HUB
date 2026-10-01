/** Настройки · ThemeSection */
import { useEffect, useState } from 'react';
import { Icon } from '../../design/ui';
import { kvGet, KV_KEYS } from '../../data/db';
import { initTheme, setTheme, THEME_LABEL, THEME_MODES, type ThemeMode } from '../../app/theme';

export default function ThemeSection() {
  const [mode, setMode] = useState<ThemeMode>('system');
  useEffect(() => {
    void kvGet<ThemeMode>(KV_KEYS.theme).then((m) => setMode(m ?? 'system'));
  }, []);
  return (
    <section className="stack">
      <details className="acc">
        <summary className="acc-summary">
          <span className="grow">Оформление</span>
          <Icon name="chevron" size={18} className="chev" />
        </summary>
        <div className="acc-body stack">
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
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void initTheme()}
            >
              Применить заново
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}

/* ------------------------------ Уведомления ------------------------------ */
