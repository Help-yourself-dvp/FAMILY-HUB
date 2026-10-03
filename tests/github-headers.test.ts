/**
 * Регрессия 03.10.2026 (диагностика владельца): «Ошибка: network / Failed to fetch»
 * на КАЖДОМ запросе к api.github.com, хотя интернет есть.
 *
 * Причина была в приложении: версия 0.4.2 добавила заголовок `Cache-Control:
 * no-cache` при чтении файла. Для Authorization-запросов браузер обязан сделать
 * preflight (OPTIONS), а GitHub отвечает на него строгим списком разрешённых
 * заголовков, где Cache-Control НЕТ. Preflight падал → fetch отклонялся с
 * «Failed to fetch», status 0, code network — и синхронизация умирала целиком.
 *
 * Список ниже — фактический ответ api.github.com (проверено curl 2026-10-03):
 *   access-control-allow-headers: Authorization, Content-Type, If-Match,
 *   If-Modified-Since, If-None-Match, If-Unmodified-Since, Accept-Encoding,
 *   X-GitHub-OTP, X-Requested-With, User-Agent, GraphQL-Features,
 *   X-Github-Next-Global-ID, X-GitHub-Api-Version, X-Fetch-Nonce,
 *   Copilot-Integration-Id, DD-CLIENT-TOKEN, X-Client-Application
 *
 * Тест запрещает выход за этот список и требует, чтобы свежесть чтения
 * (нужна перед записью, чтобы не получить 409 по устаревшему sha) достигалась
 * параметром URL, а не заголовком.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '../src/data/remote/githubClient';
import { auth } from '../src/data/remote/authStrategy';

/** Разрешено preflight-ответом GitHub. */
const GITHUB_ALLOWED = new Set([
  'authorization',
  'content-type',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'accept-encoding',
  'x-github-otp',
  'x-requested-with',
  'user-agent',
  'graphql-features',
  'x-github-next-global-id',
  'x-github-api-version',
  'x-fetch-nonce',
  'copilot-integration-id',
  'dd-client-token',
  'x-client-application',
]);

/** Заголовки, которые браузер считает простыми и в preflight не выносит. */
const SAFELISTED = new Set(['accept', 'accept-language', 'content-language', 'range']);

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
}

function fileBody(): string {
  return JSON.stringify({ sha: 'sha-1', encoding: 'base64', content: btoa('{}') });
}

function makeFetcher(calls: Call[]) {
  return vi.fn((url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    calls.push({ method: init?.method ?? 'GET', url: String(url), headers });
    return Promise.resolve(new Response(fileBody(), { status: 200 }));
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(auth, 'getToken').mockResolvedValue('fixture-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function client() {
  return new GitHubClient({ owner: 'fixture-owner', repo: 'fixture-data', branch: 'main' }, () =>
    auth.getToken(),
  );
}

function assertHeadersAllowed(calls: Call[]) {
  for (const call of calls) {
    for (const name of Object.keys(call.headers)) {
      expect(
        GITHUB_ALLOWED.has(name) || SAFELISTED.has(name),
        `заголовок «${name}» не разрешён preflight'ом GitHub → браузер вернёт «Failed to fetch»`,
      ).toBe(true);
      // Регрессионная точка: именно этот заголовок убивал синхронизацию в 0.4.2–0.4.3.
      expect(name).not.toBe('cache-control');
    }
  }
}

describe('заголовки запросов к GitHub не ломают preflight', () => {
  it('обычное чтение и чтение с etag используют только разрешённые заголовки', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', makeFetcher(calls));
    const c = client();
    await c.getFile('data/deadlines.json');
    await c.getFile('data/deadlines.json', 'W/"etag-1"');
    assertHeadersAllowed(calls);
    expect(calls[1]?.headers['if-none-match']).toBe('W/"etag-1"');
  });

  it('свежее чтение (fresh) обходит кэш параметром URL, а не заголовком', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', makeFetcher(calls));
    await client().getFile('data/push/dev-1.json', null, true);
    assertHeadersAllowed(calls);
    expect(calls[0]?.url).toMatch(/[?&]_=\d+/u);
    expect(calls[0]?.url).toContain('ref=main');
    expect(calls[0]?.headers['cache-control']).toBeUndefined();
  });

  it('без fresh адрес остаётся прежним: кэш и 304 продолжают работать', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', makeFetcher(calls));
    await client().getFile('data/tasks.json');
    expect(calls[0]?.url).not.toMatch(/[?&]_=/u);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/fixture-owner/fixture-data/contents/data/tasks.json?ref=main',
    );
  });

  it('запись файла тоже укладывается в разрешённые заголовки', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', makeFetcher(calls));
    await client().putFile('data/push/dev-1.json', '{}', 'sha-1', 'fixture: запись');
    assertHeadersAllowed(calls);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('запрос без токена не отправляет Authorization (и ничего лишнего)', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', makeFetcher(calls));
    vi.spyOn(auth, 'getToken').mockResolvedValue(null);
    await expect(client().getFile('data/deadlines.json')).rejects.toThrow(/нет токена/u);
    expect(calls).toHaveLength(0);
  });
});
