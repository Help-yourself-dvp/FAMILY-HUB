/**
 * Резервный канал «Календарь телефона»: .ics должен быть валидным по RFC 5545
 * и нести будильник на каждую ступень напоминания.
 */
import { describe, expect, it } from 'vitest';
import { alarmTrigger, buildDeadlinesIcs, escapeIcsText } from '../src/notifications/ics';
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
  it('событие на весь день + будильник на каждую ступень', () => {
    const ics = buildDeadlinesIcs([dl()], { now: new Date('2026-10-02T10:00:00Z') });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261115');
    expect(ics).toContain('SUMMARY:[Срок] ТО автомобиля');
    expect(ics.match(/BEGIN:VALARM/gu)?.length).toBe(3);
    expect(ics).toContain('TRIGGER:-P30DT15H');
    expect(ics).toContain('TRIGGER:-P7DT15H');
    expect(ics).toContain('TRIGGER:PT9H');
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
    expect(ics).toContain('TRIGGER:PT9H');
  });
});

describe('escapeIcsText', () => {
  it('запятая, точка с запятой и перевод строки экранируются', () => {
    expect(escapeIcsText('Молоко, хлеб; вода\nсок')).toBe('Молоко\\, хлеб\\; вода\\nсок');
  });
});

describe('alarmTrigger', () => {
  it('0 = 09:00 в день срока, N = 09:00 за N дней', () => {
    expect(alarmTrigger(0)).toBe('TRIGGER:PT9H');
    expect(alarmTrigger(365)).toBe('TRIGGER:-P365DT15H');
  });
});
