/**
 * Явная ручная проверка настоящего Web Push, не напоминание о сроке.
 * Чистая отправка через переданный transport; семейных файлов/маркеров не читает
 * и не меняет. Наружу только счётчики/HTTP-коды, никогда endpoint/ошибка SDK.
 */
export function pushTestMessage(testId) {
  if (typeof testId !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/u.test(testId)) {
    throw new Error('Некорректный идентификатор проверки push.');
  }
  return {
    title: 'Family Hub: проверка push',
    body: 'Это проверочное сообщение из GitHub, не напоминание о сроке. Нажмите, чтобы открыть настройки.',
    route: '#/settings',
    tag: `fh-push-test-${testId}`,
    kind: 'push-test',
  };
}

export async function sendPushTest(subscriptions, transport, testId) {
  const payload = JSON.stringify(pushTestMessage(testId));
  let accepted = 0;
  let failed = 0;
  const errorsByStatus = {};
  for (const entry of subscriptions) {
    try {
      // Проверка актуальна сейчас, не через сутки после разблокировки телефона.
      await transport(entry.sub, payload, { TTL: 300, urgency: 'high' });
      accepted += 1;
    } catch (error) {
      failed += 1;
      const status = error && error.statusCode;
      const code =
        Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : 'unknown';
      errorsByStatus[code] = (errorsByStatus[code] || 0) + 1;
    }
  }
  return { subscriptions: subscriptions.length, accepted, failed, errorsByStatus };
}
