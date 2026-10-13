/**
 * Лента (подписка) — 0.6.0, решение владельца 05.10.2026.
 *
 * Идея: отправитель собирает один .ics и кладёт его по постоянной ссылке; календарь телефона
 * сам скачивает её по расписанию. Никаких галочек, файлов и системных окон — события
 * появляются у всех участников. Формат — тот же, что у файла из приложения (09:00–09:15
 * Москва, VTIMEZONE, будильники по ступеням срока), поэтому события не «двоятся» и не
 * сдвигаются по времени.
 *
 * Честные границы (подробности — docs/NOTIFICATIONS.md):
 *  - календарь обновляет подписку не мгновенно: часы, иногда сутки — это его дело, не наше;
 *  - на iPhone у подписного календаря есть «Удалить будильники» — если включён, событие будет
 *    видно, а звонка не будет; проверить это должен человек на своём телефоне;
 *  - дела (задачи) публикуем БЕЗ будильников: уведомление о деле по правилу семьи получает
 *    только исполнитель, а лента общая — звонок всем о чужом деле был бы шумом.
 *
 * Чистые функции: ни сети, ни семейных данных — только текст календаря. Поэтому проверяются
 * на вымышленных фикстурах (tests/feed.test.ts).
 */

export const CALENDAR_TIMEZONE = 'Europe/Moscow';
/**
 * Подсказка календарям, как часто перечитывать ленту (Google/Apple понимают по-разному).
 * 0.6.9: было PT4H. iPhone honour REFRESH-INTERVAL буквально — с PT4H новое событие
 * могло не появиться четыре часа даже после публикации. PT15M — компромисс: заметно
 * живее для семьи и при этом не чаще, чем всякий здоровый подписной календарь.
 * Google этой подсказкой не руководствуется и перечитывает по своему графику (часы).
 */
export const FEED_REFRESH = 'PT15M';

/** Экранирование TEXT по RFC 5545 (то же правило, что в приложении). */
export function escapeIcsText(raw) {
  return String(raw)
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r\n|\r|\n/gu, '\\n');
}

/** RFC 5545: физическая строка не длиннее 75 UTF-8 октетов, без разрыва символов. */
export function foldIcsLine(line) {
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

function icsDate(date) {
  return String(date).replaceAll('-', '');
}

function stamp(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');
}

function isDateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

/** Ступени напоминаний: только целые дни 0…3650, без повторов; по умолчанию «в день срока». */
export function reminderSteps(deadline) {
  const raw = Array.isArray(deadline.remindersDays) ? deadline.remindersDays : [];
  const steps = [...new Set(raw.filter((n) => Number.isInteger(n) && n >= 0 && n <= 3650))];
  return steps.length ? steps.sort((a, b) => b - a) : [0];
}

export function alarmTrigger(days) {
  return days === 0 ? 'TRIGGER:PT0S' : `TRIGGER:-P${days}D`;
}

/** Сроки, достойные ленты: семейные, не удалённые, с календарной датой. */
export function feedableDeadlines(deadlines) {
  return (Array.isArray(deadlines) ? deadlines : []).filter(
    (d) => d && !d.deletedAt && d.visibility !== 'private' && isDateOnly(d.dueDate),
  );
}

/** Дела: открытые, не удалённые, с календарной датой. */
export function feedableTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).filter(
    (t) => t && !t.deletedAt && t.status === 'open' && isDateOnly(t.dueDate),
  );
}

