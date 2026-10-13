import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  addYearsClamped,
  compareDates,
  daysUntil,
  diffInDays,
  formatRu,
  humanizeDelta,
  isDateOnly,
  parseRuDate,
} from '../src/domain/dateOnly';

describe('isDateOnly — валидация', () => {
  it('принимает корректные даты', () => {
    expect(isDateOnly('2030-10-18')).toBe(true);
    expect(isDateOnly('2024-02-29')).toBe(true); // високосный
  });
  it('отклоняет несуществующие даты и мусор', () => {
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('18.10.2030')).toBe(false);
    expect(isDateOnly('2030-10-18T00:00:00Z')).toBe(false);
    expect(isDateOnly('')).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });
});

describe('край месяца и 29 февраля (PROJECT.md §6.10)', () => {
  it('31 января + 1 месяц = 28 февраля, а не «перепрыгивание» в март', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('31 января + 1 месяц в високосном = 29 февраля', () => {
    expect(addMonthsClamped('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
  });
  it('29 февраля + 1 год = 28 февраля', () => {
    expect(addYearsClamped('2028-02-29', 1)).toBe('2029-02-28');
  });
  it('3 месяца после выполнения (сценарий «фильтр воды»)', () => {
    expect(addMonthsClamped('2026-10-15', 3)).toBe('2027-01-15');
  });
  it('отрицательные смещения', () => {
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28');
  });
});

describe('арифметика дней', () => {
  it('diffInDays считает календарные дни, а не 24-часовые отрезки', () => {
    expect(diffInDays('2026-10-01', '2026-10-19')).toBe(18);
    expect(diffInDays('2026-10-19', '2026-10-01')).toBe(-18);
  });
  it('addDays переходит через границы года', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
  it('daysUntil и сравнение', () => {
    expect(daysUntil('2026-10-19', '2026-10-01')).toBe(18);
    expect(compareDates('2026-10-01', '2026-10-02')).toBe(-1);
    expect(compareDates('2026-10-02', '2026-10-02')).toBe(0);
  });
});

describe('humanizeDelta — русская грамматика', () => {
  it.each([
    [0, 'сегодня'],
    [1, 'завтра'],
    [-1, 'вчера'],
    [2, 'через 2 дня'],
    [5, 'через 5 дней'],
    [21, 'через 21 день'],
    [11, 'через 11 дней'],
    [22, 'через 22 дня'],
    [-3, '3 дня назад'],
    // Большие сроки — в годах и месяцах (0.6.26): «через 1018 дней» читалось как ошибка.
    [364, 'через 364 дня'],
    [365, 'через 1 год'],
    [400, 'через 1 год 1 мес.'],
    [1018, 'через 2 года 9 мес.'],
    [-800, '2 года 2 мес. назад'],
  ])('%i → %s', (n, expected) => {
    expect(humanizeDelta(n)).toBe(expected);
  });
});

describe('parseRuDate', () => {
  it('понимает 18.10.2030', () => {
    expect(parseRuDate('18.10.2030')).toBe('2030-10-18');
  });
  it('понимает 18/10/2030 и ISO', () => {
    expect(parseRuDate('18/10/2030')).toBe('2030-10-18');
    expect(parseRuDate('2030-10-18')).toBe('2030-10-18');
  });
  it('дата без года: прошедшая в этом году переносится на следующий (опорная дата инъекционная → детерминированно)', () => {
    const REF = '2026-10-01';
    // 18.10 ещё впереди относительно опорной даты → этот год
    expect(parseRuDate('18.10', 2026, REF)).toBe('2026-10-18');
    // 01.01 уже прошло → следующий год
    expect(parseRuDate('01.01', 2026, REF)).toBe('2027-01-01');
    // ровно опорная дата считается НЕ прошедшей
    expect(parseRuDate('01.10', 2026, REF)).toBe('2026-10-01');
  });
  it('мусор → null, а не исключение', () => {
    expect(parseRuDate('когда-нибудь')).toBeNull();
    expect(parseRuDate('32.13.2030')).toBeNull();
  });
});

describe('formatRu', () => {
  it('2030-10-18 → 18.10.2030', () => {
    expect(formatRu('2030-10-18')).toBe('18.10.2030');
  });
});
