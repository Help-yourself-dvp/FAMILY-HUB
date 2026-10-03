/**
 * Резервный файл календаря. Скачивание НЕ подтверждает импорт в телефон.
 * Обычные события 09:00–09:15 (Москва): DTSTART, DTEND, VTIMEZONE и VALARM.
 * Google описывает импорт .ics через веб-версию на компьютере; поддержка
 * открытия файла в конкретном Android-календаре проверяется на устройстве.
 */
import type { Deadline } from '../domain/types';
import { addDays, formatRu, isDateOnly, type DateOnly } from '../domain/dateOnly';
import { db, kvGet, kvSet, KV_KEYS } from '../data/db';

export const ICS_FORMAT_REVISION = 2;
export const CALENDAR_TIMEZONE = 'Europe/Moscow';

/** Экранирование TEXT по RFC 5545, включая отдельный CR и защиту от новых свойств. */
export function escapeIcsText(raw: string): string {
  return raw
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r\n|\r|\n/gu, '\\n');
}

/** RFC 5545: физическая строка <=75 UTF-8 октетов, без разрыва символов. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  let result = '';
  let length = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) {
      result += '\r\n ';
      length = 1;
    }
    result += character;
    length += bytes;
  }
  return result;
}

function icsDate(date: DateOnly): string {
  return date.replaceAll('-', '');
}

function dtstamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');
}

/** Событие уже начинается в 09:00; ступень — ровно N календарных дней раньше. */
export function alarmTrigger(days: number): string {
  return days === 0 ? 'TRIGGER:PT0S' : `TRIGGER:-P${days}D`;
}

export function exportableDeadlines(deadlines: Deadline[]): Deadline[] {
  return deadlines.filter(
    (d) => d && !d.deletedAt && d.visibility === 'family' && isDateOnly(d.dueDate),
  );
}

function reminderSteps(d: Deadline): number[] {
  const steps = [
    ...new Set(
      (Array.isArray(d.remindersDays) ? d.remindersDays : []).filter(
        (n) => Number.isInteger(n) && n >= 0 && n <= 3650,
      ),
    ),
  ];
  return steps.length ? steps.sort((a, b) => b - a) : [0];
}

export interface IcsBuildOptions {
  now?: Date;
}

/**
 * Один VEVENT на срок. Вынесено отдельно, чтобы одиночное событие («этот срок —
 * в календарь») имело тот же UID и те же будильники, что и полная выгрузка:
 * календари, которые сопоставляют события по UID, обновят запись, а не создадут дубль.
 */
function eventLines(d: Deadline, now: Date): string[] {
  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(d.id)}@family-hub.local`,
    `DTSTAMP:${dtstamp(now)}`,
    `DTSTART;TZID=${CALENDAR_TIMEZONE}:${icsDate(d.dueDate)}T090000`,
    `DTEND;TZID=${CALENDAR_TIMEZONE}:${icsDate(d.dueDate)}T091500`,
    `SEQUENCE:${Number.isInteger(d.rev) && d.rev >= 0 ? d.rev : 0}`,
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    `SUMMARY:${escapeIcsText(`[Срок] ${d.title}`)}`,
    `DESCRIPTION:${escapeIcsText(`Family Hub · дата срока ${formatRu(d.dueDate)}. Время напоминания — 09:00 (Москва).`)}`,
  ];
  for (const days of reminderSteps(d)) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`Срок: ${d.title}`)}`,
      alarmTrigger(days),
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

