/**
 * Адаптер GitHub Contents API → RemoteStorePort.
 *
 * Две оптимизации:
 *  1. условные GET (If-None-Match / ETag) — ответ 304 не расходует лимит
 *     (проверить эмпирически: вопрос Q2 в HANDOFF.md);
 *  2. sha берётся из свежего ответа, а при 304 — из кэша: 304 гарантирует,
 *     что содержимое не изменилось, значит и sha прежний.
 */
import { db, httpCacheRowKey } from './localStore';
import { ConflictError, type RemoteStorePort } from './core';
import { GitHubClient, GitHubError, type RemoteFileResult } from '../remote/githubClient';
import { SCHEMA_VERSION, type EntityKind, type RemoteFile, type Syncable, REMOTE_PATH } from '../../domain/types';

export class GitHubRemoteStore implements RemoteStorePort {
  private client: GitHubClient;
  rateRemaining: number | null = null;

  constructor(
    private cfg: { owner: string; repo: string; branch: string },
    getToken: () => Promise<string | null>,
  ) {
    this.client = new GitHubClient(cfg, async () => {
      const t = await getToken();
      this.rateRemaining = this.client.rateLimit.remaining;
      return t;
    });
  }

  get api(): GitHubClient {
    return this.client;
  }

  private cacheKey(kind: EntityKind): string {
    return httpCacheRowKey(this.cfg.owner, this.cfg.repo, this.cfg.branch, REMOTE_PATH[kind]);
  }

  async read<T extends Syncable>(
    kind: EntityKind,
  ): Promise<{ file: RemoteFile<T>; sha: string | null }> {
    const path = REMOTE_PATH[kind];
    const cached = await db.httpCache.get(this.cacheKey(kind));

    const store = async (f: RemoteFileResult) => {
      const file = parse<T>(f.content, kind);
      await db.httpCache.put({
        key: this.cacheKey(kind),
        etag: f.etag ?? '',
        sha: f.sha,
        body: f.content,
        fetchedAt: new Date().toISOString(),
      });
      return { file, sha: f.sha };
    };

    const fetchOnce = async (etag: string | null) => {
      try {
        return await this.client.getFile(path, etag);
      } catch (e) {
        if (e instanceof GitHubError && e.code === 'not-found') return null;
        throw e;
      } finally {
        this.rateRemaining = this.client.rateLimit.remaining;
      }
    };

    const res = await fetchOnce(cached?.etag ?? null);
    if (res === null) return { file: empty<T>(), sha: null };

    if (res.status === 'missing') return { file: empty<T>(), sha: null };

    if (res.status === 'notModified') {
      // 304 означает: содержимое не изменилось, значит прежние body и sha валидны.
      if (cached) return { file: parse<T>(cached.body, kind), sha: cached.sha };
      // Кэш потерян (например, очистка данных сайта) — перечитываем безусловно.
      const fresh = await fetchOnce(null);
      if (fresh === null || fresh.status !== 'ok') return { file: empty<T>(), sha: null };
      return store(fresh.file);
    }

    return store(res.file);
  }

  async write<T extends Syncable>(
    kind: EntityKind,
    file: RemoteFile<T>,
    sha: string | null,
  ): Promise<string> {
    const message = commitMessage(kind, file);
    try {
      const newSha = await this.client.putFile(REMOTE_PATH[kind], JSON.stringify(file, null, 2), sha, message);
      this.rateRemaining = this.client.rateLimit.remaining;
      // Кэш ETag инвалидируем: содержимое изменилось.
      await db.httpCache.delete(this.cacheKey(kind));
      return newSha;
    } catch (e) {
      if (e instanceof GitHubError && e.code === 'conflict') throw new ConflictError('sha mismatch (409)');
      throw e;
    }
  }
}

function empty<T extends Syncable>(): RemoteFile<T> {
  return { schemaVersion: SCHEMA_VERSION, fileRev: 0, updatedAt: '', entities: {} };
}

/**
 * Разбор удалённого файла с валидацией (§6.18: schema validation для внешних данных).
 * Некорректный JSON или чужая версия схемы НЕ должны ронять приложение:
 * возвращаем пустой файл и пишем диагностическую ошибку.
 */
function parse<T extends Syncable>(raw: string, kind: EntityKind): RemoteFile<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new GitHubError(200, `data/${kind}: файл не является корректным JSON`, 'validation');
  }
  const obj = (json ?? {}) as Partial<RemoteFile<T>>;
  const entities = obj.entities ?? {};

  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > SCHEMA_VERSION) {
    throw new GitHubError(
      200,
      `Схема данных новее приложения (файл: ${obj.schemaVersion}, приложение: ${SCHEMA_VERSION}). Обновите приложение.`,
      'validation',
    );
  }

  // Отбрасываем сущности без обязательных полей, чтобы одна битая запись не убила sync.
  const clean: Record<string, T> = {};
  for (const [id, e] of Object.entries(entities)) {
    if (e && typeof e === 'object' && e.id === id && typeof e.rev === 'number') clean[id] = e;
  }

  return {
    schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : SCHEMA_VERSION,
    fileRev: typeof obj.fileRev === 'number' ? obj.fileRev : 0,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '',
    entities: clean,
  };
}

/**
 * Сообщение коммита: БЕЗ содержимого покупок/дел/сроков (§6.19).
 * Git-история репозитория данных видна всем, у кого есть доступ к репо, —
 * поэтому в сообщении только счётчики.
 */
function commitMessage<T extends Syncable>(kind: EntityKind, file: RemoteFile<T>): string {
  const total = Object.keys(file.entities).length;
  return `sync(${kind}): rev ${file.fileRev}, ${total} записей [family-hub]`;
}
