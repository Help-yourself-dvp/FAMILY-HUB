/** Оpaque subscriptions: тест/отчёт не получают их содержимое. */
export interface PushTestMessage {
  title: string;
  body: string;
  route: '#/settings';
  tag: string;
  kind: 'push-test';
}
export interface PushTestReport {
  subscriptions: number;
  accepted: number;
  failed: number;
  errorsByStatus: Record<string, number>;
}
export function pushTestMessage(testId: string): PushTestMessage;
export function sendPushTest(
  subscriptions: ReadonlyArray<{ sub: unknown }>,
  transport: (
    subscription: unknown,
    payload: string,
    options: { TTL: number; urgency: 'high' },
  ) => Promise<unknown>,
  testId: string,
): Promise<PushTestReport>;
