/**
 * Резервный файл календаря. Скачивание НЕ подтверждает импорт в телефон.
 * Обычные события 09:00–09:15 (Москва): DTSTART, DTEND, VTIMEZONE и VALARM.
 * Google описывает импорт .ics через веб-версию на компьютере; поддержка
 * открытия файла в конкретном Android-календаре проверяется на устройстве.
 */
import type { Deadline } from '../domain/types';
import { addDays, formatRu, isDateOnly, type DateOnly } from '../domain/dateOnly';
import { db, kvSet, KV_KEYS } from '../data/db';

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
 * Ссылка на окно создания события с заполненными названием, датой и временем.
 *
 * Решение владельца 2026-10-03: при сохранении срока с галочкой «Добавить в
 * календарь» открывается штатное окно создания записи, а сохранение человек
 * подтверждает сам. Так работает Google Календарь: Chrome на Android отдаёт эту
 * ссылку приложению Google Календаря (окно создания события), иначе открывает
 * веб-форму с теми же полями. Системный календарь Honor из браузера открыть нельзя —
 * у сайтов нет доступа к системному календарю; там остаётся файл .ics.
 *
 * Напоминания в такое окно подставить нельзя: оно покажет обычное напоминание
 * из настроек календаря. Наши ступени (за 30/7/0 дней) ведёт само приложение,
 * а файл .ics несёт их будильниками.
 */
export function googleCalendarUrl(d: Pick<Deadline, 'title' | 'dueDate'>): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[Срок] ${d.title}`,
    dates: `${icsDate(d.dueDate)}T090000/${icsDate(d.dueDate)}T091500`,
    ctz: CALENDAR_TIMEZONE,
    details: `Family Hub · дата срока ${formatRu(d.dueDate)}.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Порядок открытия окна календаря после сохранения срока (см. DeadlinesScreen). */
export const CALENDAR_OPEN_TARGET = '_blank';

/** Пакет приложения Google Календаря на Android. */
export const GOOGLE_CALENDAR_APP_PACKAGE = 'com.google.android.calendar';

/**
 * Клиент Android (Chrome и родственные). Только там имеет смысл intent-ссылка.
 * Проверено по документации Chrome (developer.chrome.com/docs/android/intents, 2026-10-03):
 *  - внешнее приложение запускается лишь схемой `intent:` и только из действия человека;
 *  - запускаются лишь экраны, объявленные browsable;
 *  - если приложение не отозвалось, Chrome сам открывает `browser_fallback_url`.
 * Поэтому окно создания события в приложении календаря открыть с сайта нельзя, но
 * попытка безопасна: при неудаче пользователь получает ту же веб-форму, что и раньше.
 */
export function isAndroidClient(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  if (!/android/iu.test(ua)) return false;
  // `intent:` понимают Chromium-браузеры (Chrome, Samsung Internet, Edge, Яндекс).
  // Firefox и прочие на Android такую ссылку не обработают и покажут ошибку —
  // им отдаём обычную веб-форму.
  return /chrome\//iu.test(ua) || /samsungbrowser|yabrowser|edg\//iu.test(ua);
}

/**
 * Клиент iPhone/iPad. Сайт НЕ может открыть окно создания в Календаре Apple: iOS
 * принимает событие только файлом .ics или подпиской на поток. Поэтому на iPhone
 * ничего не открываем автоматически — окно после сохранения ведёт к файлу
 * (владелец подтвердил 03.10.2026: .ics из приложения добавляется в Календарь iPhone).
 *
 * iPadOS 13+ представляется как «Macintosh», поэтому кроме явных iphone/ipad/ipod
 * проверяем признак «Mobile» в строке: у настоящего macOS его нет.
 */
export function isIosClient(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  if (/iphone|ipad|ipod/iu.test(ua)) return true;
  return /macintosh/iu.test(ua) && /mobile\//iu.test(ua);
}

