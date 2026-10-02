/**
 * Резервный канал «Календарь телефона»: .ics должен быть валидным по RFC 5545
 * и нести будильник на каждую ступень напоминания.
 */
import { describe, expect, it } from 'vitest';
import {
  alarmTrigger,
  buildDeadlinesIcs,
  calendarTestDeadline,
  escapeIcsText,
  foldIcsLine,
} from '../src/notifications/ics';
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
