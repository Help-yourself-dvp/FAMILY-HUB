/** Проверка payload/доставки без сети, подписки только вымышленные. */
import { describe, expect, it, vi } from 'vitest';
import { pushTestMessage, sendPushTest } from '../scripts/push-test.mjs';
import workflow from '../.github/workflows/push-sender.yml?raw';

const subscriptions = [{ sub: { endpoint: 'https://fixture.invalid/one' } }];
const transport = () =>
  vi
    .fn<
      (
        subscription: unknown,
        payload: string,
        options: { TTL: number; urgency: 'high' },
      ) => Promise<unknown>
    >()
    .mockResolvedValue({});

describe('отдельная проверка push', () => {
  it('не изображает событие срока, имеет явный заголовок и ведёт в Настройки', () => {
    const message = pushTestMessage('fixture-1');
    expect(message).toMatchObject({
      title: 'Family Hub: проверка push',
      kind: 'push-test',
      route: '#/settings',
    });
    expect(message.tag).not.toMatch(/\.json$/u);
    expect(message).not.toHaveProperty('deadlineId');
  });

  it('новый ручной запуск отличается tag и не зависит от маркера срока', async () => {
    const send = transport();
    await sendPushTest(subscriptions, send, 'fixture-1');
    await sendPushTest(subscriptions, send, 'fixture-2');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[1]).not.toBe(send.mock.calls[1]?.[1]);
    expect(send.mock.calls[0]?.[2]).toEqual({ TTL: 300, urgency: 'high' });
  });

  it('summary считает принятие провайдером, не придумывает получение телефоном', async () => {
    const result = await sendPushTest(subscriptions, transport(), 'fixture');
    expect(result).toEqual({ subscriptions: 1, accepted: 1, failed: 0, errorsByStatus: {} });
    expect(result).not.toHaveProperty('delivered');
  });

  it('исключения SDK не раскрывают endpoint/текст: только HTTP-коды и числа', async () => {
    const send = transport();
    send.mockRejectedValueOnce(
      Object.assign(new Error('fixture-private-endpoint'), { statusCode: 410 }),
    );
    const result = await sendPushTest(subscriptions, send, 'fixture');
    expect(result).toEqual({
      subscriptions: 1,
      accepted: 0,
      failed: 1,
      errorsByStatus: { '410': 1 },
    });
    expect(JSON.stringify(result)).not.toContain('fixture-private');
    expect(JSON.stringify(result)).not.toContain('https://');
  });

  it('при отсутствии подписок не делает вид, что сообщение отправлено', async () => {
    const send = transport();
    const result = await sendPushTest([], send, 'fixture');
    expect(result.accepted).toBe(0);
    expect(result.subscriptions).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('ручной запуск по умолчанию делает обычный цикл, проверочный push — по выбору', () => {
    // 0.5.8: владелец запускал Run workflow в надежде проверить дайджест покупок, а
    // получал проверочный push и не понимал, где данные. Теперь режим выбирается, по
    // умолчанию — рабочий цикл; cron всегда рабочий.
    expect(workflow).toContain(
      "FH_PUSH_MODE: ${{ github.event_name == 'workflow_dispatch' && inputs.mode || 'reminders' }}",
    );
    expect(workflow).toMatch(/default: reminders/u);
    expect(workflow).toMatch(/- reminders\n\s*- test/u);
  });
});
