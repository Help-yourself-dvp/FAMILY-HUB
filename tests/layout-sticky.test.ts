/**
 * Сторож нижней панели: она должна оставаться на месте при прокрутке.
 *
 * Владелец на iPhone (03.10.2026): панель с кнопками Главная/Покупки/Дела/Сроки
 * при прокрутке «уезжала» вверх до середины экрана. Причина — дефект Safari на iOS
 * для элементов `position: fixed` (в iOS 26 и в установленном на экран Домой
 * приложении после долгой работы). Лечение: `position: sticky`.
 *
 * Тест читает CSS и падает, если кто-то вернёт `fixed` — этот дефект невозможно
 * поймать в jsdom (там нет прокрутки и Safari), поэтому сторож статический.
 */
// @vitest-environment node
// Окружение — node: CSS читается как текст (vite-импорт `?raw` для .css отдаёт пустую
// строку — CSS обрабатывает сам vite). Чтение и разбор правил — в tests/helpers/css.ts.
import { describe, expect, it } from 'vitest';
import { readDesignCss, ruleBody } from './helpers/css';

const css = readDesignCss('components.css');

/** Тело правила по селектору (комментарии вырезаны помощником). */
function rule(selector: string): string {
  return ruleBody(css, selector);
}

describe('нижняя панель и кнопка «+» не уезжают при прокрутке', () => {
  it('.tabbar закреплена через sticky, а не через fixed (дефект Safari на iOS)', () => {
    const body = rule('.tabbar');
    expect(body).toContain('position: sticky');
    expect(body).not.toContain('position: fixed');
    expect(body).toContain('bottom: 0');
  });

  it('.fab («+») использует тот же приём', () => {
    const body = rule('.fab');
    expect(body).toContain('position: sticky');
    expect(body).not.toContain('position: fixed');
  });

  it('панель остаётся видимой над содержимым (z-index выше экрана)', () => {
    const body = rule('.tabbar');
    const z = Number(body.match(/z-index:\s*(\d+)/u)?.[1] ?? 0);
    expect(z).toBeGreaterThanOrEqual(30);
  });
});
