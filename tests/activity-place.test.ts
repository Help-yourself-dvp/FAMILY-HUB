/**
 * Семейная лента: запись показывает, КУДА попало действие (приёмка 0.3.3):
 * «Покупки · Молочное» против голого «добавил(а) “Йогурт”».
 */
import { describe, expect, it } from 'vitest';
import { placeLabel } from '../src/data/repositories';

describe('placeLabel', () => {
  it('раздел без категории', () => {
    expect(placeLabel('shopping')).toBe('Покупки');
    expect(placeLabel('deadlines')).toBe('Сроки');
    expect(placeLabel('tasks')).toBe('Дела');
  });
  it('покупка с категорией', () => {
    expect(placeLabel('shopping', 'Молочное')).toBe('Покупки · Молочное');
    expect(placeLabel('shopping', '  ')).toBe('Покупки');
    expect(placeLabel('shopping', null)).toBe('Покупки');
  });
  it('неизвестный раздел не роняет ленту', () => {
    expect(placeLabel('whatever')).toBe('Данные');
  });
});
