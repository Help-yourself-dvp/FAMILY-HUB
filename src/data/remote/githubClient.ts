/**
 * Клиент GitHub Contents API.
 *
 * Проверено фактически 2026-10-01 (docs/RESEARCH.md, факт F4):
 *   api.github.com отдаёт `access-control-allow-origin: *` → прямые вызовы из
 *   браузера работают, server-side прокси не нужен. Лимит 5000 запросов/час.
 *
 * Никаких секретов в этом модуле нет: токен приходит из AuthStrategy (§2.5).
 */
import { auth } from './authStrategy';

export const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: GitHubErrorCode,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export type GitHubErrorCode =
  | 'no-token'
  | 'unauthorized' // 401 — токен недействителен или истёк (факт F6)
  | 'forbidden' // 403 — нет прав на репозиторий
  | 'not-found' // 404 — репозиторий/файл не найден
  | 'conflict' // 409 — sha не совпал: файл изменили с другого устройства
  | 'validation' // 422 — неверный путь/содержимое
  | 'rate-limit' // 403 + x-ratelimit-remaining: 0
  | 'secondary-limit' // 403/429 + retry-after: abuse detection
  | 'network'
  | 'unknown';

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
}

export interface RemoteFileResult {
  sha: string;
  content: string;
  etag: string | null;
  size: number;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
}

function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/\s+/gu, '');
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export class GitHubClient {
  private lastRate: RateLimitInfo = { limit: null, remaining: null, resetAt: null };

  constructor(
    private cfg: GitHubConfig,
    private getToken: () => Promise<string | null>,
  ) {}

  get rateLimit(): RateLimitInfo {
    return this.lastRate;
  }

  private contentsUrl(path: string): string {
    const { owner, repo } = this.cfg;
    const safe = path.split('/').map(encodeURIComponent).join('/');
    return `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safe}`;
  }

  private async request(url: string, init: RequestInit, token: string | null): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', API_VERSION);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body) headers.set('Content-Type', 'application/json');

    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      throw new GitHubError(0, e instanceof Error ? e.message : 'network failure', 'network');
    }

    // Реальный срок действия ключа (0.1.4): GitHub отдаёт его в заголовке каждого
    // авторизованного ответа, а для бессрочных ключей заголовка нет вовсе.
    if (token) {
      void auth
        .current()
        .noteTokenExpiration(res.headers.get('github-authentication-token-expiration'));
    }

    const limit = res.headers.get('x-ratelimit-limit');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    this.lastRate = {
      limit: limit ? Number(limit) : this.lastRate.limit,
      remaining: remaining ? Number(remaining) : this.lastRate.remaining,
      resetAt: reset ? Number(reset) * 1000 : this.lastRate.resetAt,
    };

    return res;
  }

  private async classify(res: Response): Promise<never> {
    const retryAfter = res.headers.get('retry-after');
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* тело может отсутствовать — оставляем statusText */
    }
    // ВАЖНО (§6.19): сообщение об ошибке не должно содержать токен.
    const safe = message.replace(/Bearer\s+[^\s"]+/giu, 'Bearer [REDACTED]');

    if (res.status === 401) throw new GitHubError(401, safe, 'unauthorized');
    if (res.status === 404) throw new GitHubError(404, safe, 'not-found');
    if (res.status === 409) throw new GitHubError(409, safe, 'conflict');
    if (res.status === 422) throw new GitHubError(422, safe, 'validation');
    if (res.status === 429)
      throw new GitHubError(
        429,
        safe,
        'secondary-limit',
        retryAfter ? Number(retryAfter) : undefined,
      );
    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') throw new GitHubError(403, safe, 'rate-limit');
      if (/abuse|secondary|rate limit/iu.test(safe))
        throw new GitHubError(
          403,
          safe,
          'secondary-limit',
          retryAfter ? Number(retryAfter) : undefined,
        );
      throw new GitHubError(403, safe, 'forbidden');
    }
    throw new GitHubError(res.status, safe, 'unknown');
  }

  /**
   * Чтение файла. Возвращает null, если файла ещё нет (404) — это нормальное
   * состояние для первого запуска: репозиторий данных пуст.
   * @param etag если передан и сервер вернул 304 — возвращаем `notModified`.
   */
  async getFile(
    path: string,
    etag?: string | null,
  ): Promise<
    { status: 'ok'; file: RemoteFileResult } | { status: 'notModified' } | { status: 'missing' }
  > {
    const token = await this.getToken();
    if (!token) throw new GitHubError(0, 'нет токена доступа', 'no-token');

    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.cfg.branch)}`;
    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;

    const res = await this.request(url, { method: 'GET', headers }, token);
    if (res.status === 304) return { status: 'notModified' };
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) await this.classify(res);

    const json = (await res.json()) as {
      sha: string;
      content?: string;
      encoding?: string;
      size?: number;
    };
    if (json.encoding !== 'base64' || typeof json.content !== 'string') {
      // Файл > 1 МБ Contents API отдаёт иначе. Для наших JSON это недостижимо,
      // но молча глотать не будем.
      throw new GitHubError(200, 'неожиданный формат ответа Contents API', 'unknown');
    }
    return {
      status: 'ok',
      file: {
        sha: json.sha,
        content: decodeBase64Utf8(json.content),
        etag: res.headers.get('etag'),
        size: json.size ?? 0,
      },
    };
  }

  /**
   * Запись файла с optimistic concurrency: sha обязателен для существующего файла.
   * При 409 бросает GitHubError('conflict') — вызывающий код обязан перечитать и
   * повторить слияние (§2.2, п.4).
   */
  async putFile(
    path: string,
    content: string,
    sha: string | null,
    message: string,
  ): Promise<string> {
    const token = await this.getToken();
    if (!token) throw new GitHubError(0, 'нет токена доступа', 'no-token');

    const body: Record<string, unknown> = {
      message,
      content: encodeBase64Utf8(content),
      branch: this.cfg.branch,
    };
    if (sha) body.sha = sha;

    const res = await this.request(
      this.contentsUrl(path),
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    );
    if (!res.ok) await this.classify(res);
    const json = (await res.json()) as { content?: { sha?: string }; commit?: { sha?: string } };
    return json.content?.sha ?? json.commit?.sha ?? '';
  }

  /** Проверка токена и прав: возвращает login владельца токена. */
  async verifyToken(): Promise<{ login: string; scopes: string[] }> {
    const token = await this.getToken();
    if (!token) throw new GitHubError(0, 'нет токена доступа', 'no-token');
    const res = await this.request(`${GITHUB_API}/user`, { method: 'GET' }, token);
    if (!res.ok) await this.classify(res);
    const json = (await res.json()) as { login?: string };
    const scopesHeader = res.headers.get('x-oauth-scopes') ?? '';
    return {
      login: json.login ?? 'unknown',
      scopes: scopesHeader
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  /** Доступен ли репозиторий данных с этим токеном. */
  async verifyRepo(): Promise<{ ok: boolean; private: boolean; defaultBranch: string }> {
    const token = await this.getToken();
    if (!token) throw new GitHubError(0, 'нет токена доступа', 'no-token');
    const url = `${GITHUB_API}/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`;
    const res = await this.request(url, { method: 'GET' }, token);
    if (!res.ok) await this.classify(res);
    const json = (await res.json()) as { private?: boolean; default_branch?: string };
    return {
      ok: true,
      private: json.private ?? false,
      defaultBranch: json.default_branch ?? 'main',
    };
  }
}
