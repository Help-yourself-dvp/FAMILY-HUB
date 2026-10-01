/**
 * Семантика дат (PROJECT.md §6.10 — критично, в исходном ТЗ отсутствовала).
 *
 * «Паспорт действует до 18.10.2030» — это КАЛЕНДАРНАЯ ДАТА, а не момент времени.
 * Храним как строку 'YYYY-MM-DD' и считаем в «локальных днях». Хранение в epoch ms
 * + переход на летнее время дали бы напоминание, сдвинутое на сутки.
 *
 * Все функции чистые и покрыты тестами (tests/dateOnly.test.ts).
 */
export type DateOnly = string; // 'YYYY-MM-DD'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // Проверка реальной существоваемости даты (2026-02-30 — невалидно)
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseDateOnly(value: string): DateOnly {
  if (!isDateOnly(value)) throw new Error(`Некорректная дата (ожидается YYYY-MM-DD): ${String(value)}`);
  return value;
}

export function today(): DateOnly {
  return fromDate(new Date());
}

export function fromDate(d: Date): DateOnly {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Разбор на части в UTC, чтобы часовая зона устройства не влияла на арифметику. */
function parts(date: DateOnly): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(date)!;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function utcMs(date: DateOnly): number {
  const { y, m, d } = parts(date);
  return Date.UTC(y, m - 1, d);
}

export function compareDates(a: DateOnly, b: DateOnly): -1 | 0 | 1 {
  const x = utcMs(a);
  const y = utcMs(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Целое число календарных дней от `from` до `to`. Может быть отрицательным. */
export function diffInDays(from: DateOnly, to: DateOnly): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const d = new Date(utcMs(date) + days * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * Прибавление месяцев/лет с фиксацией края месяца.
 * 2026-01-31 + 1 месяц → 2026-02-28 (не «перепрыгиваем» в март).
 * 2028-02-29 + 1 год → 2029-02-28.
 */
export function addMonthsClamped(date: DateOnly, months: number): DateOnly {
  const { y, m, d } = parts(date);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function addYearsClamped(date: DateOnly, years: number): DateOnly {
  return addMonthsClamped(date, years * 12);
}

export function isBefore(a: DateOnly, b: DateOnly): boolean {
  return compareDates(a, b) < 0;
}

export function isSameOrBefore(a: DateOnly, b: DateOnly): boolean {
  return compareDates(a, b) <= 0;
}

/** Дней до даты от сегодня; отрицательное — дата в прошлом. */
export function daysUntil(date: DateOnly, from: DateOnly = today()): number {
  return diffInDays(from, date);
}

/** Человекочитаемая форма для интерфейса: '18.10.2030'. */
export function formatRu(date: DateOnly): string {
  const { y, m, d } = parts(date);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

/** «через 18 дней» / «сегодня» / «завтра» / «3 дня назад» */
export function humanizeDelta(days: number): string {
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === -1) return 'вчера';
  const abs = Math.abs(days);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = 'дней';
  if (mod10 === 1 && mod100 !== 11) word = 'день';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = 'дня';
  return days > 0 ? `через ${abs} ${word}` : `${abs} ${word} назад`;
}

/**
 * Разбор пользовательского ввода даты '18.10.2030' / '18.10' / '2030-10-18'.
 *
 * Дата БЕЗ года трактуется как ближайшая предстоящая: если в этом году она уже
 * прошла, берём следующий (типично для дней рождения и ежегодных сроков).
 *
 * @param referenceToday опорная дата «сегодня». Инъекционная, чтобы поведение было
 *        детерминированным в тестах и не зависело от дня запуска.
 */
export function parseRuDate(
  input: string,
  fallbackYear: number = new Date().getFullYear(),
  referenceToday: DateOnly = today(),
): DateOnly | null {
  const s = input.trim();

  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) {
    const cand = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    return isDateOnly(cand) ? cand : null;
  }

  m = /^(\d{1,2})[./](\d{1,2})$/.exec(s);
  if (m) {
    const mm = m[2]!.padStart(2, '0');
    const dd = m[1]!.padStart(2, '0');
    const cand = `${fallbackYear}-${mm}-${dd}`;
    if (!isDateOnly(cand)) return null;
    // Уже прошла в этом году → следующий.
    if (compareDates(cand, referenceToday) < 0) {
      const next = `${fallbackYear + 1}-${mm}-${dd}`;
      return isDateOnly(next) ? next : null;
    }
    return cand;
  }

  return isDateOnly(s) ? s : null;
}
