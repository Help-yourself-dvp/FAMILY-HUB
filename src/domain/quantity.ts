/**
 * Распознавание чисел и распространённых единиц (ТЗ §16).
 * Отдельный модуль, потому что используется и нормализацией, и быстрым вводом,
 * и (в ЭТАПЕ 5) разбором строки «молоко 2, хлеб, бананы 2 кг».
 */
export const KNOWN_UNITS: readonly string[] = [
  'кг',
  'кг.',
  'килограмм',
  'килограмма',
  'килограммов',
  'г',
  'г.',
  'грамм',
  'грамма',
  'граммов',
  'л',
  'л.',
  'литр',
  'литра',
  'литров',
  'мл',
  'мл.',
  'миллилитр',
  'миллилитра',
  'миллилитров',
  'шт',
  'шт.',
  'штука',
  'штуки',
  'штук',
  'уп',
  'уп.',
  'упаковка',
  'упаковки',
  'упаковок',
  'пач',
  'пач.',
  'пачка',
  'пачки',
  'пачек',
  'бут',
  'бут.',
  'бутылка',
  'бутылки',
  'бутылок',
  'банк',
  'банк.',
  'банка',
  'банки',
  'банок',
  'м',
  'м.',
  'метр',
  'метра',
  'метров',
  'см',
  'см.',
  'сантиметр',
  'км',
  'км.',
  'километр',
  'километра',
  'километров',
] as const;

const UNIT_SET = new Set<string>(KNOWN_UNITS.map((u) => u.replace(/\.$/u, '')));

/** Каноническая форма единицы для хранения. */
export function canonicalUnit(unit: string | null): string | null {
  if (!unit) return null;
  const u = unit.toLowerCase().replace(/\.$/u, '').trim();
  if (!UNIT_SET.has(u)) return u || null;
  const map: Record<string, string> = {
    килограмм: 'кг',
    килограмма: 'кг',
    килограммов: 'кг',
    кг: 'кг',
    грамм: 'г',
    грамма: 'г',
    граммов: 'г',
    г: 'г',
    литр: 'л',
    литра: 'л',
    литров: 'л',
    л: 'л',
    миллилитр: 'мл',
    миллилитра: 'мл',
    миллилитров: 'мл',
    мл: 'мл',
    штука: 'шт',
    штуки: 'шт',
    штук: 'шт',
    шт: 'шт',
    упаковка: 'уп',
    упаковки: 'уп',
    упаковок: 'уп',
    уп: 'уп',
    пачка: 'пач',
    пачки: 'пач',
    пачек: 'пач',
    пач: 'пач',
    бутылка: 'бут',
    бутылки: 'бут',
    бутылок: 'бут',
    бут: 'бут',
    банка: 'банк',
    банки: 'банк',
    банок: 'банк',
    банк: 'банк',
    метр: 'м',
    метра: 'м',
    метров: 'м',
    м: 'м',
    километр: 'км',
    километра: 'км',
    километров: 'км',
    км: 'км',
    сантиметр: 'см',
    см: 'см',
  };
  return map[u] ?? u;
}

/** Разбор числа: поддержка и точки, и запятой как десятичного разделителя. */
export function parseNumber(token: string): number | null {
  const t = token.replace(',', '.').replace(/\s+/gu, '');
  if (!/^\d+(\.\d+)?$/u.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface QuantityParseResult {
  name: string;
  qty: number | null;
  unit: string | null;
}

/**
 * Извлекает количество и единицу из конца строки.
 *  «бананы 2 кг» → { name: 'бананы', qty: 2, unit: 'кг' }
 *  «молоко 2»    → { name: 'молоко', qty: 2, unit: null }
 *  «хлеб»        → { name: 'хлеб', qty: null, unit: null }
 *  «молоко 2,5 л»→ { name: 'молоко', qty: 2.5, unit: 'л' }
 *
 * Намеренно НЕ трогаем числа внутри названия («сок 7 дней») — извлекаем только
 * хвост, иначе начнём портить реальные названия товаров.
 */
export function parseQuickQuantity(input: string): QuantityParseResult {
  const tokens = input.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return { name: '', qty: null, unit: null };

  let qty: number | null = null;
  let unit: string | null = null;
  let cut = tokens.length;

  const last = tokens[tokens.length - 1]!;
  const lastAsUnit = canonicalUnit(last);
  const lastAsNumber = parseNumber(last);

  if (tokens.length >= 3 && lastAsUnit && UNIT_SET.has(lastAsUnit)) {
    const maybeQty = parseNumber(tokens[tokens.length - 2]!);
    if (maybeQty !== null) {
      qty = maybeQty;
      unit = lastAsUnit;
      cut = tokens.length - 2;
    }
  }

  if (qty === null) {
    if (lastAsNumber !== null && tokens.length >= 2) {
      qty = lastAsNumber;
      cut = tokens.length - 1;
    } else if (
      lastAsNumber === null &&
      lastAsUnit &&
      UNIT_SET.has(lastAsUnit) &&
      tokens.length >= 2
    ) {
      unit = lastAsUnit;
      cut = tokens.length - 1;
    }
  }

  const name = tokens.slice(0, cut).join(' ').trim();
  return { name, qty, unit: unit ? canonicalUnit(unit) : null };
}

/** Число → человекочитаемое количество: 2 → «2», 2.5 → «2,5». */
export function formatQty(qty: number | null): string {
  if (qty === null) return '';
  return String(qty).replace('.', ',');
}
