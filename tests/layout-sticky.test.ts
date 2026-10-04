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
// Окружение — node (первая строка): CSS здесь читается с диска, а не через vite-импорт
// (?raw для .css в этом проекте отдаёт пустую строку — CSS обрабатывает vite).
// @ts-expect-error в tsconfig.app.json намеренно подключён только vite/client: node-типов
// у тестов нет, и это единственный файл, которому нужен файловый доступ.
import { readFileSync as readFileSyncRaw } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Приводим вручную: без node-типов импорт разрешается как «неизвестный», а нужна строка.
// Тип описан здесь ровно для одной операции — чтения CSS рядом с тестом.
const readCss = readFileSyncRaw as unknown as (path: URL, encoding: 'utf8') => string;

const css = readCss(new URL('../src/design/components.css', import.meta.url), 'utf8');

/** Тело правила по селектору (до закрывающей скобки первого блока). */
function rule(selector: string): string {
  const index = css.indexOf(`\n${selector} {`);
  expect(index, `правило ${selector} не найдено`).toBeGreaterThan(-1);
  const end = css.indexOf('}', index);
  // Комментарии выкидываем: в них объясняется причина правки и упоминается `fixed`,
  // из-за чего наивная проверка «нет слова fixed» ловила бы сам комментарий.
  return css.slice(index, end).replaceAll(/\/\*[\s\S]*?\*\//gu, '');
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
