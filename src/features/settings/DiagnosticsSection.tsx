/** Настройки · DiagnosticsSection */
import { useEffect, useState } from 'react';
import { useSyncState } from '../../app/hooks';
import { notificationChannels, isStandalone, isIos } from '../../notifications/channels';
import { readDisplayMode } from './helpers';

export default function DiagnosticsSection() {
  const sync = useSyncState();
  const [sw, setSw] = useState<string>('…');
  const [swScope, setSwScope] = useState<string>('—');
  const [diag, setDiag] = useState<
    Array<{
      channelId: string;
      enabled: boolean;
      supported: boolean;
      details: Record<string, string | number | boolean | null>;
    }>
  >([]);
  const [persisted, setPersisted] = useState<string>('…');

  useEffect(() => {
    void (async () => {
      if (!('serviceWorker' in navigator)) {
        setSw('не поддерживается');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      setSw(
        reg
          ? `зарегистрирован (${reg.active?.state ?? reg.installing?.state ?? '—'})`
          : 'не зарегистрирован',
      );
      setSwScope(reg?.scope ?? '—');
      const d = [];
      for (const c of notificationChannels.all()) d.push(await c.diagnose());
      setDiag(d);
      try {
        setPersisted(
          navigator.storage?.persisted ? String(await navigator.storage.persisted()) : 'n/a',
        );
      } catch {
        setPersisted('n/a');
      }
    })();
  }, []);

  const row = (k: string, v: string | number | boolean | null) => (
    <div className="row row--between" key={k}>
      <span className="tiny muted">{k}</span>
      <span className="tiny mono">{v === null ? '—' : String(v)}</span>
    </div>
  );

  return (
    <section className="stack">
      <h2 className="section-title">Диагностика</h2>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="strong small">Приложение</div>
        {row('standalone (PWA установлено)', isStandalone())}
        {row('iOS', isIos())}
        {row('display-mode', typeof window !== 'undefined' ? readDisplayMode() : '—')}
        {row('в сети', sync.online)}
        {row('Service Worker', sw)}
        {row('scope SW', swScope)}
        {row('Notification API', typeof window !== 'undefined' && 'Notification' in window)}
        {row(
          'Notification.permission',
          typeof window !== 'undefined' && 'Notification' in window
            ? Notification.permission
            : 'unsupported',
        )}
        {row('Push API', typeof window !== 'undefined' && 'PushManager' in window)}
        {row('persisted storage', persisted)}
        <hr className="divider" />
        <div className="strong small">Синхронизация</div>
        {row('подключено', sync.configured)}
        {row('фаза', sync.phase)}
        {row('остаток лимита GitHub', sync.rateRemaining)}
        <hr className="divider" />
        <div className="strong small">Каналы уведомлений</div>
        {diag.map((d) => (
          <div key={d.channelId} className="stack" style={{ gap: 2 }}>
            {row(`${d.channelId}: поддерживается`, d.supported)}
            {Object.entries(d.details).map(([k, v]) => row(`  ${k}`, v))}
          </div>
        ))}
      </div>
    </section>
  );
}
