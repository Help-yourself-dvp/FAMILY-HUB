/**
 * Реестр каналов уведомлений (PROJECT.md §2.4).
 *
 * ЭТАП 1 — СКЕЛЕТ: интерфейсы, реестр, диагностика поддержки. Реальная доставка
 * появляется на ЭТАПЕ 3. Скелет нужен сейчас, чтобы архитектура ранних этапов
 * не мешала последующим (ТЗ §1: «ты знаешь конечное ТЗ заранее»).
 *
 * Три уровня, переключение одним тумблером в Настройках:
 *   0 local-foreground — работает всегда, ноль инфраструктуры
 *   1 ics-calendar     — работает всегда, ноль инфраструктуры, ЭКРАН ВЫКЛЮЧЕН ✓
 *   2 web-push         — требует GitHub Actions + VAPID, проверяется на устройствах
 */
import { kvGet, KV_KEYS } from '../data/db';
import { loadSession } from '../data/session';
import { auth } from '../data/remote/authStrategy';
import { GitHubClient } from '../data/remote/githubClient';

export type ChannelId = 'local-foreground' | 'ics-calendar' | 'web-push';

export interface SupportReport {
  supported: boolean;
  /** Почему не поддерживается — показываем пользователю человеческим языком. */
  reason?: string;
  /** Требуется ли установка PWA на Home Screen (обязательно для iOS Web Push, факт F7). */
  requiresInstall?: boolean;
  permission?: NotificationPermission | 'unsupported';
}

export interface EnableResult {
  enabled: boolean;
  reason?: string;
}

export interface FamilyEvent {
  id: string;
  title: string;
  body: string;
  /** Глубокая ссылка внутри приложения (hash-route). */
  route?: string;
  createdAt: string;
  /** Не отправлять на устройство-источник (§2.4, анти-спам). */
  originDeviceId?: string;
}

export interface DeliveryReport {
  channelId: ChannelId;
  attempted: number;
  delivered: number;
  failed: number;
  errors: string[];
}

export interface DiagnosticSnapshot {
  channelId: ChannelId;
  enabled: boolean;
  supported: boolean;
  details: Record<string, string | number | boolean | null>;
}

export interface NotificationChannel {
  readonly id: ChannelId;
  readonly label: string;
  readonly description: string;
  /** Честный флаг для UI: работает ли канал при выключенном экране. */
  readonly worksScreenOff: boolean;
  /** Нужна ли внешняя инфраструктура (GitHub Actions, VAPID). */
  readonly needsExternalInfra: boolean;
  readonly level: 0 | 1 | 2;
  isSupported(): Promise<SupportReport>;
  enable(): Promise<EnableResult>;
  disable(): Promise<void>;
  deliver(events: FamilyEvent[]): Promise<DeliveryReport>;
  diagnose(): Promise<DiagnosticSnapshot>;
}

/** PWA установлена (standalone)? Обязательно для iOS Web Push. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/u.test(ua) || (/Macintosh/u.test(ua) && navigator.maxTouchPoints > 1);
}

const emptyDelivery = (channelId: ChannelId): DeliveryReport => ({
  channelId,
  attempted: 0,
  delivered: 0,
  failed: 0,
  errors: [],
});

/** Уровень 0: локальные уведомления, пока приложение открыто или в фоне на экране. */
class LocalForegroundChannel implements NotificationChannel {
  readonly id = 'local-foreground' as const;
  readonly label = 'Уведомления в приложении';
  readonly description =
    'Лента на Главной и системные уведомления, пока приложение открыто. Работает всегда, не требует интернета и внешних сервисов.';
  readonly worksScreenOff = false;
  readonly needsExternalInfra = false;
  readonly level = 0 as const;

  isSupported(): Promise<SupportReport> {
    const hasNotification = typeof window !== 'undefined' && 'Notification' in window;
    return Promise.resolve({
      supported: hasNotification,
      reason: hasNotification ? undefined : 'Браузер не поддерживает Notification API',
      permission: hasNotification ? Notification.permission : 'unsupported',
    });
  }

