#!/usr/bin/env node
/**
 * Производство иконок PWA из ОДНОЙ картинки владельца.
 *
 * Зачем: владелец решил сам подготовить изображение (2026-10-01), а задача кода —
 * превратить его во все требуемые форматы одинаково и на Android, и на iOS,
 * без ручной работы в графическом редакторе и без зависимостей.
 *
 * Что делает из одного PNG:
 *   public/icons/icon-192.png        — обычная иконка PWA
 *   public/icons/icon-512.png        — большая иконка PWA
 *   public/icons/maskable-512.png    — адаптивная (Android вырезает круг/скруглённый
 *                                      квадрат, поэтому символ уменьшен до «безопасной
 *                                      зоны» ~66% и залит сплошным фоном)
 *   public/icons/monochrome-512.png  — силуэт для системной маски Android 13+
 *   public/icons/apple-touch-icon.png— 180×180, непрозрачная (iOS не любит прозрачность)
 *   public/icons/favicon-32.png      — 32×32 для вкладки браузера
 *
 * Имена файлов не меняются — значит manifest.webmanifest и index.html трогать не нужно.
 *
 * Использование:
 *   node scripts/make-icons-from-png.mjs path/to/your-icon.png
 *   node scripts/make-icons-from-png.mjs path/to/your-icon.png --check   # только проверка
 *
 * Требования к исходнику: PNG, квадрат, сторона ≥ 192 px (лучше 512–1024).
 * Чересстрочная развёртка (Adam7) не поддерживается — скрипт скажет об этом прямо.
 *
 * Если картинки ещё нет, процедурная заглушка генерируется как раньше:
 *   node scripts/make-icons.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, resizeRgba, encodePngRgba } from './lib/png-io.mjs';

const args0 = process.argv.slice(2);
/** Куда класть результат. По умолчанию — боевой каталог иконок. */
const OUT_DIR = (() => {
  const i = args0.indexOf('--out');
  if (i >= 0 && args0[i + 1]) return resolve(args0[i + 1]);
  return resolve('public/icons');
})();
/** Доля холста, которую символ занимает в maskable-иконке (безопасная зона Android). */
const MASKABLE_CONTENT = 0.66;

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

/** Смешивание «источник поверх фона», по всему холсту. */
function compositeOver(bgRgb, fg) {
  const out = new Uint8Array(fg.width * fg.height * 4);
  for (let i = 0; i < fg.width * fg.height; i++) {
    const s = i * 4;
    const a = fg.data[s + 3] / 255;
    out[s] = Math.round(fg.data[s] * a + bgRgb[0] * (1 - a));
    out[s + 1] = Math.round(fg.data[s + 1] * a + bgRgb[1] * (1 - a));
    out[s + 2] = Math.round(fg.data[s + 2] * a + bgRgb[2] * (1 - a));
    out[s + 3] = 255;
  }
  return { width: fg.width, height: fg.height, data: out };
}

function solidCanvas(size, rgb) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width: size, height: size, data };
}

/** Кладёт `img` в центр холста `size` на сплошной фон. */
function centeredOnBackground(img, size, rgb, contentRatio = 1) {
  const canvas = solidCanvas(size, rgb);
  const inner = Math.max(1, Math.round(size * contentRatio));
  const small = resizeRgba(img, inner, inner);
  const off = Math.floor((size - inner) / 2);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const s = (y * inner + x) * 4;
      const d = ((y + off) * size + (x + off)) * 4;
      const a = small.data[s + 3] / 255;
      canvas.data[d] = Math.round(small.data[s] * a + canvas.data[d] * (1 - a));
      canvas.data[d + 1] = Math.round(small.data[s + 1] * a + canvas.data[d + 1] * (1 - a));
      canvas.data[d + 2] = Math.round(small.data[s + 2] * a + canvas.data[d + 2] * (1 - a));
      canvas.data[d + 3] = 255;
    }
  }
  return canvas;
}

/**
 * Цвет фона для maskable/apple-touch: медиана по углам исходника, чтобы подложка
 * совпадала с краем картинки и не давала видимой рамки. Если углы прозрачные —
 * берём фирменный синий приложения.
 */
