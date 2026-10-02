/**
 * Напоминания о сроках (ЭТАП 6-минимум, решение владельца 2026-10-01).
 *
 * Напоминаем в день из списка remindersDays (90/30/7/0) и один раз о просрочке.
 * Каждое напоминание — ОДИН раз на (устройство, срок, дату, ступень): ключ в kv.
 * Доставка сейчас — локальный канал при открытом приложении; push тем же правилом
 * подключится на ЭТАПЕ 3 (редкие важные события, дайджест не нужен).
 */
import { db, kvGet, kvSet } from '../data/db';
import { session } from '../data/session';
import { daysUntil, today, type DateOnly } from '../domain/dateOnly';
import type { Deadline } from '../domain/types';
import { notificationChannels, type FamilyEvent } from './channels';

/** Ступени напоминания, которые сработали сегодня (чистая функция, покрыта тестом). */
export function reminderHits(d: Deadline, from: DateOnly): Array<number | 'overdue'> {
  const left = daysUntil(d.dueDate, from);
  if (left < 0) return d.remindersDays.length > 0 ? ['overdue'] : [];
  return d.remindersDays.filter((r) => left === r);
}

export function reminderText(d: Deadline, hit: number | 'overdue'): string {
  const left = daysUntil(d.dueDate);
  if (hit === 'overdue')
    return `Срок «${d.title}» прошёл ${-left} дн. назад — проверьте, что сделано.`;
  if (hit === 0) return `Сегодня срок: «${d.title}».`;
  return `«${d.title}»: осталось ${hit} дн. (до ${d.dueDate}).`;
}

let inFlight: Promise<number> | null = null;

/** Фактически показанные локальные уведомления, не число найденных сроков. */
export function runReminderCheck(): Promise<number> {
  if (inFlight) return inFlight;
  const task = deliverPendingReminders().finally(() => {
    inFlight = null;
  });
  inFlight = task;
  return task;
}

async function deliverPendingReminders(): Promise<number> {
  let deviceId: string;
  try {
    deviceId = session().deviceId;
  } catch {
    return 0;
  }
  const channel = notificationChannels.byId('local-foreground');
  if (!channel || !(await channel.isSupported()).supported) return 0;
  const now = today();
  const rows = await db.deadlines.toArray();
  let delivered = 0;
  for (const d of rows) {
    if (d.deletedAt || d.visibility === 'private') continue;
    for (const hit of reminderHits(d, now)) {
      const stem = `${d.id}.${d.dueDate}.${String(hit)}`;
      const key = `remind.${deviceId}.${stem}`;
      const seen = await Promise.all([
        kvGet<boolean>(key),
        kvGet<boolean>(`remind.sw.${stem}`),
        kvGet<boolean>(`remind.push.${stem}.json`),
      ]);
      if (seen.some((value) => value === true)) continue;
      const event: FamilyEvent = {
        id: key,
        title: 'Family Hub: срок',
        body: reminderText(d, hit),
        route: '#/deadlines',
        createdAt: new Date().toISOString(),
      };
      const result = await channel.deliver([event]).catch(() => null);
      // Раньше маркер писался ДО показа: при сбое срок терял своё напоминание.
      if (result && result.delivered > 0) {
        await kvSet(key, true);
        delivered += 1;
      }
    }
  }
  return delivered;
}

/** Подписка: проверка при запуске и раз в 6 часов, пока приложение открыто. */
export function startReminderWatch(): () => void {
  void runReminderCheck();
  const timer = setInterval(() => void runReminderCheck(), 6 * 3_600_000);
  return () => clearInterval(timer);
}
