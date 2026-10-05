/**
 * Свежесть настроек приложения (vapid.json) — сторож 0.6.1.
 *
 * В этом файле лежат адреса необязательных возможностей (лента, «будильник»); владелец
 * включает их без пересборки приложения. Если отдавать копию из кэша, обновление
 * настроек не видно: приложение показывало «Не найден адрес публичного репозитория»,
 * хотя в новом vapid.json адрес уже был (проверка владельца 05.10.2026). Поэтому service
 * worker обязан брать настройки из сети, а кэш держать только запасным вариантом.
 *
 * Исходники читаются Vite-импортом `?raw`: node-типы в tsconfig.app.json не подключены
 * осознанно (см. tests/helpers/css.ts).
 */
import { describe, expect, it } from 'vitest';
import sw from '../public/sw.js?raw';
import feed from '../src/data/remote/feed.ts?raw';
import wake from '../src/data/remote/wake.ts?raw';
import channels from '../src/notifications/channels.ts?raw';

const configReaders = [
  ['лента', feed],
  ['будильник', wake],
  ['push-подписка', channels],
] as const;

describe('свежесть vapid.json', () => {
  it('service worker берёт настройки из сети в первую очередь', () => {
    const branchStart = sw.indexOf("url.pathname.endsWith('/vapid.json')");
    const staticBranch = sw.indexOf('// Статика: stale-while-revalidate');
    expect(branchStart).toBeGreaterThan(-1);
    expect(staticBranch).toBeGreaterThan(-1);
    // Ветка настроек обязана стоять ДО общей статики: иначе её перехватит SWR по кэшу.
    expect(branchStart).toBeLessThan(staticBranch);

    const branch = sw.slice(branchStart, staticBranch);
    expect(branch).toContain("fetch(req, { cache: 'no-store' })");
    expect(branch).toContain('return hit || Response.error()'); // офлайн — из кэша
  });

  it('общая статика по-прежнему отдаётся из кэша (быстрый старт)', () => {
    const staticBranch = sw.slice(sw.indexOf('// Статика: stale-while-revalidate'));
    expect(staticBranch).toContain('return hit || network || Response.error()');
  });

  it.each(configReaders)('читатель настроек (%s) просит копию мимо кэша браузера', (_name, src) => {
    expect(src).toContain("{ cache: 'no-store' }");
  });
});