function pickBackground(img) {
  const pts = [];
  const w = img.width;
  const h = img.height;
  const m = Math.max(1, Math.floor(Math.min(w, h) * 0.02));
  for (const [cx, cy] of [
    [0, 0],
    [w - m, 0],
    [0, h - m],
    [w - m, h - m],
  ]) {
    for (let y = cy; y < cy + m && y < h; y++) {
      for (let x = cx; x < cx + m && x < w; x++) {
        const s = (y * w + x) * 4;
        if (img.data[s + 3] > 200) pts.push([img.data[s], img.data[s + 1], img.data[s + 2]]);
      }
    }
  }
  if (pts.length === 0) return [47, 79, 216]; // #2f4fd8 — фирменный синий
  const med = (idx) => {
    const v = pts.map((p) => p[idx]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  return [med(0), med(1), med(2)];
}

/** Силуэт для monochrome: белый цвет, прозрачность = яркость исходника. */
function toMonochrome(img) {
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i++) {
    const s = i * 4;
    const a = img.data[s + 3] / 255;
    const lum = (0.2126 * img.data[s] + 0.7152 * img.data[s + 1] + 0.0722 * img.data[s + 2]) * a;
    out[s] = 255;
    out[s + 1] = 255;
    out[s + 2] = 255;
    out[s + 3] = Math.round(lum);
  }
  return { width: img.width, height: img.height, data: out };
}

function write(name, img) {
  const path = `${OUT_DIR}/${name}`;
  mkdirSync(OUT_DIR, { recursive: true });
  const buf = encodePngRgba(img);
  writeFileSync(path, buf);
  console.log(`  ✓ ${name}  ${img.width}×${img.height}  ${(buf.length / 1024).toFixed(1)} КБ`);
}

// ---- аргументы -----------------------------------------------------------------
const args = args0;
const checkOnly = args.includes('--check');
const srcArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

if (!srcArg) {
  fail('Нужен путь к PNG-картинке. Пример: node scripts/make-icons-from-png.mjs my-icon.png');
}
const srcPath = resolve(srcArg);
if (!existsSync(srcPath)) fail(`Файл не найден: ${srcPath}`);

let raw;
try {
  raw = readFileSync(srcPath);
} catch (e) {
  fail(`Не удалось прочитать файл: ${e.message}`);
}

let src;
try {
  src = decodePng(raw);
} catch (e) {
  fail(e.message);
}

console.log(`Исходник: ${srcPath}`);
console.log(`  размер ${src.width}×${src.height}, ${(raw.length / 1024).toFixed(1)} КБ`);

if (src.width !== src.height) {
  fail(
    `Нужен квадрат, а получен ${src.width}×${src.height}. Обрежьте картинку до квадрата — иначе символ будет растянут.`,
  );
}
if (src.width < 192) {
  fail(`Слишком маленькая картинка: ${src.width}px. Нужно минимум 192px, лучше 512–1024px.`);
}
if (src.width < 512) {
  console.log(`  ⚠ ${src.width}px хватит для 192/180/32, но иконка 512 будет слегка мыльной`);
}

const bg = pickBackground(src);
console.log(`  фон для maskable/apple-touch: rgb(${bg.join(', ')}) — взят из углов исходника`);

if (checkOnly) {
  console.log('\n--check: файлы не изменялись. Уберите --check, чтобы сгенерировать иконки.');
  process.exit(0);
}

console.log('\nГенерация:');
write('icon-192.png', resizeRgba(src, 192, 192));
write('icon-512.png', resizeRgba(src, 512, 512));
write('maskable-512.png', centeredOnBackground(src, 512, bg, MASKABLE_CONTENT));
write('monochrome-512.png', toMonochrome(centeredOnBackground(src, 512, bg, 0.72)));
write('apple-touch-icon.png', compositeOver(bg, resizeRgba(src, 180, 180)));
write('favicon-32.png', resizeRgba(src, 32, 32));

// manifest не меняем, но сверяем, что все объявленные иконки на месте.
try {
  const manifest = JSON.parse(readFileSync(resolve('public/manifest.webmanifest'), 'utf8'));
  const missing = (manifest.icons ?? [])
    .map((i) => i.src.replace(/^\.\//, '').replace(/^icons\//, ''))
    .filter((name) => !existsSync(`${OUT_DIR}/${name}`));
  if (missing.length > 0) {
    console.error(
      `\n✖ manifest.webmanifest ссылается на отсутствующие иконки: ${missing.join(', ')}`,
    );
    process.exit(1);
  }
  console.log(
    `\nmanifest.webmanifest: все ${(manifest.icons ?? []).length} объявленных иконок на месте.`,
  );
} catch (e) {
  console.warn(`\n⚠ не удалось сверить manifest.webmanifest: ${e.message}`);
}

console.log(`\nГотово. Каталог ${OUT_DIR} обновлён.`);
console.log('Дальше: npm run build (или просто push — публикация соберёт всё сама).');
