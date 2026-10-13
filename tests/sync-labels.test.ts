/**
 * Формулировки состояния синхронизации (просьба владельца 07.10.2026: простыми словами,
 * без терминов): «Все изменения сохранены», «Синхронизация…», «Нет подключения»,
 * «Хранилище не подключено». Чистая функция — без DOM.
 */
import { describe, expect, it } from 'vitest';
import { phaseLabel, pillLabel, statusLine } from '../src/data/sync/state';

describe('phaseLabel', () => {
  it('без очереди — короткие фразы', () => {
    expect(phaseLabel('synced')).toBe('Все изменения сохранены');
    expect(phaseLabel('syncing')).toBe('Синхронизация…');
    expect(phaseLabel('offline')).toBe('Нет подключения');
    expect(phaseLabel('error')).toBe('Не удалось отправить');
    expect(phaseLabel('idle')).toBe('Ждём отправки');
    expect(phaseLabel('not-configured')).toBe('Хранилище не подключено');
  });

  it('с очередью показывает число', () => {
    expect(phaseLabel('syncing', 3)).toBe('Синхронизация…');
    expect(phaseLabel('idle', 2)).toBe('Ждём отправки: 2');
  });

  it('нет терминов вроде «офлайн» и «локальный режим»', () => {
    for (const phase of ['idle', 'offline', 'synced', 'error', 'not-configured'] as const) {
      const label = phaseLabel(phase, 1).toLowerCase();
      expect(label).not.toContain('офлайн');
      expect(label).not.toContain('локальный');
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

  it('во время работы — слово «Синхронизация», а не «Отправляем»', () => {
    expect(pillLabel('syncing', 3)).toBe('Синхронизация…');
    expect(pillLabel('syncing')).toBe('Синхронизация…');
  });

  it('с очередью в покое показывает число', () => {
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

describe('statusLine — подвал Главной', () => {
  it('во время работы не повторяет слово «синхронизация»', () => {
    expect(statusLine('syncing', 2)).toBe('Синхронизация…');
  });

  it('в остальных состояниях добавляет поясняющий префикс', () => {
    expect(statusLine('synced')).toBe('Синхронизация: Все изменения сохранены');
    expect(statusLine('offline')).toBe('Синхронизация: Нет подключения');
    expect(statusLine('idle', 3)).toBe('Синхронизация: Ждём отправки: 3');
    expect(statusLine('not-configured')).toBe('Синхронизация: Хранилище не подключено');
  });
});
