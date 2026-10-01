/**
 * Регрессия белого экрана 0.1.6: `where(...).equals(null)` бросает
 * «Invalid key» (null — не ключ IndexedDB) и ронял форму добавления на всех
 * устройствах. Тест читает исходники и запрещает этот шаблон в коде.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/u.test(e)) out.push(p);
  }
  return out;
}

describe('ключи IndexedDB', () => {
  it('equals(null) не используется нигде в src', () => {
    const bad: string[] = [];
    for (const f of walk('src')) {
      const text = readFileSync(f, 'utf-8');
      if (/\.equals\(\s*null/u.test(text)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
