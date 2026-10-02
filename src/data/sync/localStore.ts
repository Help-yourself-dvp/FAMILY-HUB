/**
 * Адаптер Dexie → LocalStorePort. Вынесен отдельно, чтобы engine.ts не знал
 * про конкретную локальную БД (абстракция хранилища, PROJECT.md §2.2).
 */
import { baseSnapshot, db, localEntities, writeMerged } from '../db';

export function httpCacheRowKey(owner: string, repo: string, branch: string, path: string): string {
  return `${owner}/${repo}@${branch}:${path}`;
}

export { baseSnapshot, db, localEntities, writeMerged };
