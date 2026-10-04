/** Настройки · DiagnosticsSection */
import { useEffect, useState } from 'react';
import { Icon, Sheet } from '../../design/ui';
import { copyText } from '../../shared/clipboard';
import { useSyncState } from '../../app/hooks';
import { notificationChannels, isStandalone, isIos } from '../../notifications/channels';
import { readDisplayMode } from './helpers';
import { log } from '../../shared/log';
import { SCHEMA_VERSION } from '../../domain/types';
import { notificationDeliverySnapshot } from '../../notifications/deliveryState';

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
  const [delivery, setDelivery] = useState<Awaited<
    ReturnType<typeof notificationDeliverySnapshot>
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    void notificationDeliverySnapshot()
      .then((snapshot) => {
        if (!cancelled) setDelivery(snapshot);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
  // Текст отчёта для ручного копирования (когда буфер недоступен).
  const [manualReport, setManualReport] = useState<string | null>(null);

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
    // Читаем подтверждения заново при копировании, а не старый снимок монтирования.
    const notifications = await notificationDeliverySnapshot().catch(() => null);
    setDelivery(notifications);
    const payload = {
      notifications,
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
    const outcome = await copyText(text);
    if (outcome === 'manual') {
      // Копирование недоступно (бывает в Safari на iPhone): показываем текст, чтобы его
      // можно было выделить и скопировать вручную. Раньше здесь была только надпись
      // «не удалось» — тупик, снимок экрана и потерянные подробности.
      setManualReport(text);
      setCopied('');
      return;
    }
    setCopied(
      `Скопировано — вставьте в чат разработчику (${outcome === 'exec' ? 'запасной путь' : 'буфер'}).`,
    );
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
          <span className="acc-hint">Отчёт разработчику без семейных данных</span>
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
            {manualReport && (
              <div className="tiny" style={{ color: 'var(--warn)' }}>
                Скопировать автоматически не получилось — отчёт открыт ниже, скопируйте его вручную.
              </div>
            )}
            <hr className="divider" />
            <div className="strong small">Факт уведомлений на этом устройстве</div>
            <div className="tiny muted">
              Счётчики с версии 0.3.7. Web Push — сообщение действительно получено обработчиком на
              устройстве. «Показ принят» означает успех системного API, не гарантирует видимость на
              заблокированном экране. Локальное уведомление — не доказательство push. При
              копировании отчёта эти данные перечитываются.
            </div>
            {row(
              'Активный SW: протокол уведомлений',
              delivery?.workerNotificationsRevision ?? 'не определён — проверьте обновление',
            )}
            {row('Web Push: получено', delivery?.webPush.receivedCount ?? '—')}
            {row('Web Push: показ принят', delivery?.webPush.shownCount ?? '—')}
            {row('Web Push: последнее получение', delivery?.webPush.lastReceivedAt ?? '—')}
            {row('При открытом приложении: показ принят', delivery?.foreground.shownCount ?? '—')}
            {row('Фон Android: показ принят', delivery?.background.shownCount ?? '—')}
            {row(
              'Календарь: событий в последнем файле',
              delivery?.calendarExport.eventCount ?? '—',
            )}
            {row('Календарь: формат файла', delivery?.calendarExport.formatRevision ?? '—')}
            {row('Календарь: последний экспорт', delivery?.calendarExport.exportedAt ?? '—')}
            <div className="tiny muted">Факт импорта в календарь браузеру недоступен.</div>
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

      {manualReport && (
        <Sheet open title="Отчёт для разработчика" onClose={() => setManualReport(null)}>
          <div className="stack">
            <div className="small">
              Нажмите на текст, затем «Выделить всё» → «Скопировать» и вставьте в чат разработчику.
              В отчёте нет содержимого покупок, токенов и подписок.
            </div>
            <textarea
              className="input"
              style={{ minHeight: 260, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              readOnly
              value={manualReport}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Отчёт для разработчика"
            />
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  void copyText(manualReport).then((outcome) => {
                    setCopied(
                      outcome === 'manual' ? '' : 'Скопировано — вставьте в чат разработчику.',
                    );
                  });
                }}
              >
                Попробовать скопировать
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setManualReport(null)}
              >
                Понятно
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </section>
  );
}
