/**
 * Безопасные подтверждения доставки НА ЭТОМ устройстве.
 * Только счётчики и времена, без текста, ID сроков, токенов и push-подписок.
 * Те же ключи и поля пишет plain-JS Service Worker; контракт проверен тестами.
 */
import { db, kvGet, kvSet, KV_KEYS } from '../data/db';

export type DeliverySource = 'web-push' | 'local-foreground' | 'periodic-background';

export interface DeliveryReceipt {
  receivedCount: number;
  shownCount: number;
  lastReceivedAt: string | null;
  lastShownAt: string | null;
}

export interface CalendarExportReceipt {
  eventCount: number;
  formatRevision: number;
  exportedAt: string | null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function receipt(value: unknown): DeliveryReceipt {
  const row = object(value);
  return {
    receivedCount: count(row.receivedCount),
    shownCount: count(row.shownCount),
    lastReceivedAt: timestamp(row.lastReceivedAt),
    lastShownAt: timestamp(row.lastShownAt),
  };
}

export function deliveryKey(source: DeliverySource): string {
  return `notify.delivery.${source}`;
}

export async function readDeliveryReceipt(source: DeliverySource): Promise<DeliveryReceipt> {
  return receipt(await kvGet(deliveryKey(source)));
}

/** Ошибка служебной записи не должна мешать показу уже доставленного уведомления. */
export async function recordLocalDelivery(): Promise<void> {
  try {
    await db.transaction('rw', db.kv, async () => {
      const key = deliveryKey('local-foreground');
      const previous = receipt(await kvGet(key));
      const at = new Date().toISOString();
      await kvSet(key, {
        receivedCount: previous.receivedCount + 1,
        shownCount: previous.shownCount + 1,
        lastReceivedAt: at,
        lastShownAt: at,
      } satisfies DeliveryReceipt);
    });
  } catch {
    // Само уведомление уже принято системой; в диагностике не выдумываем успех.
  }
}

export async function readCalendarExportReceipt(): Promise<CalendarExportReceipt> {
  const row = object(await kvGet(KV_KEYS.notifyIcsExport));
  return {
    eventCount: count(row.eventCount),
    formatRevision: count(row.formatRevision),
    exportedAt: timestamp(row.exportedAt),
  };
}

/** Проверяем именно активный SW, чтобы новый UI со старым worker не дал ложный «push=0». */
export async function notificationWorkerRevision(): Promise<number | null> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    const active = registration?.active;
    if (!active || typeof MessageChannel === 'undefined') return null;
    return await new Promise<number | null>((resolve) => {
      const channel = new MessageChannel();
      let finished = false;
      const finish = (revision: number | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
        resolve(revision);
      };
      const timer = setTimeout(() => finish(null), 1200);
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const reply = object(event.data);
        const revision = reply.notificationsRevision;
        finish(
          reply.type === 'PONG' &&
            typeof revision === 'number' &&
            Number.isSafeInteger(revision) &&
            revision >= 0
            ? revision
            : null,
        );
      };
      try {
        active.postMessage({ type: 'PING' }, [channel.port2]);
      } catch {
        finish(null);
      }
    });
  } catch {
    return null;
  }
}

export async function notificationDeliverySnapshot() {
  const [webPush, foreground, background, calendarExport, workerNotificationsRevision] =
    await Promise.all([
      readDeliveryReceipt('web-push'),
      readDeliveryReceipt('local-foreground'),
      readDeliveryReceipt('periodic-background'),
      readCalendarExportReceipt(),
      notificationWorkerRevision(),
    ]);
  return { webPush, foreground, background, calendarExport, workerNotificationsRevision };
}