  async enable(): Promise<EnableResult> {
    const support = await this.isSupported();
    if (!support.supported) return { enabled: false, reason: support.reason };
    if (Notification.permission === 'granted') return { enabled: true };
    if (Notification.permission === 'denied')
      return { enabled: false, reason: 'Уведомления запрещены в настройках браузера' };
    // Запрос ТОЛЬКО по явному действию пользователя (ТЗ §11): вызывается из кнопки в UI.
    const res = await Notification.requestPermission();
    return {
      enabled: res === 'granted',
      reason: res === 'granted' ? undefined : `Разрешение: ${res}`,
    };
  }

  async disable(): Promise<void> {
    /* Отзыв разрешения — в настройках браузера/ОС; здесь только снимаем флаг. */
  }

  async deliver(events: FamilyEvent[]): Promise<DeliveryReport> {
    const report = emptyDelivery(this.id);
    for (const e of events) {
      report.attempted += 1;
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg && Notification.permission === 'granted') {
          await reg.showNotification(e.title, { body: e.body, tag: e.id, lang: 'ru' });
          report.delivered += 1;
        } else {
          report.failed += 1;
          report.errors.push('нет разрешения или Service Worker');
        }
      } catch (err) {
        report.failed += 1;
        report.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    return report;
  }

  async diagnose(): Promise<DiagnosticSnapshot> {
    const s = await this.isSupported();
    return {
      channelId: this.id,
      enabled: s.permission === 'granted',
      supported: s.supported,
      details: { permission: String(s.permission), standalone: isStandalone() },
    };
  }
}

/** Уровень 1: ICS в нативный календарь. Полностью независим от GitHub и push-сервисов. */
class IcsCalendarChannel implements NotificationChannel {
  readonly id = 'ics-calendar' as const;
  readonly label = 'Календарь телефона (ICS)';
  readonly description =
    'Критичные даты выгружаются в нативный календарь iOS/Android. Напомнит сам телефон — даже если приложение закрыто, а интернет недоступен.';
  readonly worksScreenOff = true;
  readonly needsExternalInfra = false;
  readonly level = 1 as const;

  isSupported(): Promise<SupportReport> {
    // Скачивание .ics работает во всех мобильных браузерах; на iOS открытие файла
    // предлагает «Добавить все события в календарь».
    return Promise.resolve({
      supported: typeof window !== 'undefined' && typeof Blob !== 'undefined',
    });
  }
  enable(): Promise<EnableResult> {
    return Promise.resolve({ enabled: true });
  }
  disable(): Promise<void> {
    return Promise.resolve();
  }
  deliver(): Promise<DeliveryReport> {
    // Реальная генерация ICS — ЭТАП 6 (§6.12). Канал объявлен сейчас, чтобы
    // архитектура и UI-тумблер были готовы.
    return Promise.resolve(emptyDelivery(this.id));
  }
  async diagnose(): Promise<DiagnosticSnapshot> {
    const s = await this.isSupported();
    return {
      channelId: this.id,
      enabled: false,
      supported: s.supported,
      details: { note: 'генерация ICS появится на ЭТАПЕ 6' },
    };
  }
}

/** Уровень 2: Web Push через GitHub Actions. Включается только после проверки на устройствах. */
class WebPushChannel implements NotificationChannel {
  readonly id = 'web-push' as const;
  readonly label = 'Push при закрытом приложении';
  readonly description =
    'Системные уведомления через GitHub Actions. Требует установки PWA на Home Screen и проверки на вашем устройстве (ЭТАП 3).';
  readonly worksScreenOff = true;
  readonly needsExternalInfra = true;
  readonly level = 2 as const;

