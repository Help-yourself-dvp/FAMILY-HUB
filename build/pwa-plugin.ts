/**
 * Собственный минимальный PWA-плагин вместо vite-plugin-pwa.
 *
 * Отклонение от первоначального плана (PROJECT.md §5) с объяснением по §7 протокола:
 * vite-plugin-pwa тянет workbox-build — десятки пакетов ради одной функции
 * (сгенерировать список файлов для precache). Это ровно то, против чего
 * предостерегают ТЗ §28 и Universal Guide §6.1: «не подключать библиотеку ради
 * одной небольшой функции, которую безопасно реализовать самостоятельно».
 *
 * Плагин делает одно: собирает список артефактов сборки и кладёт его в
 * `dist/app-shell.json`. Сам Service Worker (public/sw.js) написан нами и поэтому
 * полностью контролирует стратегию обновления — это прямое требование ТЗ §10.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

export interface PwaPluginOptions {
  version: string;
  basePath: string;
}

function listPublic(dir: string, base = dir): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(listPublic(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

export function pwaPlugin(opts: PwaPluginOptions): Plugin {
  return {
    name: 'family-hub:pwa-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle(_outputOptions, bundle) {
      const buildId = `${opts.version}-${Date.now().toString(36)}`;

      const precache = new Set<string>();
      for (const fileName of Object.keys(bundle)) precache.add(fileName);
      for (const f of listPublic(join(process.cwd(), 'public'))) {
        // sw.js кэшировать не нужно: браузер и так запрашивает его отдельно.
        if (f !== 'sw.js') precache.add(f);
      }
      precache.add('index.html');

      const payload = {
        buildId,
        version: opts.version,
        generatedAt: new Date().toISOString(),
        precache: [...precache].sort(),
      };

      this.emitFile({
        type: 'asset',
        fileName: 'app-shell.json',
        source: JSON.stringify(payload, null, 2),
      });
    },
  };
}
