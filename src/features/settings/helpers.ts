/** Настройки · вспомогательные функции */
/**
 * Вспомогательные функции экрана настроек. Вынесены отдельно, чтобы компоненты
 * оставались небольшими (§6.18: отсутствие гигантских компонентов).
 */
import { GitHubError } from '../../data/remote/githubClient';

/** Человекочитаемая подсказка по коду ошибки GitHub. */
export function suggestFix(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Ключ доступа недействителен или истёк. Создайте новый по инструкции.';
    case 'not-found':
      return 'Репозиторий не найден или у ключа нет к нему доступа. Проверьте название и права (Contents: Read and write).';
    case 'forbidden':
      return 'Недостаточно прав. В ключе должно быть разрешение Contents → Read and write именно на этот репозиторий.';
    case 'conflict':
      return 'Другое устройство изменило данные одновременно. Повторите синхронизацию — изменения объединятся автоматически.';
    case 'rate-limit':
      return 'Исчерпан лимит запросов GitHub (5000/час). Подождите немного и повторите.';
    case 'secondary-limit':
      return 'Слишком частые обращения. Приложение увеличит паузу автоматически; повторите через минуту.';
    case 'network':
      return 'Запрос к api.github.com не дошёл (браузер вернул «Failed to fetch»). Причины: сеть, блокировщик рекламы/VPN, DNS — или ошибка в самих запросах приложения (так было в 0.4.2–0.4.3: лишний заголовок ломал preflight). Проверьте интернет и обновите приложение; если повторяется — пришлите отчёт из диагностики.';
    case 'timeout':
      return 'Запрос к GitHub не уложился в 20 секунд: соединение есть, но сервер молчит. Повторите синхронизацию; если повторяется — пришлите отчёт из диагностики.';
    case 'validation':
      return 'Файл данных повреждён или создан более новой версией приложения. Обновите приложение.';
    default:
      return '';
  }
}

export function describeError(e: unknown): string {
  if (e instanceof GitHubError) {
    const hint = suggestFix(e.code);
    return `${e.code} (HTTP ${e.status}): ${e.message}${hint ? `\n${hint}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Структурное описание события журнала. Содержимого данных и токенов здесь нет (§6.19). */
export function describeEvent(e: { type: string } & Record<string, unknown>): string {
  const parts = Object.entries(e)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : String(v)}`);
  return `${e.type}${parts.length ? ' ' + parts.join(' ') : ''}`;
}

export function toneColor(phase: string): string {
  switch (phase) {
    case 'synced':
      return 'var(--ok)';
    case 'error':
      return 'var(--err)';
    case 'offline':
      return 'var(--warn)';
    case 'syncing':
      return 'var(--accent)';
    default:
      return 'var(--text-3)';
  }
}

export function readDisplayMode(): string {
  for (const m of ['standalone', 'fullscreen', 'minimal-ui', 'browser']) {
    if (window.matchMedia(`(display-mode: ${m})`).matches) return m;
  }
  return 'unknown';
}