  isSupported(): Promise<SupportReport> {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      return Promise.resolve({ supported: false, reason: 'Браузер не поддерживает Web Push' });
    }
    if (isIos() && !isStandalone()) {
      // Факт F7: на iOS Web Push работает ТОЛЬКО для PWA, добавленных на Home Screen.
      return Promise.resolve({
        supported: false,
        requiresInstall: true,
        reason:
          'На iPhone нужно сначала установить приложение: Safari → Поделиться → «На экран Домой»',
      });
    }
    return Promise.resolve({
      supported: true,
      requiresInstall: isIos(),
      permission: 'Notification' in window ? Notification.permission : 'unsupported',
    });
  }

  /**
   * ЭТАП 3: настоящая подписка Web Push.
   * Публичный ключ VAPID берём из public/vapid.json приложения (ротация без
   * пересборки), подписку кладём в семейное хранилище data/push/<deviceId>.json —
   * её читает отправитель напоминаний (workflow в публичном репозитории).
   */
  async enable(): Promise<EnableResult> {
    const s = await this.isSupported();
    if (!s.supported) return { enabled: false, reason: s.reason };

    const owner = await kvGet<string>(KV_KEYS.remoteOwner);
    const repo = await kvGet<string>(KV_KEYS.remoteRepo);
    const branch = (await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main';
    if (!owner || !repo) {
      return { enabled: false, reason: 'Сначала подключите семейное хранилище в настройках' };
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      return {
        enabled: false,
        reason: 'Уведомления запрещены для приложения в настройках телефона',
      };
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      return { enabled: false, reason: 'Разрешение на уведомления не получено' };
    }

    let vapidPublicKey: string | undefined;
    try {
      const res = await fetch(new URL('vapid.json', document.baseURI).href);
      const cfg = (await res.json()) as { vapidPublicKey?: string };
      vapidPublicKey = cfg.vapidPublicKey;
    } catch {
      return { enabled: false, reason: 'Не удалось прочитать конфигурацию push (vapid.json)' };
    }
    if (!vapidPublicKey) return { enabled: false, reason: 'Push ещё не настроен владельцем' };

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
      }));

    const deviceId = (await loadSession()).deviceId;
    const client = new GitHubClient({ owner, repo, branch }, () => auth.getToken());
    const path = `data/push/${deviceId}.json`;
    const cur = await client.getFile(path);
    const sha = cur.status === 'ok' ? cur.file.sha : null;
    await client.putFile(
      path,
      JSON.stringify(
        {
          deviceId,
          subscribedAt: new Date().toISOString(),
          revoked: false,
          subscription: sub.toJSON(),
        },
        null,
        2,
      ),
      sha,
      `push: подписка устройства ${deviceId}`,
    );
    return { enabled: true };
  }

  async disable(): Promise<void> {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      const owner = await kvGet<string>(KV_KEYS.remoteOwner);
      const repo = await kvGet<string>(KV_KEYS.remoteRepo);
      const branch = (await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main';
      if (!owner || !repo) return;
      const deviceId = (await loadSession()).deviceId;
      const client = new GitHubClient({ owner, repo, branch }, () => auth.getToken());
      const path = `data/push/${deviceId}.json`;
      const cur = await client.getFile(path);
      const sha = cur.status === 'ok' ? cur.file.sha : null;
      await client.putFile(
        path,
        JSON.stringify({ deviceId, revoked: true, at: new Date().toISOString() }, null, 2),
        sha,
        `push: отписка устройства ${deviceId}`,
      );
    } catch {
      // Отписка — не критично: мёртвые подписки отправитель удалит сам по 410.
    }
  }
  deliver(): Promise<DeliveryReport> {
    return Promise.resolve(emptyDelivery(this.id));
  }
  async diagnose(): Promise<DiagnosticSnapshot> {
    const s = await this.isSupported();
    const reg = await navigator.serviceWorker?.getRegistration?.();
    let subscribed = false;
    try {
      const ready = await navigator.serviceWorker?.ready;
      subscribed = Boolean(await ready?.pushManager?.getSubscription?.());
    } catch {
      // Диагностика не критична: остаётся false.
    }
    return {
      channelId: this.id,
      enabled: subscribed,
      supported: s.supported,
      details: {
        serviceWorkerRegistered: Boolean(reg),
        pushApiSupported: typeof window !== 'undefined' && 'PushManager' in window,
        subscribed,
        standalone: isStandalone(),
        ios: isIos(),
        reason: s.reason ?? null,
      },
    };
  }
}

/** URL-safe base64 (ключ VAPID) → ArrayBuffer для PushManager. */
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/gu, '+').replace(/_/gu, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buf;
}

const registry: NotificationChannel[] = [
  new LocalForegroundChannel(),
  new IcsCalendarChannel(),
  new WebPushChannel(),
];

export const notificationChannels = {
  all(): readonly NotificationChannel[] {
    return registry;
  },
  byId(id: ChannelId): NotificationChannel | undefined {
    return registry.find((c) => c.id === id);
  },
};