function icsContainer(calendarName: string, body: string[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Hub//Deadlines//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `X-WR-TIMEZONE:${CALENDAR_TIMEZONE}`,
    'BEGIN:VTIMEZONE',
    `TZID:${CALENDAR_TIMEZONE}`,
    `X-LIC-LOCATION:${CALENDAR_TIMEZONE}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0300',
    'TZNAME:MSK',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...body,
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** Чистый построитель, без доступа к семейному хранилищу и браузерному календарю. */
export function buildDeadlinesIcs(deadlines: Deadline[], opts: IcsBuildOptions = {}): string {
  const now = opts.now ?? new Date();
  const body = exportableDeadlines(deadlines).flatMap((d) => eventLines(d, now));
  return icsContainer('Family Hub — сроки', body);
}

/** Файл ровно с одним сроком: для добавления по одному, без повторного импорта всех. */
export function buildSingleDeadlineIcs(deadline: Deadline, opts: IcsBuildOptions = {}): string {
  return icsContainer('Family Hub — срок', eventLines(deadline, opts.now ?? new Date()));
}

/**
 * Ссылка «Открыть в Google Календаре» с заполненным событием. Google подставляет
 * пользователю форму создания: он видит одно событие и сам решает, сохранять ли.
 * Напоминания Google в такую ссылку не принимает — будильники берутся из настроек
 * календаря, поэтому .ics остаётся основным способом (он несёт наши VALARM).
 */
export function googleCalendarUrl(d: Deadline): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[Срок] ${d.title}`,
    dates: `${icsDate(d.dueDate)}T090000/${icsDate(d.dueDate)}T091500`,
    ctz: CALENDAR_TIMEZONE,
    details: `Family Hub · дата срока ${formatRu(d.dueDate)}.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export interface IcsDownloadResult {
  eventCount: number;
  firstDate: DateOnly;
  lastDate: DateOnly;
}

export function calendarExportSummary(result: IcsDownloadResult): string {
  const dates =
    result.firstDate === result.lastDate
      ? formatRu(result.firstDate)
      : `${formatRu(result.firstDate)} — ${formatRu(result.lastDate)}`;
  return `В файле ${result.eventCount} событий. Даты сроков: ${dates}, 09:00 (Москва). Подтвердите импорт и проверьте эти даты в календаре. Скачивание само по себе не добавляет события.`;
}

/**
 * Отметки «этот срок уже выгружали в календарь» (по ревизии и дате).
 *
 * Зачем: телефон показывает при импорте ВСЕ события файла и добавляет их разом,
 * поэтому повторная выгрузка всей семьи плодила дубли. Теперь по умолчанию
 * выгружается только то, чего в календаре ещё нет.
 */
export interface CalendarExportMarks {
  [deadlineId: string]: { rev: number; dueDate: DateOnly };
}

export async function readCalendarExportMarks(): Promise<CalendarExportMarks> {
  return (await kvGet<CalendarExportMarks>(KV_KEYS.notifyCalendarExported)) ?? {};
}

export async function resetCalendarExportMarks(): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    await db.kv.delete(KV_KEYS.notifyCalendarExported);
  });
}

export function pendingForCalendar(
  deadlines: Deadline[],
  marks: CalendarExportMarks | null | undefined,
): Deadline[] {
  return exportableDeadlines(deadlines).filter((d) => {
    const mark = marks?.[d.id];
    return !mark || mark.rev !== d.rev || mark.dueDate !== d.dueDate;
  });
}

export interface CalendarUpdateResult {
  eventCount: number;
  /** Сколько событий в файле впервые (без прежней отметки). */
  freshCount: number;
  /** Сколько уже выгружались, но изменились с тех пор. */
  changedCount: number;
  /** Сколько подходящих сроков всего (до отбора по отметкам). */
  totalCount: number;
  /** Даты есть только тогда, когда в файл что-то попало. */
  firstDate: DateOnly | null;
  lastDate: DateOnly | null;
}

export function calendarUpdateSummary(r: CalendarUpdateResult): string {
  if (r.eventCount === 0)
    return `Новых событий нет: все ${r.totalCount} семейных сроков уже выгружались. Если нужно отправить их заново (например, после сброса календаря), используйте полную выгрузку в настройках.`;
  const parts = [`В файле ${r.eventCount} событий, 09:00 (Москва).`];
  if (r.changedCount > 0)
    parts.push(
      `Из них изменённых: ${r.changedCount} — если прежняя запись уже есть в календаре, удалите её, чтобы не осталось двух.`,
    );
  parts.push('Подтвердите импорт и проверьте даты. Скачивание само по себе не добавляет события.');
  return parts.join(' ');
}

async function writeExportMarks(deadlines: Deadline[]): Promise<void> {
  const marks = await readCalendarExportMarks();
  for (const d of deadlines) marks[d.id] = { rev: d.rev, dueDate: d.dueDate };
  await db.transaction('rw', db.kv, async () => {
    await kvSet(KV_KEYS.notifyCalendarExported, marks);
  });
}

function downloadCalendarFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const revoke = URL.revokeObjectURL.bind(URL);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => revoke(url), 10_000);
  }
}

/** Один срок — отдельным файлом: добавить «вот это» в календарь, не трогая остальные. */
export async function downloadSingleDeadlineIcs(d: Deadline): Promise<DateOnly> {
  downloadCalendarFile(buildSingleDeadlineIcs(d), `family-hub-srok-${d.id}.ics`);
  await db.transaction('rw', db.kv, async () => {
    await kvSet(KV_KEYS.notifyIcsDownloaded, true);
  });
  await writeExportMarks([d]);
  return d.dueDate;
}

/**
 * Выгрузка в календарь телефона.
 * @param all true — все семейные сроки (полная выгрузка), false — только новые и изменённые.
 */
export async function downloadCalendarUpdate(
  deadlines: Deadline[],
  all = false,
): Promise<CalendarUpdateResult> {
  const exportable = exportableDeadlines(deadlines);
  const marks = await readCalendarExportMarks();
  const fresh = exportable.filter((d) => !marks[d.id]);
  const pending = all ? exportable : pendingForCalendar(exportable, marks);
  if (pending.length === 0) {
    const totalCount = exportable.length;
    if (totalCount === 0) throw new Error('Нет семейных сроков с корректной датой для календаря.');
    return {
      eventCount: 0,
      freshCount: 0,
      changedCount: 0,
      totalCount,
      firstDate: null,
      lastDate: null,
    };
  }
  const dates = pending.map((d) => d.dueDate).sort();
  const firstDate = dates[0] ?? null;
  const lastDate = dates.at(-1) ?? null;
  const freshSet = new Set(fresh.map((d) => d.id));
  const freshCount = pending.filter((d) => freshSet.has(d.id)).length;
  downloadCalendarFile(
    buildDeadlinesIcs(pending),
    all ? 'family-hub-deadlines.ics' : 'family-hub-deadlines-new.ics',
  );
  await db.transaction('rw', db.kv, async () => {
    await kvSet(KV_KEYS.notifyIcsDownloaded, true);
    // В диагностику только счётчики, версия формата и время экспорта — НЕ даты сроков.
    await kvSet(KV_KEYS.notifyIcsExport, {
      eventCount: pending.length,
      formatRevision: ICS_FORMAT_REVISION,
      exportedAt: new Date().toISOString(),
      scope: all ? 'all' : 'pending',
    });
  });
  await writeExportMarks(pending);
  return {
    eventCount: pending.length,
    freshCount,
    changedCount: pending.length - freshCount,
    totalCount: exportable.length,
    firstDate,
    lastDate,
  };
}

/** Общий путь экспорта: полная выгрузка, пустой файл за успех не выдаём. */
export async function downloadIcs(
  deadlines: Deadline[],
  _filename = 'family-hub-deadlines.ics',
): Promise<IcsDownloadResult> {
  const { eventCount, firstDate, lastDate } = await downloadCalendarUpdate(deadlines, true);
  if (eventCount === 0 || !firstDate || !lastDate)
    throw new Error('Нет семейных сроков с корректной датой для календаря.');
  return { eventCount, firstDate, lastDate };
}

/** Только вымышленное событие, не записывается в Сроки и не включает резерв семьи. */
export function calendarTestDeadline(now = new Date()): Deadline {
  const date = addDays(now.toLocaleDateString('sv-SE', { timeZone: CALENDAR_TIMEZONE }), 1);
  const at = now.toISOString();
  return {
    id: `family-hub-calendar-test-${date}`,
    kind: 'deadlines',
    rev: 1,
    createdAt: at,
    updatedAt: at,
    updatedBy: 'calendar-test',
    deletedAt: null,
    title: 'Family Hub: проверка календаря',
    deadlineKind: 'custom',
    dueDate: date,
    remindersDays: [0],
    recurrence: { type: 'none' },
    lastCompletedAt: null,
    history: [],
    visibility: 'family',
    note: null,
  };
}

export function downloadCalendarTestIcs(): DateOnly {
  const example = calendarTestDeadline();
  downloadCalendarFile(buildDeadlinesIcs([example]), 'family-hub-calendar-test.ics');
  return example.dueDate;
}

/** Изолированная быстрая проверка native VALARM, UTC-инстанты без неоднозначности зоны. */
export function buildCalendarAlarmTest(now = new Date()) {
  // Округляем вверх до минуты; после импорта есть не меньше пяти минут ожидания.
  const alarmAt = new Date(Math.ceil(now.getTime() / 60000) * 60000 + 5 * 60000);
  const eventAt = new Date(alarmAt.getTime() + 60000);
  const endAt = new Date(eventAt.getTime() + 10 * 60000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Hub//Alarm Test//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:fh-alarm-test-${now.getTime()}@family-hub.local`,
    `DTSTAMP:${dtstamp(now)}`,
    `DTSTART:${dtstamp(eventAt)}`,
    `DTEND:${dtstamp(endAt)}`,
    'SUMMARY:Family Hub: проверка будильника',
    'DESCRIPTION:Вымышленное событие. Не записывается в семейные сроки.',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Family Hub: проверка будильника',
    'TRIGGER:-PT1M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return { content: `${lines.map(foldIcsLine).join('\r\n')}\r\n`, alarmAt, eventAt };
}

export function downloadCalendarAlarmTest() {
  const result = buildCalendarAlarmTest();
  downloadCalendarFile(result.content, 'family-hub-alarm-test.ics');
  return { alarmAt: result.alarmAt, eventAt: result.eventAt };
}
