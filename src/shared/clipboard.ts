/**
 * Копирование текста в буфер обмена с честным запасным путём.
 *
 * Почему не одним вызовом: в Safari на iPhone (особенно в установленном на экран Домой
 * приложении) `navigator.clipboard.writeText` доступен не всегда, а старый
 * `document.execCommand('copy')` там капризен. Владелец 03.10.2026 упёрся в это на
 * отчёте для разработчика: «не удалось скопировать».
 *
 * Порядок:
 *  1. `clipboard` — современный путь;
 *  2. скрытое поле + `execCommand('copy')` — старый путь (тот же приём, что для iOS:
 *     contentEditable + выделение через Range);
 *  3. если не вышло — возвращаем `manual`: экран обязан показать текст, чтобы человек
 *     мог выделить и скопировать его вручную (на iOS это работает всегда).
 */
export type CopyOutcome = 'clipboard' | 'exec' | 'manual';

export async function copyText(text: string): Promise<CopyOutcome> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch {
    // Ниже пробуем старый способ — он не требует разрешений и работает из жеста.
  }
  if (typeof document === 'undefined') return 'manual';
  const area = document.createElement('textarea');
  try {
    area.value = text;
    // iOS: поле должно быть «настоящим» (contentEditable + видимое для системы),
    // иначе select() не выделяет текст. Поэтому opacity маленькая, а не display:none.
    area.contentEditable = 'true';
    area.readOnly = false;
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.width = '2px';
    area.style.height = '2px';
    area.style.fontSize = '16px';
    area.style.opacity = '0.01';
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    const range = document.createRange();
    range.selectNodeContents(area);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const ok = document.execCommand('copy');
    if (ok) return 'exec';
  } catch {
    // Считаем честно: раз не вышло — человек скопирует вручную.
  } finally {
    area.remove();
  }
  return 'manual';
}