/** Intent-ссылка: сначала приложение Google Календаря, при неудаче — веб-форма. */
export function googleCalendarAppIntentUrl(webUrl: string): string {
  const data = webUrl.replace(/^https?:\/\//u, '');
  const fallback = encodeURIComponent(webUrl);
  return `intent://${data}#Intent;scheme=https;package=${GOOGLE_CALENDAR_APP_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

export interface CalendarAddTarget {
  url: string;
  /**
   * Что делать сразу после сохранения:
   *  app  — открыть intent-ссылку (приложение Google Календаря на Android);
   *  web  — открыть веб-форму Google Календаря;
   *  none — ничего не открывать (iPhone/iPad: Google-формы там нет, а окно создания
   *         календаря Apple сайт открыть не может — путь через файл в окне экрана).
   */
  kind: 'app' | 'web' | 'none';
}

export function calendarAddTarget(
  d: Pick<Deadline, 'title' | 'dueDate'>,
  userAgent?: string,
): CalendarAddTarget {
  const web = googleCalendarUrl(d);
  if (isAndroidClient(userAgent)) return { url: googleCalendarAppIntentUrl(web), kind: 'app' };
  if (isIosClient(userAgent)) return { url: web, kind: 'none' };
  return { url: web, kind: 'web' };
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

function createIcsBlobUrl(content: string): string {
  // Content-Type обязателен: iOS показывает системное окно «Добавить в календарь»
  // только когда получает именно text/calendar (проверено сообществом: z9bl/gpk-calculator
  // PR #114/#117 — blob: + переход открывает окно события в Safari; a.download и
  // navigator.share дают лишь предпросмотр без кнопки «Добавить»).
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/**
 * Один срок сразу в системное окно календаря (iPhone/iPad).
 *
 * Синхронно, из действия человека: Safari открывает окно только по прямому переходу,
 * поэтому никаких await до этого места. Возвращает false, если браузер заблокировал
 * новую вкладку — тогда экран предложит сохранить файл.
 */
export function openSingleDeadlineIcs(d: Deadline): boolean {
  if (typeof window === 'undefined') return false;
  const url = createIcsBlobUrl(buildSingleDeadlineIcs(d));
  const revoke = URL.revokeObjectURL.bind(URL);
  let opened: boolean;
  try {
    opened = window.open(url, CALENDAR_OPEN_TARGET) !== null;
  } catch {
    opened = false;
  }
  // Если вкладку заблокировали, ссылку не держим; иначе даём системе время её забрать.
  setTimeout(() => revoke(url), opened ? 15_000 : 0);
  void db.transaction('rw', db.kv, async () => {
    await kvSet(KV_KEYS.notifyIcsDownloaded, true);
  });
  return opened;
}

function downloadCalendarFile(content: string, filename: string): void {
  const url = createIcsBlobUrl(content);
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
  return d.dueDate;
}

/** Общий путь экспорта: полная выгрузка файлом, пустой файл за успех не выдаём. */
export async function downloadIcs(
  deadlines: Deadline[],
  filename = 'family-hub-deadlines.ics',
): Promise<IcsDownloadResult> {
  const live = exportableDeadlines(deadlines);
  const dates = live.map((d) => d.dueDate).sort();
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  if (!firstDate || !lastDate)
    throw new Error('Нет семейных сроков с корректной датой для календаря.');
  downloadCalendarFile(buildDeadlinesIcs(live), filename);
  await db.transaction('rw', db.kv, async () => {
    await kvSet(KV_KEYS.notifyIcsDownloaded, true);
    // В диагностику только счётчик, версия формата и время экспорта — НЕ даты сроков.
    await kvSet(KV_KEYS.notifyIcsExport, {
      eventCount: live.length,
      formatRevision: ICS_FORMAT_REVISION,
      exportedAt: new Date().toISOString(),
    });
  });
  return { eventCount: live.length, firstDate, lastDate };
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
