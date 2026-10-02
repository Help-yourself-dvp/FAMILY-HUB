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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  notificationChannels,
  type ChannelId,
  type NotificationChannel,
  type SupportReport,
} from '../../notifications/channels';
import { Banner, Icon, Switch } from '../../design/ui';
import { kvGet, kvSet, KV_KEYS } from '../../data/db';
import { downloadCalendarTestIcs } from '../../notifications/ics';
import { formatRu } from '../../domain/dateOnly';

export default function NotificationsSection() {
  const [support, setSupport] = useState<Record<string, SupportReport>>({});
  const [enabled, setEnabled] = useState<Partial<Record<ChannelId, boolean>>>({});
  // Поздний ответ диагностики не должен откатывать явное действие пользователя.
  const manuallyChanged = useRef(new Set<ChannelId>());
  const [ready, setReady] = useState(false);
  const [shoppingPush, setShoppingPush] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void kvGet<boolean>('notify.shoppingPush').then((v) => setShoppingPush(Boolean(v)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cachedPush, icsDownloaded] = await Promise.all([
        kvGet<boolean>(KV_KEYS.notifyPushEnabled),
        kvGet<boolean>(KV_KEYS.notifyIcsDownloaded),
      ]);
      const s: Record<string, SupportReport> = {};
      for (const c of notificationChannels.all()) s[c.id] = await c.isSupported();
      if (cancelled) return;
      // Сначала кэш: уже включённый push не мигает «выключено» на каждом входе.
      // Без кэша показываем «проверяем…», а не выдуманное состояние подписки.
      setSupport(s);
      setEnabled({
        'local-foreground': true,
        'ics-calendar': icsDownloaded === true,
        'web-push': typeof cachedPush === 'boolean' ? cachedPush : undefined,
      });
      setReady(true);

      try {
        const push = notificationChannels.byId('web-push');
        if (!push) return;
        const diagnostic = await push.diagnose();
        if (cancelled || manuallyChanged.current.has('web-push')) return;
        const subscribed = diagnostic.details.subscribed;
        if (typeof subscribed !== 'boolean') throw new Error('Состояние подписки неизвестно');
        setEnabled((p) => ({ ...p, 'web-push': subscribed }));
        await kvSet(KV_KEYS.notifyPushEnabled, subscribed);
      } catch {
        if (cancelled || manuallyChanged.current.has('web-push')) return;
        setEnabled((p) => ({ ...p, 'web-push': p['web-push'] ?? false }));
        setNotice({
          tone: 'warn',
          text: 'Не удалось проверить push. Показано сохранённое состояние; повторите проверку, открыв настройки снова.',
        });
      }
    })().catch(() => {
      if (!cancelled) {
        setNotice({ tone: 'err', text: 'Не удалось прочитать настройки уведомлений.' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async (id: ChannelId, on: boolean) => {
    const ch = notificationChannels.byId(id);
    if (!ch) return;
    // Включение идёт через сеть (разрешение → ключ → подписка → загрузка):
    // показываем «включаем…», чтобы не выглядело зависанием (приёмка 0.3.3).
    manuallyChanged.current.add(id);
    setBusyId(id);
    try {
      if (on) {
        const res = await ch.enable();
        setEnabled((p) => ({ ...p, [id]: res.enabled }));
        if (id === 'web-push') await kvSet(KV_KEYS.notifyPushEnabled, res.enabled);
        setNotice(
          res.enabled
            ? { tone: 'ok', text: res.reason ?? 'Канал включён на этом устройстве.' }
            : { tone: 'warn', text: res.reason ?? 'Не удалось включить канал.' },
        );
      } else {
        await ch.disable();
        setEnabled((p) => ({ ...p, [id]: false }));
        if (id === 'web-push') await kvSet(KV_KEYS.notifyPushEnabled, false);
      }
    } catch (e) {
      setEnabled((p) => ({ ...p, [id]: false }));
      setNotice({ tone: 'err', text: describeEnableError(e) });
    } finally {
      setBusyId(null);
    }
  }, []);

  const testCalendar = () => {
    try {
      const date = downloadCalendarTestIcs();
      setNotice({
        tone: 'ok',
        text: `Скачан проверочный файл: одно вымышленное событие «Family Hub: проверка календаря» на ${formatRu(date)}, 09:00 (Москва). Он не включает резерв семейных сроков. Подтвердите импорт и откройте эту дату в календаре.`,
      });
    } catch {
      setNotice({ tone: 'err', text: 'Не удалось скачать проверочный календарь.' });
    }
  };

  return (
    <section className="stack">
      <details className="acc">
        <summary className="acc-summary">
          <span className="grow">Уведомления</span>
          <span className="acc-hint">Каналы: в приложении, календарь, push при закрытом</span>
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

          {notice && (
            <Banner tone={notice.tone === 'err' ? 'err' : notice.tone === 'ok' ? 'ok' : 'warn'}>
              <div className="grow small">{notice.text}</div>
              <button type="button" className="btn btn--sm" onClick={() => setNotice(null)}>
                Понятно
              </button>
            </Banner>
          )}

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
                  enabled={enabled[c.id]}
                  busy={busyId === c.id}
                  onToggle={(v) => void toggle(c.id, v)}
                  onCalendarTest={testCalendar}
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
  busy,
  onToggle,
  onCalendarTest,
}: {
  channel: NotificationChannel;
  support: SupportReport | undefined;
  enabled: boolean | undefined;
  busy: boolean;
  onToggle: (v: boolean) => void;
  onCalendarTest: () => void;
}) {
  const unsupported = Boolean(support && !support.supported);
  const checking = enabled === undefined;
  const disabled = unsupported || checking;

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
            {c.id === 'ics-calendar'
              ? 'После подтверждённого импорта календарь напомнит сам.'
              : 'Поддерживает доставку при закрытом приложении; её нужно проверить на устройстве.'}
          </div>
        )}
        {c.needsExternalInfra && (
          <div className="tiny" style={{ color: 'var(--warn)' }}>
            Отправитель — в публичном GitHub, без расхода платных минут.
          </div>
        )}
        {unsupported && support?.reason && (
          <div className="tiny" style={{ color: 'var(--warn)' }}>
            На этом устройстве недоступно: {support.reason}
          </div>
        )}
        {c.level === 2 && !unsupported && (
          <div className="tiny" style={{ color: 'var(--warn)' }}>
            Включённый переключатель означает подписку браузера, не проверенную доставку. На Android
            push использует сервис Google; фоновую проверку запускает Chrome по своему усмотрению.
            На iPhone нужны iOS 16.4+ и установка на экран Домой. В Диагностике отдельно считаются
            Web Push и уведомления при открытии приложения.
          </div>
        )}
      </div>

      {c.id === 'ics-calendar' && (
        <div className="stack">
          <p className="tiny muted" style={{ margin: 0 }}>
            Открытие файла в Android-календаре не подтверждает импорт. Google описывает импорт через
            веб-версию на компьютере: Настройки → Импорт и экспорт. Поддержка прямого импорта в
            Honor пока не подтверждена. После изменения сроков скачайте файл снова; события стоят на
            датах сроков, не на датах каждого будильника.
          </p>
          <button type="button" className="btn btn--sm" onClick={onCalendarTest}>
            Проверочный календарь: 1 событие
          </button>
          <a
            className="small"
            href="https://support.google.com/calendar/answer/37118?hl=ru&co=GENIE.Platform%3DDesktop"
            target="_blank"
            rel="noopener noreferrer"
          >
            Инструкция импорта Google
          </a>
        </div>
      )}

      <div className="row--between row" style={{ gap: 'var(--sp-3)', paddingTop: 2 }}>
        <span className="small" style={{ color: 'var(--text-2)' }}>
          {busy
            ? enabled
              ? 'выключаем…'
              : 'включаем…'
            : checking
              ? 'проверяем…'
              : enabled
                ? 'включено'
                : 'выключено'}
        </span>
        <Switch
          checked={enabled === true}
          label={c.label}
          disabled={disabled || busy}
          onChange={onToggle}
        />
      </div>
    </div>
  );
}

/** Человек вместо DOMException: почему push не включился на этом устройстве. */
function describeEnableError(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (/push|subscription|registr/iu.test(msg)) {
    return `Web Push недоступен на этом устройстве (${msg}). На Android для push нужны сервисы Google. Напоминания всё равно придут: фоновой проверкой (Android) и при открытии приложения.`;
  }
  return `Не удалось включить канал: ${msg}`;
}
