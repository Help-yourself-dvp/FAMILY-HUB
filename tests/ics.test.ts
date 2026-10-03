/**
 * Резервный канал «Календарь телефона»: .ics должен быть валидным по RFC 5545
 * и нести будильник на каждую ступень напоминания.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { beforeEach, vi } from 'vitest';
import {
  alarmTrigger,
  buildDeadlinesIcs,
  buildCalendarAlarmTest,
  buildSingleDeadlineIcs,
  calendarTestDeadline,
  calendarUpdateSummary,
  downloadCalendarUpdate,
  downloadSingleDeadlineIcs,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  pendingForCalendar,
  readCalendarExportMarks,
  resetCalendarExportMarks,
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

describe('одиночное событие и выгрузка «только новое» (приёмка 03.10)', () => {
  const createObjectURL = vi.fn(() => 'blob:test-calendar');
  let restoreUrl = () => undefined;

  beforeEach(async () => {
    await db.kv.clear();
    createObjectURL.mockClear();
    // Подменяем только методы Blob-URL, сам URL остаётся рабочим: тест разбирает
    // ссылку Google Календаря через new URL.
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

  it('ссылка Google Календаря несёт одно событие 09:00–09:15 по Москве', () => {
    const url = new URL(googleCalendarUrl(dl({ title: 'Страховка, ТО' })));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('[Срок] Страховка, ТО');
    expect(url.searchParams.get('dates')).toBe('20261115T090000/20261115T091500');
    expect(url.searchParams.get('ctz')).toBe('Europe/Moscow');
  });

  it('выгружаются только новые и изменённые сроки', () => {
    const a = dl({ id: 'a', rev: 1 });
    const b = dl({ id: 'b', rev: 1 });
    expect(pendingForCalendar([a, b], {}).map((d) => d.id)).toEqual(['a', 'b']);
    const marks = { a: { rev: 1, dueDate: a.dueDate }, b: { rev: 1, dueDate: b.dueDate } };
    expect(pendingForCalendar([a, b], marks)).toEqual([]);
    // Изменили ревизию или дату — срок снова попадает в файл.
    expect(pendingForCalendar([{ ...a, rev: 2 }, b], marks).map((d) => d.id)).toEqual(['a']);
    expect(
      pendingForCalendar([{ ...a, dueDate: '2026-12-01' }, b], marks).map((d) => d.id),
    ).toEqual(['a']);
    // Удалённые и приватные не выгружаются никогда.
    expect(pendingForCalendar([{ ...a, deletedAt: '2026-10-01T00:00:00.000Z' }], marks)).toEqual(
      [],
    );
  });

  it('скачивание «только новое» ставит отметки, второй раз файл пуст, сброс возвращает', async () => {
    const first = await downloadCalendarUpdate([dl({ id: 'a' })]);
    expect(first).toMatchObject({ eventCount: 1, freshCount: 1, changedCount: 0, totalCount: 1 });
    expect(await readCalendarExportMarks()).toHaveProperty('a');

    const again = await downloadCalendarUpdate([dl({ id: 'a' })]);
    expect(again.eventCount).toBe(0);
    expect(calendarUpdateSummary(again)).toMatch(/Новых событий нет/u);

    await resetCalendarExportMarks();
    expect(await readCalendarExportMarks()).toEqual({});
    expect((await downloadCalendarUpdate([dl({ id: 'a' })])).eventCount).toBe(1);
  });

  it('изменённый срок помечается как «изменённый», полная выгрузка берёт все', async () => {
    await downloadCalendarUpdate([dl({ id: 'a', rev: 1 })]);
    const changed = await downloadCalendarUpdate([dl({ id: 'a', rev: 2 })]);
    expect(changed).toMatchObject({ eventCount: 1, freshCount: 0, changedCount: 1 });
    expect(calendarUpdateSummary(changed)).toMatch(/удалите её/u);

    await downloadCalendarUpdate([dl({ id: 'a', rev: 2 })]);
    const full = await downloadCalendarUpdate([dl({ id: 'a', rev: 2 })], true);
    expect(full).toMatchObject({ eventCount: 1, freshCount: 0, changedCount: 1 });
  });

  it('одиночная выгрузка отмечает только свой срок', async () => {
    await downloadSingleDeadlineIcs(dl({ id: 'a' }));
    const marks = await readCalendarExportMarks();
    expect(Object.keys(marks)).toEqual(['a']);
    expect((await downloadCalendarUpdate([dl({ id: 'a' }), dl({ id: 'b' })])).eventCount).toBe(1);
  });
});
