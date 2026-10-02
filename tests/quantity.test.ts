import { describe, expect, it } from 'vitest';
import { canonicalUnit, formatQty, parseNumber, parseQuickQuantity } from '../src/domain/quantity';

describe('parseQuickQuantity', () => {
  it('«бананы 2 кг» → название + количество + единица', () => {
    expect(parseQuickQuantity('бананы 2 кг')).toEqual({ name: 'бананы', qty: 2, unit: 'кг' });
  });
  it('«молоко 2,5 л» с запятой как десятичным разделителем', () => {
    expect(parseQuickQuantity('молоко 2,5 л')).toEqual({ name: 'молоко', qty: 2.5, unit: 'л' });
  });
  it('«молоко 2» без единицы', () => {
    expect(parseQuickQuantity('молоко 2')).toEqual({ name: 'молоко', qty: 2, unit: null });
  });
  it('«хлеб» без количества', () => {
    expect(parseQuickQuantity('хлеб')).toEqual({ name: 'хлеб', qty: null, unit: null });
  });
  it('число ВНУТРИ названия не портится («сок 7 дней»)', () => {
    // Единица «дней» не входит в словарь известных единиц, поэтому хвост не отрезается.
    expect(parseQuickQuantity('сок 7 дней')).toEqual({ name: 'сок 7 дней', qty: null, unit: null });
  });
  it('«пакет молока 2» → количество извлечено, ключ без него', () => {
    expect(parseQuickQuantity('пакет молока 2')).toEqual({
      name: 'пакет молока',
      qty: 2,
      unit: null,
    });
  });
  it('пустая строка', () => {
    expect(parseQuickQuantity('')).toEqual({ name: '', qty: null, unit: null });
  });
});

describe('canonicalUnit', () => {
  it('приводит словоформы к канону', () => {
    expect(canonicalUnit('килограмма')).toBe('кг');
    expect(canonicalUnit('штук')).toBe('шт');
    expect(canonicalUnit('бутылки')).toBe('бут');
  });
  it('неизвестную единицу оставляет как есть', () => {
    expect(canonicalUnit('рулон')).toBe('рулон');
  });
});

describe('parseNumber', () => {
  it('точка и запятая', () => {
    expect(parseNumber('2')).toBe(2);
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('2.5')).toBe(2.5);
  });
  it('не-число → null', () => {
    expect(parseNumber('два')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

describe('formatQty', () => {
  it('2.5 → «2,5»', () => {
    expect(formatQty(2.5)).toBe('2,5');
    expect(formatQty(2)).toBe('2');
    expect(formatQty(null)).toBe('');
  });
});
