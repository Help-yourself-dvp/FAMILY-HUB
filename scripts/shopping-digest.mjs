/**
 * Дайджест «изменения корзины» (0.5.6) — чистые функции без сети и семейных данных,
 * поэтому проверяются на вымышленных фикстурах (tests/shopping-digest.test.ts).
 *
 * Решение семьи 01.10.2026: push об изменениях корзины — отдельный тумблер, выключен
 * по умолчанию, и приходит дайджестом не чаще раза в 30 минут, а не на каждую позицию.
 * Свои изменения тому, кто их внёс, не возвращаются (сравниваем updatedBy с устройством
 * подписки).
 */

export const SHOPPING_DIGEST_MIN_INTERVAL_MS = 30 * 60 * 1000;
export const SHOPPING_TITLES_LIMIT = 3;

/**
 * Изменения корзины с момента `sinceIso`: активные позиции (не удалённые, не купленные),
 * изменённые позже указанного времени и не этим устройством. Порядок — от старых к новым.
 */
export function shoppingChanges(items, { sinceIso, excludeIds = [] } = {}) {
  const since = typeof sinceIso === 'string' ? Date.parse(sinceIso) : Number.NaN;
  // Без отметки времени сравнивать не с чем: лучше промолчать, чем прислать всю историю.
  if (!Array.isArray(items) || !Number.isFinite(since)) return [];
  const excluded = new Set(
    (Array.isArray(excludeIds) ? excludeIds : []).filter(
      (id) => typeof id === 'string' && id !== '',
    ),
  );
  return items
    .filter((i) => i && typeof i === 'object')
    .filter((i) => typeof i.title === 'string' && i.title.trim() !== '')
    .filter((i) => !i.deletedAt && i.done !== true)
    .filter((i) => {
      const at = Date.parse(i.updatedAt);
      return Number.isFinite(at) && at > since;
    })
    .filter((i) => !excluded.has(i.updatedBy))
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
}

/** Текст уведомления: до трёх названий и честный хвост «и ещё N». */
export function digestText(changes, limit = SHOPPING_TITLES_LIMIT) {
  if (!Array.isArray(changes) || changes.length === 0) return '';
  const titles = changes.slice(0, limit).map((i) => i.title.trim());
  const list = titles.join(', ');
  const more = changes.length - titles.length;
  return more > 0
    ? `Новое в списке покупок: ${list} — и ещё ${more}`
    : `Новое в списке покупок: ${list}`;
}

/** Не чаще раза в 30 минут: иначе цикл пропускается, отметка времени не двигается. */
export function digestAllowed(nowMs, lastSentIso, minIntervalMs = SHOPPING_DIGEST_MIN_INTERVAL_MS) {
  const last = typeof lastSentIso === 'string' ? Date.parse(lastSentIso) : Number.NaN;
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= minIntervalMs;
}
