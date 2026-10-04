/**
 * Регрессия приёмки 2026-10-03: включение push падало с GitHub 409
 * («data/push/<device>.json does not match <sha>»), а интерфейс советовал
 * «нужны сервисы Google». Настоящая причина — параллельная запись того же файла
 * (второй тап, другое устройство, автоматический отправитель). Здесь проверяем:
 * повтор с перечитыванием sha, защиту от двойного тапа и честный текст ошибки.
 * Все данные вымышленные, настоящая сеть запрещена.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeStorageFailure,
  notificationChannels,
  publishShoppingPreference,
  writeWithConflictRetry,
} from '../src/notifications/channels';
import { GitHubError } from '../src/data/remote/githubClient';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { loadSession } from '../src/data/session';
import { auth } from '../src/data/remote/authStrategy';

const VAPID = 'fixture-vapid-public-key';
const subscription = { toJSON: () => ({ endpoint: 'https://fixture.invalid/push', keys: {} }) };
const getSubscription = vi.fn();
const subscribe = vi.fn();
const requestPermission = vi.fn();

/** base64 без Buffer: типы Node в тестовый tsconfig не входят. */
const toBase64 = (text: string) => btoa(text);
const fromBase64 = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));

function conflict(path: string, sha: string) {
  return new Response(JSON.stringify({ message: `${path} does not match ${sha}` }), {
    status: 409,
  });
}

function okFile(sha: string) {
  return new Response(JSON.stringify({ sha, encoding: 'base64', content: toBase64('{}') }), {
    status: 200,
  });
}

beforeEach(async () => {
  await db.kv.clear();
  await kvSet(KV_KEYS.remoteOwner, 'fixture-owner');
  await kvSet(KV_KEYS.remoteRepo, 'fixture-data');
  await kvSet(KV_KEYS.remoteBranch, 'main');
  getSubscription.mockReset().mockResolvedValue(subscription);
  subscribe.mockReset();
  requestPermission.mockReset().mockResolvedValue('granted');
  vi.stubGlobal('navigator', {
    userAgent: 'test-browser',
    maxTouchPoints: 0,
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription, subscribe } }),
      ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }),
    },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission });
  // Токен не настоящий: сеть подменена, семейные данные не читаются.
  vi.spyOn(auth, 'getToken').mockResolvedValue('fixture-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pushChannel() {
  const ch = notificationChannels.byId('web-push');
  if (!ch) throw new Error('канал web-push не найден');
  return ch;
}

describe('writeWithConflictRetry — запись поверх параллельной', () => {
  it('конфликт sha не сдаётся: перечитывает и повторяет', async () => {
    const shas = ['stale', 'fresh'];
    const readSha = vi.fn(() => Promise.resolve(shas.shift() ?? null));
    const write = vi
      .fn<(sha: string | null) => Promise<unknown>>()
      .mockRejectedValueOnce(new GitHubError(409, 'stale does not match', 'conflict'))
      .mockResolvedValueOnce('ok');

    await expect(writeWithConflictRetry({ readSha, write })).resolves.toEqual({ attempts: 2 });
    expect(readSha).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0]).toBe('fresh');
  });

  it('не-конфликт (403) не повторяется: это не гонка, а права', async () => {
    const readSha = vi.fn(() => Promise.resolve('sha'));
    const write = vi
      .fn<(sha: string | null) => Promise<unknown>>()
      .mockRejectedValue(new GitHubError(403, 'Resource not accessible', 'forbidden'));

    await expect(writeWithConflictRetry({ readSha, write })).rejects.toThrow(
      /Resource not accessible/u,
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(readSha).toHaveBeenCalledTimes(1);
  });

  it('после исчерпания попыток отдаёт последнюю ошибку', async () => {
    const readSha = vi.fn(() => Promise.resolve('stale'));
    const write = vi.fn(() =>
      Promise.reject(new GitHubError(409, 'stale does not match', 'conflict')),
    );
    await expect(writeWithConflictRetry({ readSha, write }, 3)).rejects.toBeInstanceOf(GitHubError);
    expect(write).toHaveBeenCalledTimes(3);
  });
});

