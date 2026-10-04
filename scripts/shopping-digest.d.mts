/** Чистые функции дайджеста покупок; семейные данные здесь не читаются. */
export const SHOPPING_DIGEST_MIN_INTERVAL_MS: number;
export const SHOPPING_TITLES_LIMIT: number;

export interface ShoppingDigestItem {
  id?: string;
  title: string;
  done?: boolean;
  deletedAt?: string | null;
  updatedAt: string;
  updatedBy?: string;
}

export function shoppingChanges(
  items: unknown,
  options?: { sinceIso?: string | null; excludeIds?: Array<string | null | undefined> },
): ShoppingDigestItem[];

export function digestText(changes: ShoppingDigestItem[], limit?: number): string;

export function digestAllowed(
  nowMs: number,
  lastSentIso?: string | null,
  minIntervalMs?: number,
): boolean;
