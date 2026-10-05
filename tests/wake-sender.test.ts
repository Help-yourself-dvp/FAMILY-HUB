/**
 * «Будить отправителя» (0.5.8): просьба к GitHub запустить отправку сразу после того,
 * как устройство что-то записало. Сеть подменена — настоящий GitHub не вызывается.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WAKE_MIN_INTERVAL_MS,
  resetWakeThrottle,
  wakeHint,
  wakePushSender,
} from '../src/data/remote/wake';
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

function stubFetch(dispatchStatus: number, repoStatus = 404): Call[] {
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
      // Проверка «виден ли репозиторий» — обычный GET метаданных, не запуск.
      const status =
        String(url).includes('/repos/') && !String(url).includes('/dispatches')
          ? repoStatus
          : dispatchStatus;
      return Promise.resolve(new Response(null, { status }));
    }),
  );
  return calls;
}

beforeEach(() => {
  resetWakeThrottle();
  vi.spyOn(auth, 'getToken').mockResolvedValue('fixture-token');
});

afterEach(() => {
  // Снимаем возможный отложенный повтор: иначе он выстрелит уже без подмены fetch.
  resetWakeThrottle();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('wakePushSender', () => {
  it('просит GitHub запустить отправителя и передаёт ветку из настроек', async () => {
    const calls = stubFetch(204);
    await expect(wakePushSender('push')).resolves.toEqual({ kind: 'sent' });
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
    // Проверка из настроек идёт принудительно — ограничитель ей не мешает.
    await wakePushSender('manual', { force: true });
    expect(calls).toHaveLength(2);
  });

  it('403 и репозиторий токену не виден: отказ уточнён до доступа', async () => {
    const calls = stubFetch(403, 404);
    await expect(wakePushSender('push')).resolves.toEqual({
      kind: 'failed',
      status: 403,
      repoVisible: false,
    });
    // Два запроса: сам запуск и уточняющая проверка метаданных репозитория.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain('/repos/fixture-owner/FAMILY-HUB');
    expect(calls[1]?.method).toBe('GET');
    // Факт попытки виден в журнале с кодом ответа, но без токена и данных.
    const wakeEntries = log
      .entries()
      .filter((e) => e.event.type === 'wake')
      .map((e) => e.event as { ok: boolean; reason: string; status?: number | null });
    expect(wakeEntries.at(-1)).toMatchObject({ ok: false, reason: 'push', status: 403 });
  });

  it('403 при видимом репозитории: значит, дело в праве Actions', async () => {
    const calls = stubFetch(403, 200);
    await expect(wakePushSender('push')).resolves.toEqual({
      kind: 'failed',
      status: 403,
      repoVisible: true,
    });
    expect(calls).toHaveLength(2);
  });

  it('403 и проба не удалась: причина честно названа неизвестной', async () => {
    const calls = stubFetch(403, 500);
    await expect(wakePushSender('push')).resolves.toEqual({ kind: 'failed', status: 403 });
    expect(calls).toHaveLength(2);
  });

  it('токен не видит публичный репозиторий (404) — тоже с кодом', async () => {
    stubFetch(404);
    await expect(wakePushSender('push')).resolves.toEqual({ kind: 'failed', status: 404 });
  });

  it('просьба в пределах минуты не теряется: повтор уходит сам после окна', async () => {
    vi.useFakeTimers();
    try {
      const calls = stubFetch(204);
      await expect(wakePushSender('push')).resolves.toEqual({ kind: 'sent' });
      expect(calls).toHaveLength(1);

      // Вторая правка сразу после первой: сейчас пропуск, но повтор запланирован.
      await expect(wakePushSender('push')).resolves.toEqual({
        kind: 'skipped',
        reason: 'throttle',
      });
      expect(calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(WAKE_MIN_INTERVAL_MS + 1200);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.body).toBe(JSON.stringify({ ref: 'arena/01a0fbcb-family-hub' }));
    } finally {
      resetWakeThrottle();
      vi.useRealTimers();
    }
  });

  it('без интернета не трогает сеть', async () => {
    const calls = stubFetch(204);
    vi.stubGlobal('navigator', { onLine: false });
    await expect(wakePushSender('push')).resolves.toEqual({ kind: 'skipped', reason: 'offline' });
    expect(calls).toHaveLength(0);
  });

  it('без токена не отправляет запрос', async () => {
    const calls = stubFetch(204);
    vi.spyOn(auth, 'getToken').mockResolvedValue(null);
    await expect(wakePushSender('push')).resolves.toEqual({ kind: 'skipped', reason: 'token' });
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
    await expect(wakePushSender('push')).resolves.toEqual({ kind: 'failed', status: null });
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

describe('wakeHint — что увидит владелец', () => {
  it('успех объясняет, что уведомление придёт не сразу и может не прийти', () => {
    expect(wakeHint({ kind: 'sent' })).toMatch(/пары минут/u);
    expect(wakeHint({ kind: 'sent' })).toMatch(/нечего/u);
  });

  it('403 объясняет про право Actions и не советует сервисы Google', () => {
    const hint = wakeHint({ kind: 'failed', status: 403 });
    expect(hint).toMatch(/Actions/u);
    expect(hint).not.toMatch(/Google/u);
  });

  it('403 без доступа к репозиторию ведёт в Repository access, а не в права', () => {
    const hint = wakeHint({ kind: 'failed', status: 403, repoVisible: false });
    expect(hint).toMatch(/Repository access/u);
    expect(hint).toMatch(/FAMILY-HUB/u);
    // Совет про права в этом случае только путал бы: токен не видит репозиторий.
    expect(hint).not.toMatch(/Actions/u);
    expect(hint).toMatch(/не меняется/u);
  });

  it('403 при видимом репозитории ведёт к праву Actions: Read and write', () => {
    const hint = wakeHint({ kind: 'failed', status: 403, repoVisible: true });
    expect(hint).toMatch(/Actions: Read and write/u);
    expect(hint).toMatch(/не меняется/u);
  });

  it('404 говорит о доступе токена к публичному репозиторию', () => {
    expect(wakeHint({ kind: 'failed', status: 404 })).toMatch(/публичный репозиторий/u);
  });

  it('неизвестный код называется честно, без выдумок', () => {
    expect(wakeHint({ kind: 'failed', status: 500 })).toMatch(/500/u);
    expect(wakeHint({ kind: 'failed', status: null })).toMatch(/сеть|соединение/u);
  });

  it('пропуски (офлайн, нет токена, нет настроек) объяснены простыми словами', () => {
    expect(wakeHint({ kind: 'skipped', reason: 'offline' })).toMatch(/интернет/u);
    expect(wakeHint({ kind: 'skipped', reason: 'token' })).toMatch(/хранилищ/u);
    expect(wakeHint({ kind: 'skipped', reason: 'config' })).toMatch(/vapid/u);
  });
});