function eventLines(item, { kind, withAlarms }) {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(`${kind}-${item.id}`)}@family-hub.local`,
    `DTSTAMP:${stamp(item.updatedAt) ?? stamp(new Date().toISOString())}`,
    `DTSTART;TZID=${CALENDAR_TIMEZONE}:${icsDate(item.dueDate)}T090000`,
    `DTEND;TZID=${CALENDAR_TIMEZONE}:${icsDate(item.dueDate)}T091500`,
    `SEQUENCE:${Number.isInteger(item.rev) && item.rev >= 0 ? item.rev : 0}`,
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    // Метка приложения впереди — в месячном виде сразу видно, что событие из Family Hub.
    `SUMMARY:${escapeIcsText(`Family Hub · ${title}`)}`,
    `DESCRIPTION:${escapeIcsText(
      kind === 'deadline'
        ? 'Создано в приложении Family Hub. Срок в календаре семьи.'
        : 'Создано в приложении Family Hub: дело семьи с датой.',
    )}`,
  ];
  if (withAlarms) {
    for (const days of reminderSteps(item)) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(`Family Hub · срок «${title}»`)}`,
        alarmTrigger(days),
        'END:VALARM',
      );
    }
  }
  lines.push('END:VEVENT');
  return lines;
}

function container(calendarName, bodyLines) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Hub//Feed//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `X-WR-TIMEZONE:${CALENDAR_TIMEZONE}`,
    // Google и Apple по-разному уважают эти подсказки, но лишними они не бывают.
    `REFRESH-INTERVAL;VALUE=DURATION:${FEED_REFRESH}`,
    `X-PUBLISHED-TTL:${FEED_REFRESH}`,
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
    ...bodyLines,
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/**
 * Текст ленты для одного раздела. Пустой раздел — это честный ПУСТОЙ календарь: если семья
 * выключила раздел, подписанный календарь очистится, а не останется со старыми событиями.
 */
export function buildFeedIcs({ section, deadlines = [], tasks = [] }) {
  if (section === 'deadlines') {
    const body = feedableDeadlines(deadlines).flatMap((d) =>
      eventLines(d, { kind: 'deadline', withAlarms: true }),
    );
    return container('Family Hub — сроки', body);
  }
  if (section === 'tasks') {
    const body = feedableTasks(tasks).flatMap((t) =>
      // Без будильников: дело будит только исполнителя, а лента общая.
      eventLines(t, { kind: 'task', withAlarms: false }),
    );
    return container('Family Hub — дела', body);
  }
  throw new Error(`Неизвестный раздел ленты: ${section}`);
}

/** Новая секретная часть адреса: 32 шестнадцатеричных знака (как у секретных ссылок GitHub). */
export function newFeedSlug(random = () => crypto.randomUUID()) {
  return String(random()).replaceAll('-', '').toLowerCase();
}

