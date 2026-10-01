import { describe, expect, it } from 'vitest';
import { canonicalKey, foldYo, normalizeTitle, parseItem } from '../src/domain/normalize';

describe('normalizeTitle', () => {
  it('lowercase, trim, ё→е, пробелы, пунктуация', () => {
    expect(normalizeTitle('  Молоко  Ёлка!! ')).toBe('молоко елка');
    expect(normalizeTitle('Хлеб, чёрный — бородинский')).toBe('хлеб черный бородинский');
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
  it('ЧЕСТНОЕ ОГРАНИЧЕНИЕ: стемминг не объединяет «молоко» и «молочка» (чередование к/ч). ' +
     'Поэтому алиасы остаются обязательным механизмом (PROJECT.md §6.4).', () => {
    // Это не баг, а зафиксированное свойство: тест защищает от ложных ожиданий.
    expect(canonicalKey('молоко')).not.toBe(canonicalKey('молочка'));
  });
});

describe('parseItem', () => {
  it('«бананы 2 кг»', () => {
    expect(parseItem('бананы 2 кг')).toEqual({ title: 'бананы', qty: 2, unit: 'кг' });
  });
});
