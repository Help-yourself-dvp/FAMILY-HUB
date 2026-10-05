/** Назначения/даты только текущего участника; local при запуске/изменениях/полуночи. */
import { liveQuery } from 'dexie';
import { db, kvGet, kvSet } from '../data/db';
import { session } from '../data/session';
import { today } from '../domain/dateOnly';
import { taskNotificationEvents } from '../domain/taskNotificationRules.mjs';
import { notificationChannels } from './channels';

let inFlight: Promise<number> | null = null;
export function runTaskNotificationCheck(): Promise<number> {
  if (inFlight) return inFlight;
  const task = deliver().finally(() => {
    inFlight = null;
  });
  inFlight = task;
  return task;
}
async function deliver(): Promise<number> {
  let ids: string[];
  try {
    const self = session();
    ids = [self.deviceId, ...(self.memberEntityId ? [self.memberEntityId] : [])];
  } catch {
    return 0;
  }
  const channel = notificationChannels.byId('local-foreground');
  if (!channel || !(await channel.isSupported()).supported) return 0;
  const rows = await db.tasks.toArray();
  let delivered = 0;
  for (const task of rows) {
    for (const event of taskNotificationEvents(task, ids, today())) {
      const key = `remind.task.${event.tag}`;
      const seen = await Promise.all([
        kvGet(key),
        kvGet(`remind.push.${event.tag}`),
        kvGet(`remind.sw.${event.tag}`),
      ]);
      if (seen.some((value) => value === true)) continue;
      const report = await channel
        .deliver([
          {
            id: event.tag,
            title: event.title,
            body: event.body,
            route: event.route,
            createdAt: new Date().toISOString(),
          },
        ])
        .catch(() => null);
      if (report?.delivered) {
        await kvSet(key, true);
        delivered += 1;
      }
    }
  }
  return delivered;
}
export function startTaskNotificationWatch(): () => void {
  const check = () => {
    void runTaskNotificationCheck().catch(() => undefined);
  };
  const subscription = liveQuery(() => db.tasks.toArray()).subscribe({
    next: check,
    error: () => undefined,
  });
  // Только локальная дата/база: сеть и workflow не запускаем каждую минуту.
  const timer = setInterval(check, 60_000);
  return () => {
    subscription.unsubscribe();
    clearInterval(timer);
  };
}
