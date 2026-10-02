/**
 * Нормализация названия товара (ТЗ §16). ЭТАП 1 — базовая версия: достаточно,
 * чтобы дубликаты «Молоко» и «молоко» схлопывались. Полноценный русский стеммер
 * и семейный обучаемый словарь — ЭТАП 5.
 *
 * Уже сейчас честно учитываем ограничение из PROJECT.md §6.4: стеммер НЕ объединит
 * «молоко» и «молочка» (чередование к/ч), поэтому алиасы останутся обязательными.
 */
import { parseQuickQuantity } from './quantity';

export function foldYo(s: string): string {
  return s.replace(/ё/gi, (m) => (m === 'Ё' ? 'Е' : 'е'));
}

export function stripPunctuation(s: string): string {
  return s.replace(/[.,!?;:()"'`*_~/\\|+=[\]{}<>@#$%^&\-—–…]/gu, ' ');
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/gu, ' ').trim();
}

/**
 * Приведение названия (просьба владельца 2026-10-01): регистр ПОЛЬЗОВАТЕЛЯ
 * сохраняется, первая буква поднимается в верхний. «бананы 4 шт, Йогурт Активия»
 * → «Бананы», «Йогурт Активия». На поиск дубликатов не влияет: canonicalKey
 * дополнительно приводится к нижнему регистру.
 */
export function normalizeTitle(raw: string): string {
  const cleaned = collapseSpaces(stripPunctuation(foldYo(raw)));
  if (!cleaned) return cleaned;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Ключ для поиска дубликатов. Отличается от normalizeTitle тем, что из названия
 * извлекаются количество и единица измерения: «пакет молока 2» → ключ «пакет молока»,
 * количество 2. Это ровно то, что нужно для ТЗ §18 (объединение дубликатов).
 */
export function canonicalKey(raw: string): string {
  const parsed = parseQuickQuantity(normalizeTitle(raw));
  const words = parsed.name.split(' ').filter((w) => w.length > 0);
  return words.join(' ').toLowerCase();
}

export interface ParsedInput {
  title: string;
  qty: number | null;
  unit: string | null;
}

/** Разбор одной позиции ввода: «бананы 2 кг» → { title: 'бананы', qty: 2, unit: 'кг' }. */
export function parseItem(raw: string): ParsedInput {
  const parsed = parseQuickQuantity(normalizeTitle(raw));
  return { title: parsed.name, qty: parsed.qty, unit: parsed.unit };
}
