/**
 * Резервный канал «Календарь телефона» (идея владельца 2026-10-02): дублируем
 * напоминания событиями системного календаря, чтобы срок напомнил сам телефон,
 * даже если сайт, push и фоновая проверка откажут одновременно.
 *
 * Файл .ics — стандарт RFC 5545: любой календарь (iOS, Android, Outlook) его
 * понимает. На каждую ступень напоминания вешается VALARM, поэтому телефон
 * напомнит за те же самые дни, что и приложение.
 */
import type { Deadline } from '../domain/types';

/** Экранирование текста по RFC 5545 §3.3.11. */
export function escapeIcsText(raw: string): string {
  return raw
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r?\n/gu, '\\n');
}

/** «2026-11-15» → «20261115». */
function icsDate(date: string): string {
  return date.replaceAll('-', '');
}

function dtstamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');
}

/**
 * Треггер будильника для ступени «за N дней» у события на весь день:
 * N>0 → 09:00 за N дней до срока; N=0 → 09:00 в день срока.
 */
export function alarmTrigger(days: number): string {
  return days === 0 ? 'TRIGGER:PT9H' : `TRIGGER:-P${days}DT15H`;
}

export interface IcsBuildOptions {
  now?: Date;
}

/** Чистый построитель календаря (покрыт тестом). */
export function buildDeadlinesIcs(deadlines: Deadline[], opts: IcsBuildOptions = {}): string {
  const now = opts.now ?? new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Hub//Deadlines//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const d of deadlines) {
    if (!d || d.deletedAt || d.visibility === 'private' || !d.dueDate) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}@family-hub.local`,
      `DTSTAMP:${dtstamp(now)}`,
      `DTSTART;VALUE=DATE:${icsDate(d.dueDate)}`,
      `SUMMARY:${escapeIcsText(`[Срок] ${d.title}`)}`,
      `DESCRIPTION:${escapeIcsText('Family Hub · напоминание о сроке семьи')}`,
    );
    const steps = (Array.isArray(d.remindersDays) ? d.remindersDays : []).filter((n) => n >= 0);
    if (steps.length === 0) steps.push(0);
    for (const n of steps) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(`Срок: ${d.title}`)}`,
        alarmTrigger(n),
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 требует CRLF; без него некоторые календари файл не понимают.
  return `${lines.join('\r\n')}\r\n`;
}

/** Скачивание .ics: телефон сам предложит добавить события в календарь. */
export function downloadIcs(deadlines: Deadline[], filename = 'family-hub-deadlines.ics'): void {
  const blob = new Blob([buildDeadlinesIcs(deadlines)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
