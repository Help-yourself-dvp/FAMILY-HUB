/**
 * Чтение и запись PNG без единой зависимости — только `node:zlib`.
 *
 * Зачем свой код: проект держит принцип «минимум зависимостей» (ТЗ §35 K), а для
 * производства иконок нужен ровно один навык — прочитать PNG, который положил
 * владелец, и уменьшить его до нужных размеров. Тянуть ради этого sharp/jimp —
 * десятки пакетов в дерево зависимостей.
 *
 * Поддерживается: colorType 0 (gray), 2 (RGB), 3 (палитра), 4 (gray+alpha),
 * 6 (RGBA); глубина 8 и 16 бит; фильтры строк 0–4 по спецификации.
 * Не поддерживается: interlacing (Adam7) — такой PNG будет отклонён внятной
 * ошибкой, а не молча испорчен.
 */
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @typedef {{ width: number, height: number, data: Uint8Array }} RgbaImage */

function readChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Это не PNG-файл (сигнатура не совпала)');
  }
  const chunks = [];
  let o = 8;
  while (o + 12 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    const crcGiven = buf.readUInt32BE(o + 8 + len);
    const crcCalc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0;
    if (crcGiven !== crcCalc) throw new Error(`PNG повреждён: CRC не совпал в чанке ${type}`);
    chunks.push({ type, data });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

/**
 * Декодирует PNG в RGBA8 (по 4 байта на пиксель, строки сверху вниз).
 * @param {Buffer} buf
 * @returns {RgbaImage}
 */
export function decodePng(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG без IHDR — файл неполный');

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (interlace !== 0) {
    throw new Error(
      'PNG с чересстрочной развёрткой (Adam7) не поддерживается. Пересохраните файл без interlace.',
    );
  }
  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`Глубина ${bitDepth} бит не поддерживается (нужно 8 или 16)`);
  }

  /** число каналов по colorType */
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Неизвестный colorType ${colorType}`);

  let palette = null;
  let trns = null;
  const plte = chunks.find((c) => c.type === 'PLTE');
  if (colorType === 3) {
    if (!plte) throw new Error('PNG с палитрой, но без чанка PLTE');
    palette = plte.data;
    const t = chunks.find((c) => c.type === 'tRNS');
    trns = t ? t.data : null;
  }

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  if (idat.length === 0) throw new Error('PNG без данных изображения (нет IDAT)');
  const raw = inflateSync(idat);

  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8)); // байт на пиксель
  const stride = Math.ceil((width * channels * bitDepth) / 8); // байт на строку
  const need = (stride + 1) * height;
  if (raw.length < need) throw new Error(`PNG обрезан: ожидалось ${need} байт, есть ${raw.length}`);

  // 1. Снимаем фильтры строк.
  const img = Buffer.alloc(stride * height);
  let prevRow = Buffer.alloc(stride); // предыдущая строка (для фильтров 1–4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = Buffer.from(line); // копия, которую меняем на месте
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0; // Left
      const b = prevRow[x]; // Up
      const c = x >= bpp ? prevRow[x - bpp] : 0; // UpLeft
      let v = out[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          v = (v + a) & 0xff;
          break;
        case 2:
          v = (v + b) & 0xff;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
          break;
        }
        default:
          throw new Error(`Неизвестный фильтр строки ${filter} (строка ${y})`);
      }
      out[x] = v;
    }
    out.copy(img, y * stride);
    prevRow = out;
  }

  // 2. Приводим к RGBA8.
  const data = new Uint8Array(width * height * 4);
  const sample = (byteOffset) => {
    if (bitDepth === 16) return img[byteOffset]; // старший байт: достаточно для иконок
    return img[byteOffset];
  };
  const bytesPerPixel = channels * (bitDepth === 16 ? 2 : 1);
  const step = bitDepth === 16 ? 2 : 1; // смещение между каналами в байтах

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = y * stride + x * bytesPerPixel;
      const dst = (y * width + x) * 4;

      /** RGBA для одного пикселя; ветки исчерпывают все colorType из таблицы выше. */
      let rgba;
      if (colorType === 0) {
        const v = sample(src);
        rgba = [v, v, v, 255];
      } else if (colorType === 2) {
        rgba = [sample(src), sample(src + step), sample(src + 2 * step), 255];
      } else if (colorType === 3) {
        const idx = img[src] * 3;
        if (idx + 2 >= palette.length) throw new Error('Индекс палитры за пределами PLTE');
        const a = trns && img[src] < trns.length ? trns[img[src]] : 255;
        rgba = [palette[idx], palette[idx + 1], palette[idx + 2], a];
      } else if (colorType === 4) {
        const v = sample(src);
        rgba = [v, v, v, sample(src + step)];
      } else {
        rgba = [sample(src), sample(src + step), sample(src + 2 * step), sample(src + 3 * step)];
      }

      data[dst] = rgba[0];
      data[dst + 1] = rgba[1];
      data[dst + 2] = rgba[2];
      data[dst + 3] = rgba[3];
    }
  }

  return { width, height, data };
}

/**
 * Уменьшение/увеличение усреднением по площади (box filter). Для иконок это важнее
 * «быстрого» бикубика: тонкие детали не превращаются в ступеньки и не пропадают.
 *
 * @param {RgbaImage} src
 * @param {number} dw ширина результата
 * @param {number} dh высота результата
 * @returns {RgbaImage}
 */
export function resizeRgba(src, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  const xRatio = src.width / dw;
  const yRatio = src.height / dh;

  for (let oy = 0; oy < dh; oy++) {
    const sy0 = oy * yRatio;
    const sy1 = (oy + 1) * yRatio;
    const yStart = Math.floor(sy0);
    const yEnd = Math.min(src.height, Math.max(yStart + 1, Math.ceil(sy1)));
    for (let ox = 0; ox < dw; ox++) {
      const sx0 = ox * xRatio;
      const sx1 = (ox + 1) * xRatio;
      const xStart = Math.floor(sx0);
      const xEnd = Math.min(src.width, Math.max(xStart + 1, Math.ceil(sx1)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      for (let y = yStart; y < yEnd; y++) {
        // Доля строки/столбца, попадающая в выходной пиксель.
        const wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
        if (wy <= 0) continue;
        for (let x = xStart; x < xEnd; x++) {
          const wx = Math.min(x + 1, sx1) - Math.max(x, sx0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const s = (y * src.width + x) * 4;
          const sa = src.data[s + 3] / 255;
          // Усредняем уже «развёрнутую» прозрачность, иначе тёмный фон под
          // полупрозрачным краем даёт грязную кайму.
          r += src.data[s] * sa * w;
          g += src.data[s + 1] * sa * w;
          b += src.data[s + 2] * sa * w;
          a += src.data[s + 3] * w;
          weight += w;
        }
      }

      const d = (oy * dw + ox) * 4;
      if (weight <= 0) {
        out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0;
        continue;
      }
      const avgA = a / weight; // 0..255
      const norm = avgA > 0 ? 255 / avgA : 0;
      out[d] = Math.min(255, Math.round((r / weight) * norm));
      out[d + 1] = Math.min(255, Math.round((g / weight) * norm));
      out[d + 2] = Math.min(255, Math.round((b / weight) * norm));
      out[d + 3] = Math.round(avgA);
    }
  }

  return { width: dw, height: dh, data: out };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Записывает RGBA8 как PNG (фильтр строк None, сжатие максимальное).
 * @param {RgbaImage} img
 * @returns {Buffer}
 */
export function encodePngRgba(img) {
  const { width, height, data } = img;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      raw[o++] = data[s];
      raw[o++] = data[s + 1];
      raw[o++] = data[s + 2];
      raw[o++] = data[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colorType RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
