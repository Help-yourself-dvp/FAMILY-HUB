/**
 * «Будить отправителя» (0.5.8): просьба к GitHub запустить отправку сразу после того,
 * как устройство что-то записало. Сеть подменена — настоящий GitHub не вызывается.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAKE_MIN_INTERVAL_MS, resetWakeThrottle, wakePushSender } from '../src/data/remote/wake';
import { auth } from '../src/data/remote/authStrategy';
import { log } from '../src/shared/log';
// Сторож: вызов обязан быть в синхронизации, иначе «будильник» никто не дёрнет.
import engineSource from '../src/data/sync/engine.ts?raw';

const WAKE_CFG = {
  vapidPublicKey: 'fixture-key',
  pushWake: {
    owner: 'fixture-owner',
    repo: 'FAMILY-HUB',
    workflow: 'push-sender.yml',
    ref: 'arena/01a0fbcb-family-hub',
  },
};

interface Call {
  url: string;
  method: string;
  body: string;
  authorization: string | null;
}

function stubFetch(dispatchStatus: number): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('vapid.json')) {
        return Promise.resolve(new Response(JSON.stringify(WAKE_CFG), { status: 200 }));
      }
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
        authorization: new Headers(init?.headers).get('Authorization'),
      });
      return Promise.resolve(new Response(null, { status: dispatchStatus }));
    }),
  );
  return calls;
}

beforeEach(() => {
  resetWakeThrottle();
  vi.spyOn(auth, 'getToken').mockResolvedValue('fixture-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('wakePushSender', () => {
  it('просит GitHub запустить отправителя и передаёт ветку из настроек', async () => {
    const calls = stubFetch(204);
    await expect(wakePushSender('push')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/fixture-owner/FAMILY-HUB/actions/workflows/push-sender.yml/dispatches',
    );
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ ref: 'arena/01a0fbcb-family-hub' });
    expect(calls[0]?.authorization).toBe('Bearer fixture-token');
  });

  it('не повторяет просьбу чаще раза в минуту', async () => {
    const calls = stubFetch(204);
    await wakePushSender('push');
    await wakePushSender('push');
    expect(calls).toHaveLength(1);
    expect(WAKE_MIN_INTERVAL_MS).toBe(60_000);
  });

  it('нет права запускать проверки (403) — молчит и не мешает синхронизации', async () => {
    const calls = stubFetch(403);
    await expect(wakePushSender('push')).resolves.toBe(false);
    expect(calls).toHaveLength(1);
    // Факт попытки виден в журнале, но без токена и без содержимого данных.
    const wakeEntries = log
      .entries()
      .filter((e) => e.event.type === 'wake')
      .map((e) => e.event as { ok: boolean; reason: string });
    expect(wakeEntries.at(-1)).toMatchObject({ ok: false, reason: 'push' });
  });

  it('без интернета не трогает сеть', async () => {
    const calls = stubFetch(204);
    vi.stubGlobal('navigator', { onLine: false });
    await expect(wakePushSender('push')).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('без токена не отправляет запрос', async () => {
    const calls = stubFetch(204);
    vi.spyOn(auth, 'getToken').mockResolvedValue(null);
    await expect(wakePushSender('push')).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('сбой сети не роняет приложение', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).includes('vapid.json')) {
          return Promise.resolve(new Response(JSON.stringify(WAKE_CFG), { status: 200 }));
        }
        return Promise.reject(new Error('network down'));
      }),
    );
    await expect(wakePushSender('push')).resolves.toBe(false);
  });

  it('настройки «будильника» читаются из vapid.json (меняются без пересборки)', async () => {
    const calls = stubFetch(204);
    await wakePushSender('push');
    expect(calls).toHaveLength(1);
    // Ветка и репозиторий взяты из конфигурации, а не зашиты в код.
    expect(calls[0]?.url).toContain('/repos/fixture-owner/FAMILY-HUB/');
  });
});

describe('сторож: синхронизация действительно будит отправителя', () => {
  it('просьба уходит только после успешной записи изменений', () => {
    expect(engineSource).toContain("import { wakePushSender } from '../remote/wake';");
    expect(engineSource).toMatch(/if \(pushed > 0\) \{/u);
    expect(engineSource).toContain("void wakePushSender('push');");
  });
});
