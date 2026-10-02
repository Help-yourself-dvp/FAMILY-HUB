/**
 * Код подключения второго устройства — семейная модель доступа.
 *
 * Решение владельца (2026-10-01, ревизия решения «PAT на каждого»): аккаунт GitHub
 * создаёт ТОЛЬКО тот, кто заводят семейное хранилище. Остальным членам семьи аккаунт
 * не нужен: они подключаются кодом, который приложение генерирует на первом телефоне.
 * Код содержит владелец/репозиторий/ветку/ключ — то есть это «семейный ключ» в
 * переносимом виде.
 *
 * Формат: `FHSETUP1.<base64url(json)>.<checksum>` — одна строка без пробелов,
 * удобно копировать и пересылать себе в мессенджер. Контрольная сумма защищает от
 * опечаток: приложение откажет с внятным текстом, а не молча подключится куда-то не туда.
 *
 * ВАЖНО про безопасность: код ЭКВИВАЛЕНТЕН ключу доступа. Его можно передавать только
 * внутри семьи (приложение прямо предупреждает об этом в интерфейсе). Публично
 * публиковать код нельзя — это доступ к семейным данным.
 */

export interface SetupPayload {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

const PREFIX = 'FHSETUP1';

/** base64url без паддинга: безопасен для URL, мессенджеров и моноширинного вывода. */
function toB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** FNV-1a, 6 знаков base36: ловит опечатки, не претендует на криптостойкость. */
function checksum(body: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, '0').slice(-6);
}

export function encodeSetupCode(p: SetupPayload): string {
  const clean: SetupPayload = {
    owner: p.owner.trim(),
    repo: p.repo.trim(),
    branch: (p.branch || 'main').trim(),
    token: p.token.trim(),
  };
  for (const [k, v] of Object.entries(clean)) {
    if (!v) throw new Error(`Невозможно составить код: поле «${k}» пустое`);
  }
  const body = toB64Url(JSON.stringify(clean));
  return `${PREFIX}.${body}.${checksum(body)}`;
}

export class SetupCodeError extends Error {}

export function parseSetupCode(raw: string): SetupPayload {
  const code = raw.trim().replace(/\s+/g, '');
  if (!code) throw new SetupCodeError('Вставьте код подключения целиком.');
  const parts = code.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new SetupCodeError(
      'Это не код подключения Family Hub. Код начинается с «FHSETUP1.» и целиком копируется на первом телефоне.',
    );
  }
  const [, body, sum] = parts as [string, string, string];
  if (checksum(body) !== sum) {
    throw new SetupCodeError(
      'Код повреждён или скопирован не целиком (контрольная сумма не сошлась). Скопируйте его ещё раз на первом телефоне.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromB64Url(body));
  } catch {
    throw new SetupCodeError('Код повреждён: не читается внутренняя часть.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SetupCodeError('Код повреждён: неожиданный формат содержимого.');
  }
  const o = parsed as Record<string, unknown>;
  const owner = typeof o.owner === 'string' ? o.owner : '';
  const repo = typeof o.repo === 'string' ? o.repo : '';
  const branch = typeof o.branch === 'string' && o.branch ? o.branch : 'main';
  const token = typeof o.token === 'string' ? o.token : '';
  if (!owner || !repo || !token) {
    throw new SetupCodeError('В коде не хватает данных подключения. Скопируйте его заново.');
  }
  return { owner, repo, branch, token };
}
