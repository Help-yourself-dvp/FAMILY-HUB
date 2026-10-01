/**
 * Настройки · Уведомления.
 *
 * Переделано после приёмки 0.1.2: владелец увидел «наваленные друг на друга» строки,
 * а переключатель push-канала визуально лежал поверх кнопки. Причины были две:
 * плотная упаковка всех каналов в одну карточку и fixed-индикатор синхронизации,
 * наезжавший сверху (индикатор с тех пор живёт в потоке, см. src/app/App.tsx).
 *
 * Теперь: каждый канал — отдельная карточка с воздухом, у переключателя есть
 * видимая подпись состояния («включено» / «выключено»), причина недоступности
 * канала объяснена словами, а не значком.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  notificationChannels,
  type NotificationChannel,
  type SupportReport,
} from '../../notifications/channels';
import { Icon, Switch } from '../../design/ui';
import { kvGet, kvSet } from '../../data/db';

export default function NotificationsSection() {
  const [support, setSupport] = useState<Record<string, SupportReport>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);
  const [shoppingPush, setShoppingPush] = useState(false);

  useEffect(() => {
    void kvGet<boolean>('notify.shoppingPush').then((v) => setShoppingPush(Boolean(v)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s: Record<string, SupportReport> = {};
      const e: Record<string, boolean> = {};
      for (const c of notificationChannels.all()) {
        s[c.id] = await c.isSupported();
        // Уровни 0 и 1 работают всегда и включены по умолчанию (§2.4).
        e[c.id] = c.level <= 1;
      }
      if (!cancelled) {
        setSupport(s);
        setEnabled(e);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
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
      <details className="acc">
        <summary className="acc-summary">
          <span className="grow">Уведомления</span>
          <Icon name="chevron" size={18} className="chev" />
        </summary>
        <div className="acc-body stack">
          <p className="small muted" style={{ margin: 0, lineHeight: 1.55 }}>
            Три независимых канала. Каждый включается своим переключателем; общий смысл — чем выше
            уровень, тем громче напоминание и тем больше условий для его работы.
          </p>

          <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
              <span className="badge" style={{ flex: '0 0 auto' }}>
                push
              </span>
              <div className="strong grow truncate" style={{ fontSize: 'var(--fs-md)' }}>
                Push об изменениях корзины
              </div>
            </div>
            <p className="small" style={{ margin: 0, lineHeight: 1.55, color: 'var(--text-2)' }}>
              Решение семьи от 01.10.2026: выключено по умолчанию и считается мерой «на всякий
              случай». Даже во включённом состоянии изменения приходят дайджестом не чаще раза в 30
              минут, а не на каждую позицию. Напоминания о сроках и ошибки, требующие действия,
              живут отдельными уровнями ниже.
            </p>
            <div className="row--between row" style={{ gap: 'var(--sp-3)', paddingTop: 2 }}>
              <span className="small" style={{ color: 'var(--text-2)' }}>
                {shoppingPush ? 'включено' : 'выключено'}
              </span>
              <Switch
                checked={shoppingPush}
                label="Push об изменениях корзины"
                onChange={(v) => {
                  setShoppingPush(v);
                  void kvSet('notify.shoppingPush', v);
                }}
              />
            </div>
          </div>

          {!ready ? (
            <div className="card">
              <div className="tiny muted">Проверяем, что умеет это устройство…</div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              {notificationChannels.all().map((c) => (
                <ChannelCard
                  key={c.id}
                  channel={c}
                  support={support[c.id]}
                  enabled={Boolean(enabled[c.id])}
                  onToggle={(v) => void toggle(c.id, v)}
                />
              ))}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function ChannelCard({
  channel: c,
  support,
  enabled,
  onToggle,
}: {
  channel: NotificationChannel;
  support: SupportReport | undefined;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  const unsupported = Boolean(support && !support.supported);
  const disabled = unsupported || c.level === 2; // уровень 2 ждёт проверки на устройствах (§2.4, ЭТАП 3)

  return (
    <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
        <span className="badge" style={{ flex: '0 0 auto' }}>
          уровень {c.level}
        </span>
        <div className="strong grow truncate" style={{ fontSize: 'var(--fs-md)' }}>
          {c.label}
        </div>
      </div>

      <p className="small" style={{ margin: 0, lineHeight: 1.55, color: 'var(--text-2)' }}>
        {c.description}
      </p>

      <div className="stack" style={{ gap: 6 }}>
        {c.worksScreenOff && (
          <div className="tiny" style={{ color: 'var(--ok)' }}>
            Работает при выключенном экране и закрытом приложении.
          </div>
        )}
        {c.needsExternalInfra && (
          <div className="tiny" style={{ color: 'var(--warn)' }}>
            Требует бесплатных минут GitHub Actions для отправки.
          </div>
        )}
        {unsupported && support?.reason && (
          <div className="tiny" style={{ color: 'var(--warn)' }}>
            На этом устройстве недоступно: {support.reason}
          </div>
        )}
        {c.level === 2 && !unsupported && (
          <div className="tiny" style={{ color: 'var(--warn)' }}>
            Включим после живой проверки на ваших телефонах (ЭТАП 3): пока мы не увидели системное
            уведомление на заблокированном экране, обещать его работу нельзя.
          </div>
        )}
      </div>

      <div className="row--between row" style={{ gap: 'var(--sp-3)', paddingTop: 2 }}>
        <span className="small" style={{ color: 'var(--text-2)' }}>
          {disabled ? 'выключено' : enabled ? 'включено' : 'выключено'}
        </span>
        <Switch
          checked={enabled && !disabled}
          label={c.label}
          disabled={disabled}
          onChange={onToggle}
        />
      </div>
    </div>
  );
}
