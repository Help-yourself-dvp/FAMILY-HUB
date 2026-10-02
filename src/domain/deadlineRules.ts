/**
 * Цветовые правила сроков (идея владельца 2026-10-01, реализация с уточнением).
 *
 * Правила привязаны к ТИПУ срока, а не к списку названий: справочник названий
 * пришлось бы вечно поддерживать, а тип выбирается один раз при создании.
 * Любой срок можно переопределить вручную (свои пороги в форме).
 *
 *   документ (паспорт)  → красный за 90, жёлтый за 365 (замена начинается заранее)
 *   машина/ТО           → красный за 14, жёлтый за 30
 *   дом и ЖКХ           → красный за 7,  жёлтый за 21
 *   страховка           → красный за 14, жёлтый за 30
 *   подписка/сервис     → красный за 3,  жёлтый за 7
 *   день рождения       → красный за 3,  жёлтый за 14
 *   прочее              → красный за 7,  жёлтый за 30
 */
import { daysUntil, today, type DateOnly } from './dateOnly';
import type { Deadline, DeadlineKind } from './types';

export interface DeadlineThresholds {
  /** Дней до даты, начиная с которых срок красный. */
  alertDays: number;
  /** Дней до даты, начиная с которых срок жёлтый. */
  warnDays: number;
}

export const KIND_THRESHOLDS: Record<DeadlineKind, DeadlineThresholds> = {
  document: { alertDays: 90, warnDays: 365 },
  vehicle: { alertDays: 14, warnDays: 30 },
  home: { alertDays: 7, warnDays: 21 },
  insurance: { alertDays: 14, warnDays: 30 },
  service: { alertDays: 3, warnDays: 7 },
  birthday: { alertDays: 3, warnDays: 14 },
  custom: { alertDays: 7, warnDays: 30 },
};

export type DeadlineTone = 'overdue' | 'alert' | 'warn' | 'ok';

export function thresholdsFor(
  d: Pick<Deadline, 'deadlineKind' | 'alertDays' | 'warnDays'>,
): DeadlineThresholds {
  const preset = KIND_THRESHOLDS[d.deadlineKind] ?? KIND_THRESHOLDS.custom;
  return {
    alertDays: typeof d.alertDays === 'number' && d.alertDays >= 0 ? d.alertDays : preset.alertDays,
    warnDays: typeof d.warnDays === 'number' && d.warnDays >= 0 ? d.warnDays : preset.warnDays,
  };
}

/** Чистое правило тона (покрыто тестом). */
export function deadlineTone(d: Deadline, from: DateOnly = today()): DeadlineTone {
  const left = daysUntil(d.dueDate, from);
  const t = thresholdsFor(d);
  if (left < 0) return 'overdue';
  if (left <= t.alertDays) return 'alert';
  if (left <= t.warnDays) return 'warn';
  return 'ok';
}

export const TONE_COLOR: Record<DeadlineTone, string> = {
  overdue: 'var(--err)',
  alert: 'var(--err)',
  warn: 'var(--warn)',
  ok: 'var(--ok)',
};
