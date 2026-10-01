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
   * Реальный срок действия ключа ПО ДАННЫМ GITHUB (ISO-дата) или null.
   *
   * Раньше (до 0.1.4) здесь всегда лежала наша оценка «savedAt + 365 дней», потому что
   * в документации 2022 года срок у fine-grained PAT был обязательным (факт F6).
   * На приёмке 2026-10-01 владелец увидел при создании ключа пункт **«No expiration»** —
   * бессрочные fine-grained PAT существуют, и оценка «год» врала.
   *
   * Теперь срок берётся из заголовка ответа `github-authentication-token-expiration`:
   * GitHub отдаёт его на каждом авторизованном запросе для ключей СО сроком и не отдаёт
   * для бессрочных. Поэтому: ISO-дата = факт, `neverExpires` = факт бессрочности,
   * а `expiresAt === null && !neverExpires` = «ещё не спросили GitHub».
   */
  expiresAt: string | null;
  /** Ключ бессрочный (GitHub не прислал заголовок истечения). */
  neverExpires: boolean;
  /** true, пока срок неизвестен или является нашей оценкой, а не данными GitHub. */
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
  /**
   * Получить факт о сроке из заголовка ответа GitHub
   * (`github-authentication-token-expiration`); null-заголовок = ключ бессрочный.
   */
  noteTokenExpiration(headerValue: string | null): Promise<void>;
}

const DAY_MS = 86_400_000;
const NEVER = 'never';
/** Кэш последнего обработанного заголовка: не пишем в kv одно и то же на каждый запрос. */
let lastNoted: string | null | undefined;

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
    lastNoted = undefined;
    if (expiresAt) {
      // Срок указал сам пользователь — это факт, а не оценка.
      await kvSet(KV_KEYS.authPatExpiresAt, expiresAt);
      await kvSet(KV_KEYS.authPatExpiresIsEstimate, false);
    } else {
      // Срок НЕ выдумываем: до первого ответа GitHub он просто неизвестен.
      await kvDel(KV_KEYS.authPatExpiresAt);
      await kvSet(KV_KEYS.authPatExpiresIsEstimate, true);
    }
  }

  async noteTokenExpiration(headerValue: string | null): Promise<void> {
    if (!(await this.getToken())) return;
    // Повторные запросы несут тот же заголовок: пишем в kv только при изменении.
    if (lastNoted === headerValue) return;
    lastNoted = headerValue;
    if (headerValue) {
      // Формат заголовка: «2027-05-01 00:00:00 UTC». Мусор игнорируем, а не роняем.
      const parsed = Date.parse(headerValue.replace(' UTC', 'Z').replace(' ', 'T'));
      if (Number.isNaN(parsed)) return;
      await kvSet(KV_KEYS.authPatExpiresAt, new Date(parsed).toISOString());
    } else {
      await kvSet(KV_KEYS.authPatExpiresAt, NEVER);
    }
    await kvSet(KV_KEYS.authPatExpiresIsEstimate, false);
  }

  async clear(): Promise<void> {
    lastNoted = undefined;
    await kvDel(KV_KEYS.authPat);
    await kvDel(KV_KEYS.authPatSavedAt);
    await kvDel(KV_KEYS.authPatExpiresAt);
    await kvDel(KV_KEYS.authPatExpiresIsEstimate);
  }

  async describe(): Promise<AuthDescription> {
    const token = await this.getToken();
    const savedAt = (await kvGet<string>(KV_KEYS.authPatSavedAt)) ?? null;
    const raw = (await kvGet<string>(KV_KEYS.authPatExpiresAt)) ?? null;
    const isEstimate = (await kvGet<boolean>(KV_KEYS.authPatExpiresIsEstimate)) ?? true;
    if (!token) {
      return {
        kind: 'none',
        savedAt: null,
        expiresAt: null,
        neverExpires: false,
        expiresIsEstimate: false,
        daysLeft: null,
      };
    }
    if (raw === NEVER) {
      return {
        kind: 'pat',
        savedAt,
        expiresAt: null,
        neverExpires: true,
        expiresIsEstimate: false,
        daysLeft: null,
      };
    }
    const daysLeft = raw ? Math.floor((Date.parse(raw) - Date.now()) / DAY_MS) : null;
    return {
      kind: 'pat',
      savedAt,
      expiresAt: raw,
      neverExpires: false,
      // Оценка только там, где её действительно никто не уточнял (старые установки).
      expiresIsEstimate: isEstimate,
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
    [
      db.shopping,
      db.tasks,
      db.deadlines,
      db.members,
      db.syncMeta,
      db.httpCache,
      db.unresolved,
      db.activity,
    ],
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
