/**
 * Русские формы слова по числу: 1 срок, 2 срока, 5 сроков, 11 сроков, 21 срок.
 * Вынесено отдельно, чтобы подписи вида «12 сроков» не собирались вручную по экранам.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
