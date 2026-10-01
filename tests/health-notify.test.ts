/**
 * Политика уведомлений здоровья (решение владельца 2026-10-01): уведомляем только
 * об ошибках, требующих действия; потеря сети и таймауты молчат.
 */
import { describe, expect, it } from 'vitest';
import { shouldNotifyHealth } from '../src/notifications/healthWatch';

describe('shouldNotifyHealth', () => {
  it('требующие действия коды уведомляются', () => {
    for (const code of ['unauthorized', 'forbidden', 'not-found', 'validation']) {
      expect(shouldNotifyHealth(code)).toBe(true);
    }
  });
  it('преходящие сбои сети молчат', () => {
    for (const code of ['network', 'timeout', 'conflict', 'rate-limit', 'secondary-limit']) {
      expect(shouldNotifyHealth(code)).toBe(false);
    }
  });
});
