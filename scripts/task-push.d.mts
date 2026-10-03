import type { TaskNotificationInput } from '../src/domain/taskNotificationRules.mjs';
export function sendTaskPush(
  tasks: readonly TaskNotificationInput[],
  subscriptions: ReadonlyArray<{ deviceId: string; memberId?: string; sub: unknown }>,
  today: string,
  ports: {
    wasSent(marker: string): Promise<boolean>;
    markSent(marker: string): Promise<unknown>;
    send(
      subscription: unknown,
      payload: string,
      options: { TTL: number; urgency: 'high' },
    ): Promise<unknown>;
  },
): Promise<{ accepted: number; skipped: number; failed: number }>;
