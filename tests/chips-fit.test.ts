/**
 * Чипы фильтров в «Делах» обязаны помещаться в строку на телефоне (замечание владельца
 * 07.10.2026: правый край чипа «Без исполнителя» уходил за экран). В jsdom нет вёрстки,
 * поэтому сторож статический: читаем CSS и требуем компактные отступы у чипов строки.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readDesignCss, ruleBody } from './helpers/css';

const css = readDesignCss('components.css');

describe('чипы фильтра в одну строку', () => {
  it('строка чипов не переносится и прокручивается вбок при нехватке места', () => {
    const body = ruleBody(css, '.chips--line');
    expect(body).toContain('flex-wrap: nowrap');
    expect(body).toContain('overflow-x: auto');
  });

  it('чипы строки компактнее обычного (10px по бокам вместо 14px)', () => {
    const body = ruleBody(css, '.chips--line .chip');
    expect(body).toContain('padding: 8px 10px');
    // Ширина чипа не растягивается: иначе «Без исполнителя» выдавит соседей.
    expect(body).toContain('flex: 0 0 auto');
  });

  it('компактный список сортировки ограничен по ширине', () => {
    const body = ruleBody(css, '.select--compact');
    expect(body).toMatch(/max-width:\s*1\d\dpx/);
  });
});