describe('включение push поверх конфликта', () => {
  it('409 на первой записи: перечитывает sha, повторяет и включает канал', async () => {
    const path = `/repos/fixture-owner/fixture-data/contents/data/push/${(await loadSession()).deviceId}.json`;
    const puts: Array<{ sha: string | null; body: string }> = [];
    let gets = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes('vapid.json')) {
          return Promise.resolve(
            new Response(JSON.stringify({ vapidPublicKey: VAPID }), { status: 200 }),
          );
        }
        const target = new URL(String(url));
        if (target.pathname.startsWith('/repos/')) {
          if (init?.method === 'PUT') {
            const raw = typeof init.body === 'string' ? init.body : '';
            const body = JSON.parse(raw) as { sha?: string; content: string };
            puts.push({ sha: body.sha ?? null, body: body.content });
            if (puts.length === 1) return Promise.resolve(conflict(path, body.sha ?? 'none'));
            return Promise.resolve(
              new Response(JSON.stringify({ content: { sha: 'new-sha' } }), { status: 200 }),
            );
          }
          gets += 1;
          return Promise.resolve(okFile(gets === 1 || puts.length === 0 ? 'stale' : 'fresh'));
        }
        throw new Error(`неожиданный запрос ${url}`);
      }),
    );

    const res = await pushChannel().enable();
    expect(res).toEqual({ enabled: true });
    expect(puts).toHaveLength(2);
    expect(puts[0]?.sha).toBe('stale');
    expect(puts[1]?.sha).toBe('fresh');
    // В теле — настоящая подписка, а не заглушка.
    expect(JSON.parse(fromBase64(puts[1]?.body ?? ''))).toMatchObject({ revoked: false });
  });

  it('конфликт не замалчивается как «нет сервисов Google»', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes('vapid.json')) {
          return Promise.resolve(
            new Response(JSON.stringify({ vapidPublicKey: VAPID }), { status: 200 }),
          );
        }
        if (init?.method === 'PUT') {
          n += 1;
          return Promise.resolve(conflict('data/push/dev-fixture.json', String(n)));
        }
        return Promise.resolve(okFile(`sha-${n}`));
      }),
    );

    const res = await pushChannel().enable();
    expect(res.enabled).toBe(false);
    expect(res.reason).toMatch(/одновременно изменился/u);
    expect(res.reason).toMatch(/Повторите включение/u);
    expect(res.reason).not.toMatch(/Google|сервисы Google/u);
  });

  it('второй тап во время включения не запускает вторую запись', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('vapid.json')
          ? Promise.resolve(
              new Response(JSON.stringify({ vapidPublicKey: VAPID }), { status: 200 }),
            )
          : gate.then(() => okFile('sha')),
      ),
    );

    const ch = pushChannel();
    const first = ch.enable();
    const second = await ch.enable();
    expect(second.enabled).toBe(false);
    expect(second.reason).toMatch(/уже выполняется/u);
    release();
    await expect(first).resolves.toEqual({ enabled: true });
    expect(getSubscription).toHaveBeenCalledTimes(1);
  });

  it('причина сбоя хранилища объясняется словами и не пугает устройством', () => {
    expect(describeStorageFailure(new GitHubError(409, 'x does not match y', 'conflict'))).toMatch(
      /Повторите включение/u,
    );
    expect(describeStorageFailure(new GitHubError(0, 'нет сети', 'network'))).toMatch(/сеть/u);
    expect(describeStorageFailure(new GitHubError(403, 'forbidden', 'forbidden'))).toMatch(
      /нет доступа к семейному хранилищу/u,
    );
  });
});

describe('дайджест покупок: согласие устройства (0.5.6)', () => {
  it('в теле подписки есть флаг согласия (по умолчанию выключен)', async () => {
    const puts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes('vapid.json')) {
          return Promise.resolve(
            new Response(JSON.stringify({ vapidPublicKey: VAPID }), { status: 200 }),
          );
        }
        if (init?.method === 'PUT') {
          const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as {
            content: string;
          };
          puts.push(fromBase64(body.content));
          return Promise.resolve(
            new Response(JSON.stringify({ content: { sha: 'new-sha' } }), { status: 200 }),
          );
        }
        return Promise.resolve(okFile('sha-1'));
      }),
    );

    await expect(pushChannel().enable()).resolves.toEqual({ enabled: true });
    expect(JSON.parse(puts[0] ?? '{}')).toMatchObject({ notifyShopping: false });

    // Включённый тумблер — согласие уходит вместе с подпиской.
    await kvSet(KV_KEYS.notifyShoppingPush, true);
    await expect(pushChannel().enable()).resolves.toEqual({ enabled: true });
    expect(JSON.parse(puts[1] ?? '{}')).toMatchObject({ notifyShopping: true });
  });

  it('переключатель обновляет существующий файл подписки, не теряя саму подписку', async () => {
    const deviceId = (await loadSession()).deviceId;
    const doc = {
      deviceId,
      memberId: 'fixture-member',
      revoked: false,
      notifyShopping: false,
      subscription: { endpoint: 'https://fixture.invalid/push' },
    };
    let putBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const target = new URL(String(url));
        if (!target.pathname.startsWith('/repos/')) throw new Error(`неожиданный запрос ${url}`);
        if (init?.method === 'PUT') {
          const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as {
            content: string;
          };
          putBody = fromBase64(body.content);
          return Promise.resolve(
            new Response(JSON.stringify({ content: { sha: 's2' } }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sha: 's1',
              encoding: 'base64',
              content: toBase64(JSON.stringify(doc)),
            }),
            { status: 200 },
          ),
        );
      }),
    );

    await publishShoppingPreference(true);
    expect(JSON.parse(putBody)).toMatchObject({
      notifyShopping: true,
      subscription: { endpoint: 'https://fixture.invalid/push' },
    });
  });

  it('без подписки на устройстве файл не создаётся и ошибок нет', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const target = new URL(String(url));
        if (!target.pathname.startsWith('/repos/')) throw new Error(`неожиданный запрос ${url}`);
        if (init?.method === 'PUT') throw new Error('PUT не должен вызываться без подписки');
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
        );
      }),
    );

    await expect(publishShoppingPreference(true)).resolves.toBeUndefined();
  });
});
