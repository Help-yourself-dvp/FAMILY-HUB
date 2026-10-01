/**
 * Слой авторизации как СТРАТЕГИЯ (PROJECT.md §2.5).
 *
 * Сейчас реализован единственный подтверждённый вариант — User-Provided
 * Fine-Grained PAT. Если спайк GitHub App Device Flow (вопрос Q1 в HANDOFF.md)
 * подтвердит CORS, добавится вторая стратегия, и переключение будет стоить одной
 * настройки: остальной код не знает, откуда берётся токен.
 *
 * Секреты (§6.19, §8.3): токен хранится только в IndexedDB этого устройства,
 * никогда не логируется и не попадает в сообщения об ошибках.
 */
import { db, kvDel, kvGet, kvSet, KV_KEYS } from '../db';

export interface AuthDescription {
  kind: 'pat' | 'device-flow' | 'none';
  savedAt: string | null;
  /**
   * Fine-grained PAT истекает максимум через год, и это ОБЯЗАТЕЛЬНО (факт F6).
   * GitHub не сообщает срок действия токена через API, поэтому дата — оценка:
   * либо ввёл пользователь, либо savedAt + 365 дней.
   */
  expiresAt: string | null;
  expiresIsEstimate: boolean;
  daysLeft: number | null;
}

export interface AuthStrategy {
  readonly id: string;
  readonly label: string;
  getToken(): Promise<string | null>;
  setToken(token: string, expiresAt?: string | null): Promise<void>;
  clear(): Promise<void>;
  describe(): Promise<AuthDescription>;
}

const DAY_MS = 86_400_000;

export class PatAuthStrategy implements AuthStrategy {
  readonly id = 'pat';
  readonly label = 'Личный ключ доступа GitHub (fine-grained PAT)';

  async getToken(): Promise<string | null> {
    const t = await kvGet<string>(KV_KEYS.authPat);
    return t && t.length > 0 ? t : null;
  }

  async setToken(token: string, expiresAt?: string | null): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) throw new Error('Пустой токен');
    // Базовая защита от вставки не того: fine-grained PAT начинается с `github_pat_`.
    // Классические (`ghp_`) тоже принимаем, но предупреждаем в UI — они дают
    // доступ ко ВСЕМ репозиториям, что нарушает принцип минимальных прав.
    await kvSet(KV_KEYS.authPat, trimmed);
    await kvSet(KV_KEYS.authPatSavedAt, new Date().toISOString());
    await kvSet(
      KV_KEYS.authPatExpiresAt,
      expiresAt ?? new Date(Date.now() + 365 * DAY_MS).toISOString(),
    );
  }

  async clear(): Promise<void> {
    await kvDel(KV_KEYS.authPat);
    await kvDel(KV_KEYS.authPatSavedAt);
    await kvDel(KV_KEYS.authPatExpiresAt);
  }

  async describe(): Promise<AuthDescription> {
    const token = await this.getToken();
    const savedAt = (await kvGet<string>(KV_KEYS.authPatSavedAt)) ?? null;
    const expiresAt = (await kvGet<string>(KV_KEYS.authPatExpiresAt)) ?? null;
    if (!token) {
      return { kind: 'none', savedAt: null, expiresAt: null, expiresIsEstimate: false, daysLeft: null };
    }
    const daysLeft = expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / DAY_MS) : null;
    return {
      kind: 'pat',
      savedAt,
      expiresAt,
      // Если пользователь не указал точную дату — это наша оценка.
      expiresIsEstimate: true,
      daysLeft,
    };
  }

  /** Токен выглядит как классический (широкие права) — показываем предупреждение. */
  static isClassicToken(token: string): boolean {
    return token.trim().startsWith('ghp_') || token.trim().startsWith('gho_');
  }

  static isFineGrained(token: string): boolean {
    return token.trim().startsWith('github_pat_');
  }
}

let active: AuthStrategy = new PatAuthStrategy();

export const auth = {
  current(): AuthStrategy {
    return active;
  },
  /** Для будущего спайка Device Flow и для тестов. */
  setStrategy(s: AuthStrategy): void {
    active = s;
  },
  async getToken(): Promise<string | null> {
    return active.getToken();
  },
};

/** Полная очистка локальных данных (опасное действие → требует подтверждения в UI). */
export async function wipeLocalData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.shopping, db.tasks, db.deadlines, db.members, db.syncMeta, db.httpCache, db.unresolved, db.activity],
    async () => {
      await Promise.all([
        db.shopping.clear(),
        db.tasks.clear(),
        db.deadlines.clear(),
        db.members.clear(),
        db.syncMeta.clear(),
        db.httpCache.clear(),
        db.unresolved.clear(),
        db.activity.clear(),
      ]);
    },
  );
}
