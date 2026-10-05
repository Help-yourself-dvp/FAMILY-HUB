// @vitest-environment node
/**
 * Сторож верхней полосы: сколько пустоты до первой строки.
 *
 * Владелец (iPhone, установленное приложение, 04.10.2026): на каждой странице сверху
 * большая пустая полоса перед названием раздела и значком синхронизации. На Android
 * того же не было. Причина: безопасная зона сверху (`--sat`, у iPhone это 47–62px)
 * вычиталась ДВАЖДЫ — в `.app-shell` и ещё раз в `.topbar`; на Android она равна нулю,
 * поэтому дефект был не виден.
 *
 * Проверки статические: jsdom не знает ни safe-area, ни реального layout, а Safari у
 * нас нет. Зато такие сторожа гарантируют, что двойной отступ не вернётся.
 */
import { describe, expect, it } from 'vitest';
import { readDesignCss, ruleBody, topPaddingPx } from './helpers/css';

const base = readDesignCss('base.css');
const components = readDesignCss('components.css');
const tokens = readDesignCss('tokens.css');

const shell = ruleBody(base, '.app-shell');
const topbar = ruleBody(components, '.topbar');
const screen = ruleBody(base, '.screen');
const header = ruleBody(base, '.screen-header');

describe('верх экрана: пустота только в размере безопасной зоны', () => {
  it('безопасная зона сверху вычитается ровно один раз (иначе на iPhone двойная полоса)', () => {
    const all = `${base}\n${components}`;
    const uses = [...all.matchAll(/var\(--sat\)/gu)].length;
    expect(uses, '--sat должна упоминаться один раз').toBe(1);
    expect(shell, 'единственное место — контейнер приложения').toContain('padding-top: var(--sat)');
  });

  it('верхняя полоса не добавляет безопасную зону и держится в пределах 8px', () => {
    expect(topbar).not.toContain('--sat');
    expect(topPaddingPx(topbar, tokens)).toBeLessThanOrEqual(8);
  });

  it('экраны начинаются не дальше 12px от верхней полосы', () => {
    expect(topPaddingPx(screen, tokens)).toBeLessThanOrEqual(12);
  });

  it('у заголовка экрана нет собственного верхнего отступа', () => {
    expect(header).not.toContain('padding-top');
    expect(header).not.toMatch(/padding:\s*[^;]*var\(--sp/u);
  });
});