/** Постоянный адрес файла ленты. Ветка — отдельная, чтобы обновления ленты не трогали код. */
export function feedUrl({ owner, repo, branch = 'feed', slug }) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/feed/${slug}.ics`;
}

/** Куда отправитель кладёт файлы: путь в публичном репозитории приложения. */
export function feedPath(slug) {
  return `feed/${slug}.ics`;
}

/* ----------------------- Сводка для виджета на рабочем столе ----------------------- */

/**
 * Короткая сводка «ближайший срок · сколько дел» для виджета на рабочем столе (0.6.30).
 *
 * Зачем файл, если виджет нарисовать веб-приложение не может: настоящий виджет Android —
 * функция платформы, а не веб-страницы. Зато приложение может положить рядом с лентой
 * маленький файл, который прочитает программа-виджет на телефоне (MacroDroid, KWGT) —
 * она же обновляет надпись по расписанию. Адрес — та же секретная часть, что у календаря.
 *
 * Выключатели те же, что у ленты: выключенный раздел в сводку не попадает (приватные
 * сроки не попадают никогда — см. feedableDeadlines).
 */
export const WIDGET_FORMAT = 'family-hub-widget';

/** Путь файла-сводки в публичном репозитории (рядом с .ics, в ветке ленты). */
export function widgetPath(slug) {
  return `feed/${slug}.json`;
}

/** Дней от `today` (ГГГГ-ММ-ДД) до даты; отрицательное — дата в прошлом. */
export function daysUntil(today, dateOnly) {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function pluralRu(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/**
 * Подпись к числу дней для виджета: будущее — как в приложении, прошедшее — словом
 * «просрочено» (на маленькой надписи «3 дня назад» читается как история, а не как долг).
 */
export function humanDays(days) {
  if (days === null) return '';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === -1) return 'вчера';
  const n = Math.abs(days);
  const years = Math.floor(n / 365);
  const months = Math.floor((n % 365) / 30);
  if (years >= 1) {
    const tail = months > 0 ? ` ${months} мес.` : '';
    const yearsWord = pluralRu(years, 'год', 'года', 'лет');
    return days > 0 ? `через ${years} ${yearsWord}${tail}` : `просрочено на ${years} ${yearsWord}${tail}`;
  }
  const word = pluralRu(n, 'день', 'дня', 'дней');
  return days > 0 ? `через ${n} ${word}` : `просрочено на ${n} ${word}`;
}

/**
 * @param {{ deadlines?: unknown, tasks?: unknown, sections?: { deadlines?: boolean, tasks?: boolean }, today?: string, now?: string }} input
 * @returns {Record<string, unknown>} объект сводки (публикуется как JSON)
 */
export function buildWidgetSummary({
  deadlines = [],
  tasks = [],
  sections = {},
  today = new Date().toISOString().slice(0, 10),
  now = new Date().toISOString(),
} = {}) {
  const secDeadlines = sections?.deadlines === true;
  const secTasks = sections?.tasks === true;

  const dl = secDeadlines ? feedableDeadlines(deadlines) : [];
  const withDays = dl
    .map((d) => ({ entity: d, days: daysUntil(today, String(d.dueDate)) }))
    .filter((x) => x.days !== null)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const nearest = withDays[0] ?? null;

  const tk = secTasks ? feedableTasks(tasks) : [];
  const taskDays = tk
    .map((t) => ({ entity: t, days: daysUntil(today, String(t.dueDate)) }))
    .filter((x) => x.days !== null)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const nearestTask = taskDays[0] ?? null;

  const openTasks = tk.length;
  const todayTasks = taskDays.filter((x) => x.days === 0).length;
  const overdueTasks = taskDays.filter((x) => (x.days ?? 0) < 0).length;
  const within7 = withDays.filter((x) => (x.days ?? 0) >= 0 && (x.days ?? 0) <= 7).length;
  const overdueDeadlines = withDays.filter((x) => (x.days ?? 0) < 0).length;

  const deadlinePart = nearest
    ? `${String(nearest.entity.title ?? '').trim()} — ${humanDays(nearest.days)}`
    : null;
  const tasksPart = secTasks ? `дел: ${openTasks}${overdueTasks ? ` (просрочено ${overdueTasks})` : ''}` : null;
  const parts = [deadlinePart, tasksPart].filter(Boolean);

  return {
    app: 'family-hub',
    format: WIDGET_FORMAT,
    updatedAt: now,
    today,
    sections: { deadlines: secDeadlines, tasks: secTasks },
    deadline: nearest
      ? {
          title: String(nearest.entity.title ?? '').trim(),
          date: nearest.entity.dueDate,
          days: nearest.days,
          human: humanDays(nearest.days),
        }
      : null,
    task: nearestTask
      ? {
          title: String(nearestTask.entity.title ?? '').trim(),
          date: nearestTask.entity.dueDate,
          days: nearestTask.days,
          human: humanDays(nearestTask.days),
        }
      : null,
    openTasks,
    todayTasks,
    overdueTasks,
    within7,
    overdueDeadlines,
    /** Готовая строка для виджета: «ТО автомобиля — через 41 день · дел: 5». */
    line: parts.join(' · '),
    /** Совсем коротко — для тесного виджета. */
    short: deadlinePart ?? (secTasks ? `дел: ${openTasks}` : ''),
  };
}
