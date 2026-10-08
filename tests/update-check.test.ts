/**
 * Обновление приложения (вопрос владельца 07.10.2026: «кнопка обновления всё ещё есть?»).
 *
 * Плашка «Доступна новая версия» показывалась только если обновление нашлось во время
 * открытой сессии. Если обновление уже скачано и ждёт (`reg.waiting`), плашки не было —
 * и человек не видел ни обновления, ни кнопки. Правило вынесено в чистую функцию.
 */
import { describe, expect, it } from 'vitest';
import { updateAvailableFrom } from '../src/app/bootstrap';

describe('updateAvailableFrom', () => {
  it('обновление ждёт своей очереди — показываем плашку', () => {
    expect(updateAvailableFrom({ waiting: {} }, true)).toBe(true);
  });

  it('обновление ставится прямо сейчас — тоже показываем', () => {
    expect(updateAvailableFrom({ installing: {} }, true)).toBe(true);
  });

  it('ничего не ждёт — плашки нет', () => {
    expect(updateAvailableFrom({ waiting: null, installing: null }, true)).toBe(false);
  });

  it('самая первая установка (страницы ещё не управляет SW) — плашки нет', () => {
    expect(updateAvailableFrom({ waiting: {}, installing: null }, false)).toBe(false);
  });
});
