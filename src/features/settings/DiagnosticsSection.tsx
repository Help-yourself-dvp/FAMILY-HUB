/** Настройки · DiagnosticsSection */
import { useEffect, useState } from 'react';
import { Icon } from '../../design/ui';
import { useSyncState } from '../../app/hooks';
import { notificationChannels, isStandalone, isIos } from '../../notifications/channels';
import { readDisplayMode } from './helpers';
import { log } from '../../shared/log';
import { SCHEMA_VERSION } from '../../domain/types';

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

  const [copied, setCopied] = useState<string>('');

  /**
   * Отчёт для разработчика (приёмка 0.1.5: владелец устал пересказывать симптомы).
   * Санитизация жёсткая (§6.19): ни названий покупок, ни токенов, ни push-эндпоинтов —
   * только структура, времена, коды ошибок и счета. Семья не должна светиться в чате.
   */
  const buildReport = async (): Promise<string> => {
    let swState: string | null;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      swState = reg ? (reg.active?.state ?? reg.installing?.state ?? 'no-active') : null;
    } catch {
      swState = 'error';
    }
    const safeDetails = (d: Record<string, string | number | boolean | null>) =>
      Object.fromEntries(
        Object.entries(d).filter(([, v]) => {
          if (typeof v === 'string') return v.length <= 24 && !v.includes('http');
          return typeof v === 'number' || typeof v === 'boolean';
        }),
      );
    const payload = {
      app: __APP_VERSION__,
      schema: SCHEMA_VERSION,
      at: new Date().toISOString(),
      ua: navigator.userAgent,
      standalone: isStandalone(),
      ios: isIos(),
      displayMode: readDisplayMode(),
      sw: swState,
      storagePersisted: persisted,
      sync: {
        phase: sync.phase,
        online: sync.online,
        configured: sync.configured,
        pending: sync.pendingCount,
        lastDurationMs: sync.lastDurationMs,
        lastSuccessAt: sync.lastSuccessAt,
        lastError: sync.lastError,
        rateRemaining: sync.rateRemaining,
      },
      channels: diag.map((d) => ({
        id: d.channelId,
        supported: d.supported,
        enabled: d.enabled,
        details: safeDetails(d.details),
      })),
      journal: log.entries().slice(-100),
    };
    return JSON.stringify(payload, null, 1);
  };

  const copyReport = async () => {
    const text = await buildReport();
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Скопировано — вставьте в чат разработчику.');
    } catch {
      // На некоторых Android clipboard доступен только через жест пользователя
      // в фокусе: даём второй шанс через скрытое поле.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      setCopied(
        ok
          ? 'Скопировано — вставьте в чат разработчику.'
          : 'Не удалось скопировать: снимите экран и пришлите фото.',
      );
    }
    setTimeout(() => setCopied(''), 6000);
  };

  const row = (k: string, v: string | number | boolean | null) => (
    <div className="row row--between" key={k}>
      <span className="tiny muted">{k}</span>
      <span className="tiny mono">{v === null ? '—' : String(v)}</span>
    </div>
  );

  return (
    <section className="stack">
      <details className="acc">
        <summary className="acc-summary">
          <span className="grow">Диагностика</span>
          <Icon name="chevron" size={18} className="chev" />
        </summary>
        <div className="acc-body stack">
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
            <button type="button" className="btn btn--block" onClick={() => void copyReport()}>
              Скопировать отчёт для разработчика
            </button>
            <div className="tiny muted">
              В отчёте нет содержимого покупок, токенов и подписок — только версия, времена, коды
              ошибок и журнал структурных событий. Вставьте его в чат: этого достаточно, чтобы
              искать причину без пересказа симптомов.
            </div>
            {copied && (
              <div className="tiny" style={{ color: 'var(--ok)' }}>
                {copied}
              </div>
            )}
            <hr className="divider" />
            <div className="strong small">Каналы уведомлений</div>
            {diag.map((d) => (
              <div key={d.channelId} className="stack" style={{ gap: 2 }}>
                {row(`${d.channelId}: поддерживается`, d.supported)}
                {Object.entries(d.details).map(([k, v]) => row(`  ${k}`, v))}
              </div>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}
