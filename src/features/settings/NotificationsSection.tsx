/** Настройки · NotificationsSection */
import { useCallback, useEffect, useState } from 'react';
import { notificationChannels, type SupportReport } from '../../notifications/channels';
import { Switch } from '../../design/ui';


export default function NotificationsSection() {
  const [support, setSupport] = useState<Record<string, SupportReport>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void (async () => {
      const s: Record<string, SupportReport> = {};
      const e: Record<string, boolean> = {};
      for (const c of notificationChannels.all()) {
        s[c.id] = await c.isSupported();
        e[c.id] = c.level === 0;
      }
      setSupport(s);
      setEnabled(e);
    })();
  }, []);

  const toggle = useCallback(async (id: string, on: boolean) => {
    const ch = notificationChannels.byId(id as 'local-foreground');
    if (!ch) return;
    if (on && ch.level === 0) {
      const res = await ch.enable();
      setEnabled((p) => ({ ...p, [id]: res.enabled }));
      return;
    }
    setEnabled((p) => ({ ...p, [id]: on }));
  }, []);

  return (
    <section className="stack">
      <h2 className="section-title">Уведомления</h2>
      <div className="card stack">
        <div className="tiny muted">
          Три независимых канала, каждый включается отдельно (§2.4). Уровни 0 и 1 не требуют
          интернета и внешних сервисов. Уровень 2 включается после проверки на реальных
          устройствах (ЭТАП 3).
        </div>
        {notificationChannels.all().map((c) => {
          const sup = support[c.id];
          return (
            <div key={c.id} className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="strong small">{c.label}</span>
                  <span className="badge">уровень {c.level}</span>
                  {c.worksScreenOff && <span className="badge badge--ok">экран выключен</span>}
                  {c.needsExternalInfra && <span className="badge badge--warn">нужен GitHub Actions</span>}
                </div>
                <div className="tiny muted" style={{ marginTop: 4 }}>{c.description}</div>
                {sup && !sup.supported && sup.reason && (
                  <div className="tiny" style={{ color: 'var(--warn)', marginTop: 4 }}>{sup.reason}</div>
                )}
              </div>
              <Switch
                checked={Boolean(enabled[c.id])}
                label={c.label}
                disabled={Boolean(sup && !sup.supported)}
                onChange={(v) => void toggle(c.id, v)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------- Данные --------------------------------- */
