/**
 * Резервный канал «Календарь телефона»: .ics должен быть валидным по RFC 5545
 * и нести будильник на каждую ступень напоминания.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { beforeEach, vi } from 'vitest';
import {
  alarmTrigger,
  buildCalendarAlarmTest,
  buildDeadlinesIcs,
  buildSingleDeadlineIcs,
  calendarAddTarget,
  calendarTestDeadline,
  downloadIcs,
  downloadSingleDeadlineIcs,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  isIosClient,
  openSingleDeadlineIcs,
} from '../src/notifications/ics';
import { db } from '../src/data/db';
import type { Deadline } from '../src/domain/types';

function dl(patch: Partial<Deadline> = {}): Deadline {
  return {
    id: 'dl-1',
    rev: 1,
    kind: 'deadlines',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'dev-1',
    deletedAt: null,
    title: 'ТО автомобиля',
    deadlineKind: 'vehicle',
    dueDate: '2026-11-15',
    remindersDays: [30, 7, 0],
    recurrence: { type: 'none' },
    lastCompletedAt: null,
    history: [],
    visibility: 'family',
    note: null,
    ...patch,
  };
}

describe('buildDeadlinesIcs', () => {
  it('обычное событие 09:00–09:15 (Москва), часовой пояс и каждая ступень', () => {
    const ics = buildDeadlinesIcs([dl()], { now: new Date('2026-10-02T10:00:00Z') });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;TZID=Europe/Moscow:20261115T090000');
    expect(ics).toContain('DTEND;TZID=Europe/Moscow:20261115T091500');
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('TZOFFSETTO:+0300');
    expect(ics).toContain('SUMMARY:[Срок] ТО автомобиля');
    expect(ics.match(/BEGIN:VALARM/gu)?.length).toBe(3);
    expect(ics).toContain('TRIGGER:-P30D');
    expect(ics).toContain('TRIGGER:-P7D');
    expect(ics).toContain('TRIGGER:PT0S');
    // RFC 5545: строки разделяются CRLF
    expect(ics).toContain('\r\n');
  });
  it('приватные и удалённые сроки не выгружаются', () => {
    const ics = buildDeadlinesIcs([
      dl({ visibility: 'private' }),
      dl({ id: 'x', deletedAt: '2026-10-01T00:00:00Z' }),
    ]);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
  it('без ступеней — хотя бы один будильник в день срока', () => {
    const ics = buildDeadlinesIcs([dl({ remindersDays: [] })]);
    expect(ics.match(/BEGIN:VALARM/gu)?.length).toBe(1);
    expect(ics).toContain('TRIGGER:PT0S');
  });
});

describe('escapeIcsText', () => {
  it('запятая, точка с запятой и перевод строки экранируются', () => {
    expect(escapeIcsText('Молоко, хлеб; вода\nсок')).toBe('Молоко\\, хлеб\\; вода\\nсок');
  });
});

describe('alarmTrigger', () => {
  it('0 = 09:00 в день срока, N = 09:00 за N дней', () => {
    expect(alarmTrigger(0)).toBe('TRIGGER:PT0S');
    expect(alarmTrigger(365)).toBe('TRIGGER:-P365D');
  });
});

describe('совместимость ICS', () => {
  it('сворачивает длинные русские строки по UTF-8, не ломая emoji', () => {
    const title = 'Очень длинный учебный срок 🏡 '.repeat(12);
    const ics = buildDeadlinesIcs([dl({ title })]);
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n[ \t]/gu, '');
    expect(unfolded).toContain(`SUMMARY:[Срок] ${title}`);
    expect(unfolded).not.toContain('�');
    expect(foldIcsLine('a'.repeat(76))).toBe(`${'a'.repeat(75)}\r\n a`);
  });

  it('одиночный CR не превращает название в новое свойство календаря', () => {
    expect(escapeIcsText('Учебный\rBEGIN:VEVENT')).toBe('Учебный\\nBEGIN:VEVENT');
  });

  it('невалидные даты не экспортируются, ступени ограничены и без дублей', () => {
    const ics = buildDeadlinesIcs([
      dl({ dueDate: '2026-02-30' }),
      dl({ id: 'valid', remindersDays: [30, 30, -1, 1.5, 3651, 0] }),
    ]);
    expect(ics.match(/BEGIN:VEVENT/gu)?.length).toBe(1);
    expect(ics.match(/BEGIN:VALARM/gu)?.length).toBe(2);
    expect(ics).not.toContain('-P3651');
  });

  it('проверочный файл — вымышленное событие завтра по Москве, не срок семьи', () => {
    const example = calendarTestDeadline(new Date('2026-10-02T22:00:00Z'));
    expect(example.dueDate).toBe('2026-10-04');
    expect(example.title).toBe('Family Hub: проверка календаря');
    expect(buildDeadlinesIcs([example]).match(/BEGIN:VEVENT/gu)?.length).toBe(1);
  });
});

it('быстрая проверка native alarm: одна UTC-встреча, 1 минута до начала, без ожидания суток', () => {
  const now = new Date('2026-10-03T20:59:30Z');
  const result = buildCalendarAlarmTest(now);
  expect(result.alarmAt.toISOString()).toBe('2026-10-03T21:05:00.000Z');
  expect(result.eventAt.toISOString()).toBe('2026-10-03T21:06:00.000Z');
  expect(result.content).toContain('DTSTART:20261003T210600Z');
  expect(result.content).toContain('TRIGGER:-PT1M');
  expect(result.content.match(/BEGIN:VEVENT/gu)?.length).toBe(1);
  expect(result.eventAt.getTime() - result.alarmAt.getTime()).toBe(60000);
  for (const line of result.content.split('\r\n'))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
});

describe('календарь: одно событие и окно создания записи (решение владельца 03.10)', () => {
  const createObjectURL = vi.fn(() => 'blob:test-calendar');
  let restoreUrl = () => undefined;

  beforeEach(async () => {
    await db.kv.clear();
    createObjectURL.mockClear();
    // Подменяем только методы Blob-URL: сам URL остаётся рабочим для new URL.
    const holder = globalThis.URL as unknown as Record<string, unknown>;
    const prev = { create: holder.createObjectURL, revoke: holder.revokeObjectURL };
    holder.createObjectURL = createObjectURL;
    holder.revokeObjectURL = vi.fn();
    restoreUrl = () => {
      holder.createObjectURL = prev.create;
      holder.revokeObjectURL = prev.revoke;
    };
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreUrl();
    vi.restoreAllMocks();
  });

  it('файл одного срока содержит ровно одно событие и все его будильники', () => {
    const ics = buildSingleDeadlineIcs(dl({ remindersDays: [30, 0] }));
    expect(ics.match(/BEGIN:VEVENT/gu)?.length).toBe(1);
    expect(ics.match(/BEGIN:VALARM/gu)?.length).toBe(2);
    expect(ics).toContain('TRIGGER:-P30D');
    expect(ics).toContain('TRIGGER:PT0S');
  });

  it('UID одиночного события совпадает с UID полной выгрузки', () => {
    const single = buildSingleDeadlineIcs(dl());
    const full = buildDeadlinesIcs([dl(), dl({ id: 'dl-2', title: 'Второй' })]);
    const uidOf = (ics: string) => ics.match(/UID:[^\r\n]+/u)?.[0];
    expect(uidOf(single)).toBe(uidOf(full));
    expect(full.match(/BEGIN:VEVENT/gu)?.length).toBe(2);
  });

  it('ссылка окна создания несёт название, дату и время 09:00–09:15 по Москве', () => {
    const url = new URL(googleCalendarUrl(dl({ title: 'Страховка, ТО' })));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('[Срок] Страховка, ТО');
    expect(url.searchParams.get('dates')).toBe('20261115T090000/20261115T091500');
    expect(url.searchParams.get('ctz')).toBe('Europe/Moscow');
  });

  it('выгрузка файлом берёт все семейные сроки, удалённые и приватные — нет', async () => {
    const result = await downloadIcs([
      dl({ id: 'a' }),
      dl({ id: 'b', dueDate: '2026-12-01' }),
      dl({ id: 'gone', deletedAt: '2026-10-01T00:00:00.000Z' }),
      dl({ id: 'private', visibility: 'private' }),
    ]);
    expect(result).toMatchObject({
      eventCount: 2,
      firstDate: '2026-11-15',
      lastDate: '2026-12-01',
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('одиночный файл скачивается отдельно и не трогает остальные сроки', async () => {
    const date = await downloadSingleDeadlineIcs(dl({ id: 'a' }));
    expect(date).toBe('2026-11-15');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('на iPhone файл открывается сразу в новой вкладке — системное окно Календаря', () => {
    const open = vi.fn((_url?: string | URL) => ({}) as Window);
    vi.stubGlobal('open', open);
    const opened = openSingleDeadlineIcs(dl({ id: 'a' }));
    expect(opened).toBe(true);
    // Переход делается синхронно, из действия человека: иначе Safari не покажет окно.
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0]?.[0])).toBe('blob:test-calendar');
    vi.unstubAllGlobals();
  });

  it('если браузер заблокировал вкладку, честно возвращаем false и ссылку не держим', () => {
    const open = vi.fn((_url?: string | URL) => null);
    vi.stubGlobal('open', open);
    expect(openSingleDeadlineIcs(dl({ id: 'a' }))).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('календарь на Android: попытка приложения и веб-запасной путь (0.4.5)', () => {
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  it('на Android собирается intent-ссылка на приложение Google Календаря с веб-запасным путём', () => {
    const target = calendarAddTarget(dl({ title: 'Страховка' }), ANDROID);
    expect(target.kind).toBe('app');
    expect(target.url.startsWith('intent://calendar.google.com/calendar/render?')).toBe(true);
    expect(target.url).toContain('#Intent;scheme=https;');
    expect(target.url).toContain('package=com.google.android.calendar;');
    expect(target.url.endsWith(';end')).toBe(true);

    // Запасной адрес — та же веб-форма, закодированная целиком (браузер откроет её,
    // если приложение не отзовётся). Внутри не должно остаться сырых «;» и «#».
    const fallback = target.url.match(/S\.browser_fallback_url=([^;]+);end$/u)?.[1] ?? '';
    expect(fallback).not.toContain('#');
    const web = new URL(decodeURIComponent(fallback));
    expect(web.origin + web.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(web.searchParams.get('action')).toBe('TEMPLATE');
    expect(web.searchParams.get('dates')).toBe('20261115T090000/20261115T091500');
  });

  it('Android-браузер без поддержки intent получает обычную веб-форму', () => {
    const firefoxAndroid = 'Mozilla/5.0 (Android 10; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0';
    expect(calendarAddTarget(dl(), firefoxAndroid).kind).toBe('web');
  });

  it('на компьютере остаётся обычная веб-форма', () => {
    expect(calendarAddTarget(dl(), 'Mozilla/5.0 (X11; Linux x86_64) Chrome/154.0.0.0')).toEqual({
      url: googleCalendarUrl(dl()),
      kind: 'web',
    });
  });

  it('на iPhone ничего не открываем автоматически: окно экрана ведёт к файлу', () => {
    // iOS не принимает событие ссылкой: Календарь Apple открывается только файлом .ics
    // или подпиской. Поэтому ссылка на Google остаётся в окне как второй способ.
    expect(calendarAddTarget(dl(), IPHONE)).toEqual({ url: googleCalendarUrl(dl()), kind: 'none' });
    expect(isIosClient(IPHONE)).toBe(true);
  });

  it('iPadOS 13+ (маскируется под Mac) тоже считается iPhone-путём', () => {
    const ipadDesktopMode =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(isIosClient(ipadDesktopMode)).toBe(true);
    expect(calendarAddTarget(dl(), ipadDesktopMode).kind).toBe('none');
  });

  it('настоящий macOS и Android не попадают в iPhone-путь', () => {
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    expect(isIosClient(mac)).toBe(false);
    expect(isIosClient(ANDROID)).toBe(false);
    expect(calendarAddTarget(dl(), mac).kind).toBe('web');
  });

  it('событие с датой и временем берётся из формы, запись срока для ссылки не нужна', () => {
    const target = calendarAddTarget({ title: 'Из формы', dueDate: '2027-03-09' }, ANDROID);
    const data = target.url.slice('intent://'.length).split('#Intent;')[0] ?? '';
    const parsed = new URL(`https://${data}`);
    expect(parsed.searchParams.get('text')).toBe('[Срок] Из формы');
    expect(parsed.searchParams.get('dates')).toBe('20270309T090000/20270309T091500');
  });
});
