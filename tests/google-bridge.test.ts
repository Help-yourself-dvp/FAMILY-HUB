/**
 * «Мост» Family Hub → Google Календарь (scripts/google-bridge/Code.gs) — проверки на
 * вымышленных данных. Скрипт выполняется в Google Apps Script, поэтому здесь он
 * загружается как текст (`?raw`) и запускается в песочнице с заглушками Google API:
 * сети нет, семейные данные не читаются.
 *
 * Стережём обещания, которые даны владельцу:
 *  - события из ленты появляются в Google-календаре с нашими будильниками;
 *  - ступени длиннее 4 недель переносятся без будильника (предел Google), событие остаётся;
 *  - повторный запуск ничего не переписывает (телефон не дёргается зря);
 *  - правка и удаление в Family Hub отражаются в Google;
 *  - недоступная лента НИЧЕГО не удаляет — ни когда файл не скачался, ни когда не удалось
 *    получить список файлов;
 *  - в журнал не попадают названия семейных событий (только счётчики).
 */
import { describe, expect, it } from 'vitest';
import code from '../scripts/google-bridge/Code.gs?raw';

/* ---------------------------------- заглушки Google API ---------------------------------- */

class FakeEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  description = '';
  reminders: number[] = [];
  removed = false;

  constructor(id: string, title: string, start: Date, end: Date) {
    this.id = id;
    this.title = title;
    this.start = start;
    this.end = end;
  }

  getId() {
    return this.id;
  }
  getTitle() {
    return this.title;
  }
  setTitle(title: string) {
    this.title = title;
  }
  getStartTime() {
    return this.start;
  }
  getEndTime() {
    return this.end;
  }
  setTime(start: Date, end: Date) {
    this.start = start;
    this.end = end;
  }
  setDescription(description: string) {
    this.description = description;
  }
  getDescription() {
    return this.description;
  }
  getPopupReminders() {
    return [...this.reminders];
  }
  removeAllReminders() {
    this.reminders = [];
  }
  addPopupReminder(minutes: number) {
    this.reminders.push(minutes);
  }
  deleteEvent() {
    this.removed = true;
  }
}

/** Календарь живёт между запусками — как настоящий календарь владельца. */
class FakeCalendar {
  name: string;
  events = new Map<string, FakeEvent>();
  private seq = 0;

  constructor(name: string) {
    this.name = name;
  }

  private put(title: string, start: Date, end: Date): FakeEvent {
    this.seq += 1;
    const event = new FakeEvent(`ev-${this.seq}`, title, start, end);
    this.events.set(event.id, event);
    return event;
  }

  createEvent(title: string, start: Date, end: Date) {
    return this.put(title, start, end);
  }
  createAllDayEvent(title: string, start: Date, end: Date | null) {
    return this.put(title, start, end ?? start);
  }
  getEventById(id: string) {
    const event = this.events.get(id);
    return event && !event.removed ? event : null;
  }
  live() {
    return [...this.events.values()].filter((event) => !event.removed);
  }
}

function parseDateMock(value: string, tz: string, pattern: string): Date {
  const digits = value.replace(/\D/gu, '');
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6)) - 1;
  const day = Number(digits.slice(6, 8));
  if (pattern === 'yyyyMMdd') return new Date(Date.UTC(year, month, day));
  // Время идёт сразу после даты: 20261118T090000 → 2026 11 18 09 00 00.
  const hour = Number(digits.slice(8, 10));
  const minute = Number(digits.slice(10, 12));
  const second = Number(digits.slice(12, 14));
  const utc = Date.UTC(year, month, day, hour, minute, second);
  if (pattern.endsWith("'Z'")) return new Date(utc);
  const offset = /GMT\+(\d{2}):(\d{2})/u.exec(tz) ?? (/Moscow/u.test(tz) ? ['', '03', '00'] : null);
  const offsetMinutes = offset ? Number(offset[1]) * 60 + Number(offset[2]) : 0;
  return new Date(utc - offsetMinutes * 60_000);
}

