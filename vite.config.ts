import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { pwaPlugin } from './build/pwa-plugin.ts';
import { readFileSync } from 'node:fs';

// Базовый путь вынесен в ОДНУ переменную окружения (PROJECT.md §2.1, п.3):
// GitHub Pages project-site = '/FAMILY-HUB/', любой другой хост или локальный
// preview = '/'. Переключение хостинга не требует правок в коде.
const BASE_PATH = process.env.BASE_PATH ?? '/';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };
const versionFile = JSON.parse(readFileSync('./version.json', 'utf8')) as { version: string };
if (pkg.version !== versionFile.version) {
  throw new Error(
    `Рассинхрон версий: package.json=${pkg.version}, version.json=${versionFile.version}. ` +
      'version.json — единственный канонический источник (PROJECT.md §10, п.5).',
  );
}

export default defineConfig({
  base: BASE_PATH,
  plugins: [react(), pwaPlugin({ version: pkg.version, basePath: BASE_PATH })],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BASE_PATH__: JSON.stringify(BASE_PATH),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Preview-хост среды разработки имеет произвольный домен — разрешаем любой.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
