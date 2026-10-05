/**
 * Копирование текста: буфер → старый путь → ручное копирование.
 *
 * Владелец на iPhone получил «не удалось скопировать» на отчёте для разработчика,
 * то есть оба автоматических пути не сработали, а ручного не было вообще. Здесь
 * проверяем, что порядок соблюдается и что третий исход честно сообщается вызывающему
 * (по нему экран открывает текст для ручного копирования).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../src/shared/clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('пользуется буфером обмена, когда он есть', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('отчёт')).resolves.toBe('clipboard');
    expect(writeText).toHaveBeenCalledWith('отчёт');
  });

  it('если буфер отказал — пробует старый путь и сообщает об успехе', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    await expect(copyText('отчёт')).resolves.toBe('exec');
    expect(exec).toHaveBeenCalledWith('copy');
    // Скрытое поле убрано из документа — мусора не остаётся.
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('если и старый путь не сработал — честно просит скопировать вручную', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('x')) },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });
    await expect(copyText('отчёт')).resolves.toBe('manual');
  });

  it('когда буфера нет вовсе (Safari на iPhone), тоже остаётся ручной путь', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });
    await expect(copyText('отчёт')).resolves.toBe('manual');
  });

  it('для ручного пути поле содержит полный текст отчёта', async () => {
    vi.stubGlobal('navigator', {});
    let captured = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        const area = document.querySelector('textarea');
        captured = area?.value ?? '';
        return false;
      }),
    });
    await copyText('строка-1\nстрока-2');
    expect(captured).toBe('строка-1\nстрока-2');
  });
});