interface SandboxOptions {
  /** Что отдаёт сеть: адрес → текст (или Error, чтобы проверить недоступность). */
  respond: (url: string) => string | Error;
  /** Общее хранилище настроек: переживает между запусками, как настоящие Script Properties. */
  properties?: Map<string, string>;
  /** Календарь владельца: переживает между запусками. */
  calendar?: FakeCalendar;
  logs?: string[];
}

function loadBridge({ respond, properties = new Map(), calendar = new FakeCalendar('Family Hub'), logs = [] }: SandboxOptions) {
  const CalendarApp = {
    getDefaultCalendar: () => calendar,
    getCalendarsByName: (name: string) => (name === calendar.name ? [calendar] : []),
    createCalendar: (name: string) => new FakeCalendar(name),
  };
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      setProperty: (key: string, value: string) => properties.set(key, value),
    }),
  };
  const UrlFetchApp = {
    fetch: (url: string) => {
      const result = respond(url);
      if (result instanceof Error) throw result;
      return { getContentText: () => result, getResponseCode: () => 200 };
    },
  };
  const Utilities = { parseDate: parseDateMock };
  const Session = { getScriptTimeZone: () => 'Europe/Moscow' };
  const Logger = { log: (message: string) => logs.push(String(message)) };
  const ScriptApp = {
    newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => ({ getUniqueId: () => 't1' }) }) }) }),
  };

  // В тесте исполняем текст Apps Script как есть: у Google-скрипта нет импортов, а подменять
  // приходится сам Google API. Заглушки — только здесь; в приложение eval не попадает
  // (тот же приём, что в tests/notification-delivery.test.ts для service worker).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Только тест: наш Code.gs ?raw, Google API заменён заглушками.
  const build = new Function(
    'CalendarApp',
    'PropertiesService',
    'UrlFetchApp',
    'Utilities',
    'Session',
    'Logger',
    'ScriptApp',
    `${code}\nreturn { syncFamilyHub, installTrigger };`,
  ) as (
    calendarApp: unknown,
    propertiesService: unknown,
    urlFetchApp: unknown,
    utilities: unknown,
    session: unknown,
    logger: unknown,
    scriptApp: unknown,
  ) => { syncFamilyHub: () => string; installTrigger: () => void };
  const api = build(CalendarApp, PropertiesService, UrlFetchApp, Utilities, Session, Logger, ScriptApp);
  return { ...api, calendar, properties, logs };
}

/* ---------------------------------- вымышленная лента ---------------------------------- */

function vevent({
  uid,
  summary,
  start = '20261118T090000',
  end = '20261118T091500',
  alarms = [],
}: {
  uid: string;
  summary: string;
  start?: string;
  end?: string;
  alarms?: string[];
}): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20261006T060000Z',
    `DTSTART;TZID=Europe/Moscow:${start}`,
    `DTEND;TZID=Europe/Moscow:${end}`,
    'SEQUENCE:1',
    'SUMMARY:' + summary,
    'DESCRIPTION:Создано в приложении Family Hub.',
  ];
  for (const trigger of alarms) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Family Hub', `TRIGGER:${trigger}`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function calendar(events: string[], name = 'Family Hub — сроки'): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Hub//Feed//RU',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${name}`,
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Moscow',
    'END:VTIMEZONE',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Сеть «как в жизни»: список файлов ветки и файл ленты. */
function network(ics: string, files = ['aaa.ics']) {
  return (url: string): string => {
    if (url.includes('api.github.com')) {
      return JSON.stringify(
        files.map((name) => ({
          name,
          download_url: `https://raw.githubusercontent.com/Help-yourself-dvp/FAMILY-HUB/feed/${name}`,
        })),
      );
    }
    return ics;
  };
}

