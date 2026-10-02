/**
 * Уникальный ID сущности (ТЗ §7: «Предусмотреть уникальный ID каждой сущности»).
 * crypto.randomUUID доступен во всех целевых браузерах (iOS 15.4+, Chrome 92+),
 * но на случай http/старого WebView — детерминированный fallback без зависимостей.
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // Последний резерв: время + случайность. Не криптографично, но коллизии
  // в масштабе семьи из 2-4 человек практически невозможны.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** ID устройства: генерируется один раз и хранится локально. Используется как updatedBy. */
export function newDeviceId(): string {
  return `dev-${newId().slice(0, 8)}`;
}
