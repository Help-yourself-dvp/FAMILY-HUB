/**
 * Чтение CSS из тестов. Окружение — node (в таких тестах нет jsdom, а CSS нужен как
 * текст). В tsconfig.app.json намеренно подключён только `vite/client`, поэтому
 * node-типов нет: единственную нужную нам функцию приводим вручную.
 */
// @ts-expect-error см. комментарий выше: типы node не подключены осознанно.
import { readFileSync as readFileSyncRaw } from 'node:fs';

const readFile = readFileSyncRaw as unknown as (path: URL, encoding: 'utf8') => string;

/** Текст CSS из src/design (например `base.css`). */
export function readDesignCss(name: string): string {
  return readFile(new URL(`../../src/design/${name}`, import.meta.url), 'utf8');
}

/** Тело правила по селектору; комментарии вырезаются (в них бывают подсказки вроде fixed). */
export function ruleBody(css: string, selector: string): string {
  const index = css.indexOf(`\n${selector} {`);
  if (index < 0) throw new Error(`Правило ${selector} не найдено`);
  const end = css.indexOf('}', index);
  if (end < 0) throw new Error(`Правило ${selector} не закрыто`);
  return css.slice(index, end).replaceAll(/\/\*[\s\S]*?\*\//gu, '');
}

/** Числовое значение верхнего отступа из `padding` (учитывает токены --sp-N). */
export function topPaddingPx(body: string, tokens: string): number {
  const match = body.match(/padding:\s*([^;]+);/u);
  const raw = match?.[1];
  if (raw === undefined) throw new Error('В правиле нет padding');
  const first = raw.trim().split(/\s+/u)[0] ?? '';
  const px = first.match(/^([\d.]+)px$/u);
  if (px) return Number(px[1]);
  const token = first.match(/^var\((--sp-\d)\)$/u);
  if (token) {
    const value = tokens.match(new RegExp(`${token[1]}:\\s*([\\d.]+)px`, 'u'));
    if (value) return Number(value[1]);
  }
  throw new Error(`Не разобрать верхний отступ: ${first}`);
}
