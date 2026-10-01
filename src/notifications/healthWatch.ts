/**
 * Наблюдатель здоровья приложения (решение владельца 2026-10-01, приёмка 0.1.10).
 *
 * Уведомляем ТОЛЬКО о ошибках, требующих действия человека: ключ истёк или
 * отозван, нет доступа к хранилищу, репозиторий не найден, данные повреждены.
 * Потеря сети и таймауты — НЕ уведомляем: это преходящее, телефон дёргать нельзя
 * (прямое указание владельца).
 *
 * Уровень 0: локальный канал, работает при открытом приложении, ноль минут
 * GitHub Actions. Push для закрытого приложения появится на ЭТАПЕ 3 тем же
 * правилом (только требующие действия).
 */
import { subscribeSync } from '../data/sync/state';
import { notificationChannels, type FamilyEvent } from './channels';

/** Коды ошибок, о которых семья должна узнать сама (действие обязательно). */
export const ACTIONABLE_CODES: readonly string[] = [
  'unauthorized',
  'forbidden',
  'not-found',
  'validation',
];

/** Чистое правило (покрыто тестом): уведомлять ли о коде ошибки. */
export function shouldNotifyHealth(code: string): boolean {
  return ACTIONABLE_CODES.includes(code);
}

let lastNotifiedAt: string | null = null;

/** Подписка на состояние синхронизации; возвращает функцию отписки. */
export function startHealthWatch(): () => void {
  return subscribeSync(() => {
    void check();
  });
}

async function check(): Promise<void> {
  const { getSyncState } = await import('../data/sync/state');
  const s = getSyncState();
  const err = s.lastError;
  if (!err || !shouldNotifyHealth(err.code)) return;
  if (err.at === lastNotifiedAt) return; // одно уведомление на экземпляр ошибки
  lastNotifiedAt = err.at;

  const channel = notificationChannels.byId('local-foreground');
  if (!channel) return;
  const support = await channel.isSupported();
  if (!support.supported) return;
  const event: FamilyEvent = {
    id: `health-${err.at}`,
    title: 'Family Hub: нужно ваше действие',
    body: describeActionable(err.code),
    route: '#/settings',
    createdAt: new Date().toISOString(),
  };
  await channel.deliver([event]).catch(() => undefined);
}

function describeActionable(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Ключ доступа к семейному хранилищу истёк или отозван. Откройте настройки и создайте новый ключ по инструкции.';
    case 'forbidden':
      return 'У ключа нет прав на семейное хранилище. Проверьте разрешение Contents: Read and write для репозитория данных.';
    case 'not-found':
      return 'Семейное хранилище не найдено. Проверьте название репозитория в настройках.';
    default:
      return 'Данные семейного хранилища повреждены или созданы новой версией приложения. Обновите приложение или откройте настройки.';
  }
}
