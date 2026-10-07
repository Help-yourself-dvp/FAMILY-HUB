/**
 * Формулировки состояния синхронизации (просьба владельца 07.10.2026: простыми словами,
 * без терминов): «Все изменения сохранены», «Отправляем: N», «Нет подключения»,
 * «Хранилище не подключено». Чистая функция — без DOM.
 */
import { describe, expect, it } from 'vitest';
import { phaseLabel, pillLabel } from '../src/data/sync/state';

describe('phaseLabel', () => {
  it('без очереди — короткие фразы', () => {
    expect(phaseLabel('synced')).toBe('Все изменения сохранены');
    expect(phaseLabel('syncing')).toBe('Отправляем…');
    expect(phaseLabel('offline')).toBe('Нет подключения');
    expect(phaseLabel('error')).toBe('Не удалось отправить');
    expect(phaseLabel('idle')).toBe('Ждём отправки');
    expect(phaseLabel('not-configured')).toBe('Хранилище не подключено');
  });

  it('с очередью показывает число', () => {
    expect(phaseLabel('syncing', 3)).toBe('Отправляем: 3');
    expect(phaseLabel('idle', 2)).toBe('Ждём отправки: 2');
  });

  it('нет терминов вроде «офлайн» и «локальный режим»', () => {
    for (const phase of [
      'idle',
      'offline',
      'syncing',
      'synced',
      'error',
      'not-configured',
    ] as const) {
      const label = phaseLabel(phase, 1).toLowerCase();
      expect(label).not.toContain('офлайн');
      expect(label).not.toContain('локальный');
      expect(label).not.toContain('синхронизац');
    }
  });
});

describe('pillLabel — подпись плашки в верхней строке', () => {
  it('короткая: влезает рядом с названием раздела', () => {
    expect(pillLabel('synced')).toBe('Сохранено');
    expect(pillLabel('offline')).toBe('Нет сети');
    expect(pillLabel('error')).toBe('Ошибка');
    expect(pillLabel('not-configured')).toBe('Не подключено');
  });

  it('с очередью показывает число', () => {
    expect(pillLabel('syncing', 3)).toBe('Отправляем: 3');
    expect(pillLabel('idle', 4)).toBe('Ждём: 4');
  });

  it('длинной фразы «Все изменения сохранены» в плашке больше нет', () => {
    for (const phase of [
      'idle',
      'offline',
      'syncing',
      'synced',
      'error',
      'not-configured',
    ] as const) {
      expect(pillLabel(phase).length).toBeLessThanOrEqual(17);
    }
  });
});
