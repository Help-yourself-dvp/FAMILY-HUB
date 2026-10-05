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
import { db, kvGet, kvSet, KV_KEYS } from '../data/db';
import { calendarExportSummary, downloadIcs, exportableDeadlines } from './ics';
import { recordLocalDelivery } from './deliveryState';
import { notificationAppearance } from './appearance';
import { log } from '../shared/log';
import { loadSession } from '../data/session';
import { auth } from '../data/remote/authStrategy';
import { GitHubClient, GitHubError } from '../data/remote/githubClient';

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

/**
 * Запись файла поверх возможной параллельной записи.
 *
 * Факт приёмки 2026-10-03: включение push падало с GitHub 409
 * («data/push/<device>.json does not match <sha>»). Так отвечает GitHub, когда
 * между нашим чтением sha и записью файл успел изменить кто-то ещё (второе
 * устройство, автоматический отправитель напоминаний, повторный тап по тумблеру).
 * Операция идемпотентна: перечитываем свежий sha и повторяем. Конфликт — не
 * ошибка устройства и не «нет сервисов Google», поэтому и текст должен быть честным.
 */
export interface ResilientWriteDeps {
  readSha: () => Promise<string | null>;
  write: (sha: string | null) => Promise<unknown>;
}

export async function writeWithConflictRetry(
  deps: ResilientWriteDeps,
  attempts = 3,
): Promise<{ attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const sha = await deps.readSha();
    try {
      await deps.write(sha);
      return { attempts: attempt };
    } catch (e) {
      lastError = e;
      const conflict = e instanceof GitHubError && e.code === 'conflict';
      log.emit({
        type: 'push:step',
        step: conflict ? `upload-conflict-${attempt}` : `upload-failed-${attempt}`,
      });
      if (!conflict) throw e;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(
    lastError === undefined
      ? 'не удалось записать файл'
      : `не удалось записать файл: ${typeof lastError}`,
  );
}

/** Человеческое объяснение сбоя записи в семейное хранилище (без обвинений не по делу). */
export function describeStorageFailure(e: unknown): string {
  if (!(e instanceof GitHubError)) {
    return `Подписка создана, но сохранить её не удалось: ${e instanceof Error ? e.message : String(e)}. Повторите включение.`;
  }
  switch (e.code) {
    case 'conflict':
      return 'Подписка создана, но файл одновременно изменился в семейном хранилище (так бывает при второй попытке или записи с другого устройства). Повторите включение — данные уже готовы, нужен только повтор.';
    case 'timeout':
    case 'network':
      return 'Подписка создана, но GitHub не ответил (сеть). Повторите включение при устойчивой связи — подписка уже сохранена в телефоне.';
    case 'rate-limit':
    case 'secondary-limit':
      return 'Подписка создана, но GitHub временно ограничил запросы. Повторите включение через несколько минут.';
    case 'forbidden':
    case 'unauthorized':
    case 'no-token':
      return 'Подписка создана, но нет доступа к семейному хранилищу. Проверьте подключение хранилища и токен в настройках.';
    default:
      return `Подписка создана, но сохранить её не удалось (${e.message}). Повторите включение.`;
  }
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
          await reg.showNotification(e.title, {
            ...notificationAppearance(reg.scope),
            body: e.body,
            tag: e.id,
            data: { route: e.route ?? '#/', source: 'local-foreground' },
          });
          await recordLocalDelivery();
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
    'Резервный файл календаря: обычные события в 09:00 (Москва) с напоминаниями. «Включено» означает только скачивание. Импорт подтвердите сами; открытие файла на Android не гарантирует добавление. Выключение здесь не удаляет события из календаря.';
  readonly worksScreenOff = true;
  readonly needsExternalInfra = false;
  readonly level = 1 as const;

  isSupported(): Promise<SupportReport> {
    // Проверяем только способность скачать файл. Наличие импортёра календаря
    // браузеру неизвестно; не обещаем автоматический импорт на Android.
    return Promise.resolve({
      supported: typeof window !== 'undefined' && typeof Blob !== 'undefined',
    });
  }
  async enable(): Promise<EnableResult> {
    try {
      const deadlines = await db.deadlines.toArray();
      const live = exportableDeadlines(deadlines);
      if (live.length === 0) {
        return { enabled: false, reason: 'Сроков пока нет — добавьте срок, затем включите канал' };
      }
      const result = await downloadIcs(live);
      return { enabled: true, reason: calendarExportSummary(result) };
    } catch (e) {
      return { enabled: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  async disable(): Promise<void> {
    // События в системном календаре браузеру недоступны: снимаем только отметку.
    await kvSet(KV_KEYS.notifyIcsDownloaded, false);
  }
  deliver(): Promise<DeliveryReport> {
    // Календарь напомнит сам после ручного импорта файла, не через deliver().
    return Promise.resolve(emptyDelivery(this.id));
  }
  async diagnose(): Promise<DiagnosticSnapshot> {
    const s = await this.isSupported();
    return {
      channelId: this.id,
      enabled: (await kvGet<boolean>(KV_KEYS.notifyIcsDownloaded)) === true,
      supported: s.supported,
      details: { note: 'флаг означает: .ics скачан; импорт подтверждает пользователь' },
    };
  }
}

/** Уровень 2: Web Push через GitHub Actions. Включается только после проверки на устройствах. */
class WebPushChannel implements NotificationChannel {
  readonly id = 'web-push' as const;
  readonly label = 'Push при закрытом приложении';
  readonly description =
    'Системные уведомления приходят, даже когда приложение закрыто. На iPhone нужна установка приложения на экран «Домой».';
  readonly worksScreenOff = true;
  readonly needsExternalInfra = true;
  readonly level = 2 as const;

  /**
   * Защита от гонки: пока идёт включение/выключение, второй тап не запускает
   * вторую параллельную запись того же файла (именно она давала GitHub 409).
   */
  private toggling = false;

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
   * Подписка Web Push:
   * Публичный ключ VAPID берём из public/vapid.json приложения (ротация без
   * пересборки), подписку кладём в семейное хранилище data/push/<deviceId>.json —
   * её читает отправитель напоминаний (workflow в публичном репозитории).
   */
  async enable(): Promise<EnableResult> {
    const s = await this.isSupported();
    if (!s.supported) return { enabled: false, reason: s.reason };
    if (this.toggling) {
      return {
        enabled: false,
        reason: 'Включение уже выполняется — подождите пару секунд и проверьте состояние ещё раз.',
      };
    }
    this.toggling = true;
    try {
      return await this.enableOnce();
    } finally {
      this.toggling = false;
    }
  }

  private async enableOnce(): Promise<EnableResult> {
    log.emit({ type: 'push:step', step: 'enable-start' });

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
    log.emit({ type: 'push:step', step: `permission-${perm}` });
    if (perm !== 'granted') {
      return { enabled: false, reason: 'Разрешение на уведомления не получено' };
    }

    let vapidPublicKey: string | undefined;
    try {
      const res = await fetch(new URL('vapid.json', document.baseURI).href, { cache: 'no-store' });
      const cfg = (await res.json()) as { vapidPublicKey?: string };
      vapidPublicKey = cfg.vapidPublicKey;
    } catch {
      return { enabled: false, reason: 'Не удалось прочитать конфигурацию push (vapid.json)' };
    }
    log.emit({ type: 'push:step', step: vapidPublicKey ? 'vapid-ok' : 'vapid-missing' });
    if (!vapidPublicKey) return { enabled: false, reason: 'Push ещё не настроен владельцем' };

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager
        .subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
        })
        .catch((e) => {
          log.emit({ type: 'push:step', step: 'subscribe-failed' });
          throw e;
        }));
    log.emit({ type: 'push:step', step: 'subscribe-ok' });

    const pushSession = await loadSession();
    const deviceId = pushSession.deviceId;
    const client = new GitHubClient({ owner, repo, branch }, () => auth.getToken());
    const path = `data/push/${deviceId}.json`;
    const payload = JSON.stringify(
      {
        deviceId,
        memberId: pushSession.memberEntityId || deviceId,
        subscribedAt: new Date().toISOString(),
        revoked: false,
        // Тумблер «Push об изменениях корзины» живёт на устройстве, а решение
        // принимает отправитель — поэтому дублируем согласие в файл подписки (0.5.6).
        notifyShopping: (await kvGet<boolean>(KV_KEYS.notifyShoppingPush)) === true,
        subscription: sub.toJSON(),
      },
      null,
      2,
    );
    try {
      const { attempts } = await writeWithConflictRetry({
        readSha: async () => {
          const cur = await client.getFile(path, null, true);
          return cur.status === 'ok' ? cur.file.sha : null;
        },
        write: (sha) => client.putFile(path, payload, sha, `push: подписка устройства ${deviceId}`),
      });
      log.emit({
        type: 'push:step',
        step: attempts > 1 ? `upload-ok-retry-${attempts}` : 'upload-ok',
      });
    } catch (e) {
      // Подписка в телефоне уже есть — второй тап доведёт дело до конца, поэтому
      // возвращаем понятную причину, а не роняем включение с обвинением устройству.
      const reason = describeStorageFailure(e);
      log.emit({ type: 'push:step', step: 'upload-aborted' });
      return { enabled: false, reason };
    }
    return { enabled: true };
  }

  async disable(): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
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
      const payload = JSON.stringify(
        { deviceId, revoked: true, at: new Date().toISOString() },
        null,
        2,
      );
      await writeWithConflictRetry({
        readSha: async () => {
          const cur = await client.getFile(path, null, true);
          return cur.status === 'ok' ? cur.file.sha : null;
        },
        write: (sha) => client.putFile(path, payload, sha, `push: отписка устройства ${deviceId}`),
      });
    } catch {
      // Отписка — не критично: мёртвые подписки отправитель удалит сам по 410.
    } finally {
      this.toggling = false;
    }
  }
  deliver(): Promise<DeliveryReport> {
    return Promise.resolve(emptyDelivery(this.id));
  }
  async diagnose(): Promise<DiagnosticSnapshot> {
    const s = await this.isSupported();
    let reg: ServiceWorkerRegistration | undefined;
    let subscribed: boolean | null = null;
    try {
      reg = await navigator.serviceWorker?.getRegistration?.();
      // ready может никогда не завершиться, если SW ещё не зарегистрирован.
      // Проверка состояния не должна ни ждать установки, ни создавать подписку.
      subscribed = Boolean(await reg?.pushManager?.getSubscription?.());
    } catch {
      // null = проверить не удалось, а не «подписки нет». UI сохранит свой кэш.
    }
    return {
      channelId: this.id,
      enabled: subscribed === true,
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

/**
 * Публикует согласие на дайджест покупок в семейное хранилище (0.5.6).
 *
 * Зачем: тумблер живёт в телефоне, а уведомление шлёт отправитель, который о телефоне
 * ничего не знает. Флаг в файле подписки — единственный канал передачи решения.
 * Если подписки нет или файл чужой/битый — тихо ничего не делаем: без подписки
 * доставка невозможна, а чужие данные переписывать нельзя.
 */
export async function publishShoppingPreference(enabled: boolean): Promise<void> {
  const owner = await kvGet<string>(KV_KEYS.remoteOwner);
  const repo = await kvGet<string>(KV_KEYS.remoteRepo);
  const branch = (await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main';
  if (!owner || !repo) return;
  const deviceId = (await loadSession()).deviceId;
  const client = new GitHubClient({ owner, repo, branch }, () => auth.getToken());
  const path = `data/push/${deviceId}.json`;
  const cur = await client.getFile(path, null, true);
  if (cur.status !== 'ok') return; // подписки нет — обновлять нечего
  let doc: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(cur.file.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    doc = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  if (doc.revoked === true || !doc.subscription) return;
  doc.notifyShopping = enabled;
  doc.prefsAt = new Date().toISOString();
  const payload = JSON.stringify(doc, null, 2);
  await writeWithConflictRetry({
    readSha: async () => {
      const next = await client.getFile(path, null, true);
      return next.status === 'ok' ? next.file.sha : null;
    },
    write: (sha) =>
      client.putFile(
        path,
        payload,
        sha,
        `push: дайджест покупок ${enabled ? 'вкл' : 'выкл'} (${deviceId})`,
      ),
  });
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
