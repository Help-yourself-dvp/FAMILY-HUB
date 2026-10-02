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

/** Одна проверка: собрать несработавшие напоминания и доставить локально. */
export async function runReminderCheck(): Promise<number> {
  let deviceId: string;
  try {
    deviceId = session().deviceId;
  } catch {
    return 0; // сессия ещё не готова — напоминания подождут следующего такта
  }
  const now = today();
  const rows = await db.deadlines.toArray();
  const events: FamilyEvent[] = [];
  for (const d of rows) {
    if (d.deletedAt || d.visibility === 'private') continue;
    for (const hit of reminderHits(d, now)) {
      const key = `remind.${deviceId}.${d.id}.${d.dueDate}.${String(hit)}`;
      if (await kvGet<boolean>(key)) continue;
      await kvSet(key, true);
      events.push({
        id: key,
        title: 'Family Hub: срок',
        body: reminderText(d, hit),
        route: '#/deadlines',
        createdAt: new Date().toISOString(),
      });
    }
  }
  if (events.length === 0) return 0;
  const channel = notificationChannels.byId('local-foreground');
  if (!channel) return 0;
  const support = await channel.isSupported();
  if (!support.supported) return events.length;
  await channel.deliver(events).catch(() => undefined);
  return events.length;
}

/** Подписка: проверка при запуске и раз в 6 часов, пока приложение открыто. */
export function startReminderWatch(): () => void {
  void runReminderCheck();
  const timer = setInterval(() => void runReminderCheck(), 6 * 3_600_000);
  return () => clearInterval(timer);
}
