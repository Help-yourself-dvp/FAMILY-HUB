#!/usr/bin/env node
/**
 * Генерация иконок PWA без единой зависимости — только zlib из Node.
 * (ТЗ §35 K: «иконки/заглушки, если невозможно получить финальные assets».)
 * PNG пишется вручную: IHDR + IDAT + IEND, RGBA 8 бит.
 */
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const C1 = hex('#6f97ff'); // верх-лево
const C2 = hex('#2f4fd8'); // низ-право

/** Скруглённый квадрат: возвращает alpha 0..1 с антиалиасингом по краю. */
function roundedAlpha(nx, ny, radius, feather) {
  const r = radius;
  const dx = Math.max(r - nx, nx - (1 - r), 0);
  const dy = Math.max(r - ny, ny - (1 - r), 0);
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= r - feather) return 1;
  if (d >= r + feather) return 0;
  return (r + feather - d) / (2 * feather);
}

/**
 * Силуэт дома: крыша-треугольник + корпус + дверь.
 * Возвращает 1 (белое), 0.0 (фон) или промежуточное значение для двери.
 */
function houseMask(nx, ny) {
  const FE = 0.006;
  const aa = (v) => Math.min(1, Math.max(0, v));
  // Крыша: треугольник с вершиной (0.5, 0.20), основание y=0.52, x 0.16..0.84
  const roofTop = 0.20, roofBottom = 0.53, roofHalf = 0.34;
  let m = 0;
  if (ny >= roofTop - FE && ny <= roofBottom + FE) {
    const t = (ny - roofTop) / (roofBottom - roofTop);
    const half = roofHalf * Math.min(1, Math.max(0, t));
    const inside = Math.abs(nx - 0.5) <= half;
    const edge = half - Math.abs(nx - 0.5);
    m = Math.max(m, inside ? aa(edge / FE) : 0);
    m = Math.max(m, aa((ny - (roofTop - FE)) / FE) * aa(((roofBottom + FE) - ny) / FE) * (inside ? 1 : 0));
  }
  // Корпус: x 0.27..0.73, y 0.50..0.80
  const bx0 = 0.27, bx1 = 0.73, by0 = 0.50, by1 = 0.80;
  if (nx >= bx0 - FE && nx <= bx1 + FE && ny >= by0 - FE && ny <= by1 + FE) {
    const e = Math.min(nx - bx0, bx1 - nx, ny - by0, by1 - ny);
    m = Math.max(m, aa(e / FE));
  }
  if (m <= 0) return 0;
  // Дверь: вырез в корпусе (показываем фон)
  const dx0 = 0.435, dx1 = 0.565, dy0 = 0.63, dy1 = 0.80;
  if (nx > dx0 && nx < dx1 && ny > dy0 && ny < dy1) return 0;
  return Math.min(1, m);
}

function makeIcon(size, { padding = 0.0, monochrome = false }) {
  const radius = 0.2237; // как у iOS/macOS app icon
  const feather = 1.4 / size;
  const inner = 1 - padding * 2;
  return encodePng(size, (x, y) => {
    const nx = x / (size - 1);
    const ny = y / (size - 1);
    const bgA = roundedAlpha(nx, ny, radius, feather);
    if (bgA <= 0) return [0, 0, 0, 0];

    // Координаты внутри «безопасной» области (для maskable — с отступом)
    const ix = padding + (nx - padding) / inner;
    const iy = padding + (ny - padding) / inner;

    const t = (nx + ny) / 2;
    let r = lerp(C1[0], C2[0], t);
    let g = lerp(C1[1], C2[1], t);
    let b = lerp(C1[2], C2[2], t);

    if (monochrome) {
      // monochrome-иконка: прозрачный фон, силуэт непрозрачный (требование Android 13+)
      const hm = houseMask(ix, iy);
      const a = Math.round(255 * hm * bgA);
      return [255, 255, 255, a];
    }

    const hm = houseMask(ix, iy);
    if (hm > 0) {
      r = lerp(r, 255, hm);
      g = lerp(g, 255, hm);
      b = lerp(b, 255, hm);
    }
    return [r, g, b, Math.round(255 * bgA)];
  });
}

const targets = [
  ['public/icons/icon-192.png', 192, { padding: 0.0 }],
  ['public/icons/icon-512.png', 512, { padding: 0.0 }],
  ['public/icons/maskable-512.png', 512, { padding: 0.12 }],
  ['public/icons/monochrome-512.png', 512, { padding: 0.14, monochrome: true }],
  ['public/icons/apple-touch-icon.png', 180, { padding: 0.0 }],
  ['public/icons/favicon-32.png', 32, { padding: 0.0 }],
];

for (const [path, size, opts] of targets) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, makeIcon(size, opts));
  console.log(`  ✓ ${path} (${size}×${size})`);
}
