/**
 * Мелочи формата для блока «Лента (подписка)».
 *
 * Вынесены из компонента: файл с компонентом не должен экспортировать посторонние функции
 * (правило react-refresh/only-export-components), а тестам эти функции нужны.
 */

/** Число событий по-русски: 1 событие, 2 события, 5 событий. */
export function eventsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'событие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'события';
  return 'событий';
}

/**
 * Когда лента обновлялась в последний раз. Время показываем в Москве (единый пояс семьи),
 * и только если отправитель действительно публиковал файл: иначе честнее сказать, что
 * файла ещё нет.
 */
export function formatPublishedAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'время неизвестно';
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  return `${parts} (Москва)`;
}
