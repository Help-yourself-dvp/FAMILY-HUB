/** Адресная доставка задач, политика общая с frontend. Никаких raw exceptions в отчёте. */
import { taskNotificationEvents } from '../src/domain/taskNotificationRules.mjs';

export async function sendTaskPush(tasks, subscriptions, today, ports) {
  let accepted = 0,
    skipped = 0,
    failed = 0;
  for (const entry of subscriptions) {
    const ids = [entry.deviceId, ...(entry.memberId ? [entry.memberId] : [])];
    for (const task of tasks) {
      for (const event of taskNotificationEvents(task, ids, today)) {
        // Серверный маркер на устройство: успех первого телефона не блокирует retry другого.
        const marker = event.tag.replace(/\.json$/u, `.${entry.deviceId}.json`);
        if (await ports.wasSent(marker)) {
          skipped += 1;
          continue;
        }
        try {
          await ports.send(
            entry.sub,
            JSON.stringify({
              title: event.title,
              body: event.body,
              route: event.route,
              tag: event.tag,
            }),
            { TTL: 86400, urgency: 'high' },
          );
          await ports.markSent(marker);
          accepted += 1;
        } catch {
          failed += 1;
        }
      }
    }
  }
  return { accepted, skipped, failed };
}