/* ---------------------------------- проверки ---------------------------------- */

describe('мост Family Hub → Google Календарь', () => {
  it('создаёт события из ленты и переносит будильники в пределах 4 недель', () => {
    const ics = calendar([
      vevent({ uid: 'deadline-1@family-hub.local', summary: 'Документ', alarms: ['-P20D', '-P7D', 'PT0S'] }),
      vevent({
        uid: 'deadline-2@family-hub.local',
        summary: 'Машина',
        start: '20261201T090000',
        end: '20261201T091500',
        alarms: ['PT0S'],
      }),
    ]);
    const bridge = loadBridge({ respond: network(ics) });
    const summary = bridge.syncFamilyHub();

    const events = bridge.calendar.live();
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.title).sort()).toEqual(['Документ', 'Машина']);
    // 20 дней = 28800 минут, 7 дней = 10080; событие идёт по московскому времени.
    expect(events[0]?.reminders).toEqual([0, 10080, 28800]);
    expect(events[0]?.start.toISOString()).toBe('2026-11-18T06:00:00.000Z');
    expect(events[0]?.end.toISOString()).toBe('2026-11-18T06:15:00.000Z');
    expect(summary).toContain('создано 2');
  });

  it('ступени длиннее 4 недель переносятся без будильника, событие остаётся', () => {
    const ics = calendar([
      vevent({
        uid: 'deadline-1@family-hub.local',
        summary: 'Паспорт',
        alarms: ['-P90D', '-P30D', '-P7D', 'PT0S'],
      }),
    ]);
    const bridge = loadBridge({ respond: network(ics) });
    const summary = bridge.syncFamilyHub();

    // Предел Google — 40320 минут (4 недели): 90 дней и 30 дней в него не входят.
    expect(bridge.calendar.live()[0]?.reminders).toEqual([0, 10080]);
    expect(summary).toContain('перенесено без звонка: 2');
  });

  it('повторный запуск ничего не перезаписывает', () => {
    const ics = calendar([vevent({ uid: 'deadline-1@family-hub.local', summary: 'Документ', alarms: ['PT0S'] })]);
    const properties = new Map<string, string>();
    const calendarMock = new FakeCalendar('Family Hub');

    loadBridge({ respond: network(ics), properties, calendar: calendarMock }).syncFamilyHub();
    const summary = loadBridge({ respond: network(ics), properties, calendar: calendarMock }).syncFamilyHub();

    expect(summary).toContain('создано 0');
    expect(summary).toContain('без изменений 1');
    expect(calendarMock.live()).toHaveLength(1);
  });

  it('правка и удаление в Family Hub отражаются: название меняется, лишнее уходит', () => {
    const properties = new Map<string, string>();
    const calendarMock = new FakeCalendar('Family Hub');

    loadBridge({
      respond: network(
        calendar([
          vevent({ uid: 'deadline-1@family-hub.local', summary: 'Старое название' }),
          vevent({
            uid: 'deadline-2@family-hub.local',
            summary: 'Удалено в приложении',
            start: '20261201T090000',
            end: '20261201T091500',
          }),
        ]),
      ),
      properties,
      calendar: calendarMock,
    }).syncFamilyHub();

    const summary = loadBridge({
      respond: network(
        calendar([
          vevent({ uid: 'deadline-1@family-hub.local', summary: 'Новое название' }),
          vevent({
            uid: 'deadline-3@family-hub.local',
            summary: 'Добавлено',
            start: '20261210T090000',
            end: '20261210T091500',
          }),
        ]),
      ),
      properties,
      calendar: calendarMock,
    }).syncFamilyHub();

    expect(calendarMock.live().map((event) => event.title).sort()).toEqual(['Добавлено', 'Новое название']);
    expect(summary).toContain('обновлено 1');
    expect(summary).toContain('создано 1');
    expect(summary).toContain('удалено 1');
  });

  it('недоступный файл ленты ничего не удаляет', () => {
    const properties = new Map<string, string>();
    const calendarMock = new FakeCalendar('Family Hub');
    const good = calendar([vevent({ uid: 'deadline-1@family-hub.local', summary: 'Документ' })]);

    loadBridge({ respond: network(good), properties, calendar: calendarMock }).syncFamilyHub();

    const summary = loadBridge({
      respond: (url) => (url.includes('api.github.com') ? network(good)(url) : new Error('network')),
      properties,
      calendar: calendarMock,
    }).syncFamilyHub();

    expect(summary).toContain('лент 1');
    expect(summary).toContain('не прочитано: 1');
    expect(summary).toContain('удалено 0');
    expect(calendarMock.live()).toHaveLength(1);
    expect(properties.get('family_hub_map_v1')).toContain('deadline-1@family-hub.local');
  });

  it('если список файлов ленты не получен — ничего не удаляем', () => {
    const properties = new Map<string, string>();
    const calendarMock = new FakeCalendar('Family Hub');
    const good = calendar([vevent({ uid: 'deadline-1@family-hub.local', summary: 'Документ' })]);

    loadBridge({ respond: network(good), properties, calendar: calendarMock }).syncFamilyHub();

    const summary = loadBridge({
      respond: () => new Error('network'),
      properties,
      calendar: calendarMock,
    }).syncFamilyHub();

    expect(summary).toContain('лент 0');
    expect(summary).toContain('удалено 0');
    expect(calendarMock.live()).toHaveLength(1);
  });

  it('находит файлы ленты сам, если ссылку в приложении сменили', () => {
    const respond = (url: string): string => {
      if (url.includes('api.github.com')) {
        return JSON.stringify([
          { name: 'new-slug-deadlines.ics', download_url: 'https://example.test/new-slug-deadlines.ics' },
          { name: 'new-slug-tasks.ics', download_url: 'https://example.test/new-slug-tasks.ics' },
        ]);
      }
      if (url.endsWith('new-slug-deadlines.ics')) {
        return calendar([vevent({ uid: 'deadline-9@family-hub.local', summary: 'Срок после смены ссылки' })]);
      }
      return calendar(
        [vevent({ uid: 'task-9@family-hub.local', summary: 'Дело после смены ссылки' })],
        'Family Hub — дела',
      );
    };
    const bridge = loadBridge({ respond });
    const summary = bridge.syncFamilyHub();
    expect(bridge.calendar.live().map((event) => event.title).sort()).toEqual([
      'Дело после смены ссылки',
      'Срок после смены ссылки',
    ]);
    expect(summary).toContain('создано 2');
  });

  it('в журнал не попадают названия семейных событий', () => {
    const logs: string[] = [];
    const bridge = loadBridge({
      respond: network(calendar([vevent({ uid: 'deadline-1@family-hub.local', summary: 'Секретное название' })])),
      logs,
    });
    bridge.syncFamilyHub();
    const text = logs.join('\n');
    expect(text).not.toContain('Секретное название');
    expect(text).toContain('создано 1');
  });

  it('событие без названия или без даты пропускается, а не ломает цикл', () => {
    const ics = calendar([
      vevent({ uid: 'deadline-1@family-hub.local', summary: '' }),
      'BEGIN:VEVENT\r\nUID:broken@family-hub.local\r\nSUMMARY:Без даты\r\nEND:VEVENT',
      vevent({
        uid: 'deadline-2@family-hub.local',
        summary: 'Нормальное',
        start: '20261201T090000',
        end: '20261201T091500',
      }),
    ]);
    const bridge = loadBridge({ respond: network(ics) });
    const summary = bridge.syncFamilyHub();
    expect(bridge.calendar.live().map((event) => event.title)).toEqual(['Нормальное']);
    expect(summary).toContain('создано 1');
    expect(summary).toContain('пропущено 2');
  });
});
