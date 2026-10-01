/**
 * Регрессия белого экрана 0.1.6: `where(...).equals(null)` бросает
 * «Invalid key» (null — не ключ IndexedDB) и ронял форму добавления на всех
 * устройствах. Тест читает исходники файлов с запросами к Dexie (через
 * vite-импорт ?raw, без node-типов) и запрещает этот шаблон.
 */
import { describe, expect, it } from 'vitest';
import shoppingScreen from '../src/features/shopping/ShoppingScreen.tsx?raw';
import dbSource from '../src/data/db.ts?raw';
import repositories from '../src/data/repositories.ts?raw';
import localStore from '../src/data/sync/localStore.ts?raw';
import remoteStore from '../src/data/sync/remoteStore.ts?raw';

const SOURCES: Array<[string, string]> = [
  ['ShoppingScreen.tsx', shoppingScreen],
  ['db.ts', dbSource],
  ['repositories.ts', repositories],
  ['localStore.ts', localStore],
  ['remoteStore.ts', remoteStore],
];

describe('ключи IndexedDB', () => {
  it('equals(null) не используется в файлах с запросами к Dexie', () => {
    for (const [name, text] of SOURCES) {
      expect(text.match(/\.equals\(\s*null/u), `${name}: найден equals(null)`).toBeNull();
    }
  });
});
