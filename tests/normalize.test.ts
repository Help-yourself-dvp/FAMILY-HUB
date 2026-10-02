import { describe, expect, it } from 'vitest';
import { canonicalKey, foldYo, normalizeTitle, parseItem } from '../src/domain/normalize';

describe('normalizeTitle', () => {
  it('регистр пользователя сохраняется, первая буква поднимается, ё→е, пунктуация', () => {
    expect(normalizeTitle('  Молоко  Ёлка!! ')).toBe('Молоко Елка');
    expect(normalizeTitle('Хлеб, чёрный — бородинский')).toBe('Хлеб черный бородинский');
    expect(normalizeTitle('бананы')).toBe('Бананы');
    expect(normalizeTitle('йогурт Активия')).toBe('Йогурт Активия');
  });
});

describe('foldYo', () => {
  it('Ё и ё', () => {
    expect(foldYo('Ёж ёж')).toBe('Еж еж');
  });
});

describe('canonicalKey — поиск дубликатов (ТЗ §18)', () => {
  it('количество в конце не влияет на ключ', () => {
    expect(canonicalKey('Молоко')).toBe('молоко');
    expect(canonicalKey('молоко 2')).toBe('молоко');
    expect(canonicalKey('пакет молока 2')).toBe('пакет молока');
  });
  it('разный регистр и пунктуация дают один ключ', () => {
    expect(canonicalKey('ЗУБНАЯ ПАСТА!')).toBe(canonicalKey('зубная паста'));
  });
  it('разные товары дают разные ключи', () => {
    expect(canonicalKey('молоко')).not.toBe(canonicalKey('молочка'));
  });
  it(
    'ЧЕСТНОЕ ОГРАНИЧЕНИЕ: стемминг не объединяет «молоко» и «молочка» (чередование к/ч). ' +
      'Поэтому алиасы остаются обязательным механизмом (PROJECT.md §6.4).',
    () => {
      // Это не баг, а зафиксированное свойство: тест защищает от ложных ожиданий.
      expect(canonicalKey('молоко')).not.toBe(canonicalKey('молочка'));
    },
  );
});

describe('parseItem', () => {
  it('«бананы 2 кг»', () => {
    expect(parseItem('бананы 2 кг')).toEqual({ title: 'Бананы', qty: 2, unit: 'кг' });
  });
});
