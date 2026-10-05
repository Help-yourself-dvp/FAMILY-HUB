/**
 * «Будить отправителя» (0.5.8–0.5.9, решение владельца 05.10.2026).
 *
 * Зачем: расписание GitHub не пунктуально — за трое суток цикл запускался 12 раз вместо
 * ~144 (факт 04.10.2026), поэтому уведомление о новой покупке могло прийти через часы.
 * Теперь сразу после успешной записи данных в семейное хранилище приложение просит GitHub
 * запустить отправку немедленно (workflow_dispatch). Уведомление приходит за 1–2 минуты.
 *
 * Что важно знать:
 *  - это ТОЛЬКО просьба «проверь напоминания»: содержимое данных не передаётся;
 *  - нужен токен с правом **Actions: write** на публичный репозиторий. Если права нет,
 *    приложение молчит, а причина видна в журнале диагностики (`wake`) — с кодом ответа
 *    GitHub, чтобы не гадать (403 — нет права, 404 — токен не видит репозиторий);
 *  - не чаще одной просьбы в минуту и только после изменений, сделанных этим устройством;
 *  - настройки «будильника» лежат в public/vapid.json — они не секретные, зато меняются
 *    без пересборки приложения.
 */
import { auth } from './authStrategy';
import { log } from '../../shared/log';

export interface WakeConfig {
  owner: string;
  repo: string;
  workflow: string;
  ref: string;
}

/** Не чаще одной просьбы в минуту: одна серия правок — один запуск отправки. */
export const WAKE_MIN_INTERVAL_MS = 60_000;

export type WakeOutcome =
  /** GitHub принял просьбу (HTTP 204) — отправка начнётся в течение минуты-двух. */
  | { kind: 'sent' }
  /** Просьба ушла, но GitHub отказал. status=null — сеть/прерванный запрос. */
  | { kind: 'failed'; status: number | null }
  /** Даже не пробовали: нет интернета, нет токена, нет настроек или сработал ограничитель. */
  | { kind: 'skipped'; reason: 'offline' | 'token' | 'config' | 'throttle' };

let lastWakeAt = 0;

/** Только для тестов: сбрасывает ограничение частоты между проверками. */
export function resetWakeThrottle(): void {
  lastWakeAt = 0;
}

async function loadWakeConfig(): Promise<WakeConfig | null> {
  try {
    const res = await fetch(new URL('vapid.json', document.baseURI).href, { cache: 'no-store' });
    const cfg = (await res.json()) as { pushWake?: Partial<WakeConfig> };
    const w = cfg.pushWake;
    if (
      !w ||
      typeof w.owner !== 'string' ||
      typeof w.repo !== 'string' ||
      typeof w.workflow !== 'string' ||
      typeof w.ref !== 'string'
    ) {
      return null;
    }
    return { owner: w.owner, repo: w.repo, workflow: w.workflow, ref: w.ref };
  } catch {
    return null;
  }
}

/**
 * Просит GitHub запустить отправителя. Никогда не бросает: «будильник» — вспомогательный
 * механизм, его сбой не должен мешать синхронизации.
 */
export async function wakePushSender(
  reason: string,
  options: { force?: boolean } = {},
): Promise<WakeOutcome> {
  const result = async (): Promise<WakeOutcome> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { kind: 'skipped', reason: 'offline' };
    }
    if (!options.force && Date.now() - lastWakeAt < WAKE_MIN_INTERVAL_MS) {
      return { kind: 'skipped', reason: 'throttle' };
    }
    const cfg = await loadWakeConfig();
    if (!cfg) return { kind: 'skipped', reason: 'config' };
    const token = await auth.getToken();
    if (!token) return { kind: 'skipped', reason: 'token' };

    // Отметку ставим до запроса: неудачная попытка не должна повторяться на каждой
    // синхронизации (иначе браузер будет долбить GitHub при нехватке прав).
    lastWakeAt = Date.now();
    try {
      const res = await fetch(
        `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: cfg.ref }),
        },
      );
      if (res.status === 204) return { kind: 'sent' };
      return { kind: 'failed', status: res.status };
    } catch {
      return { kind: 'failed', status: null };
    }
  };

  const outcome = await result();
  // В журнал — только короткие машинные признаки: ни токена, ни данных.
  if (outcome.kind === 'failed') {
    log.emit({ type: 'wake', ok: false, reason, status: outcome.status });
  } else if (outcome.kind === 'sent') {
    log.emit({ type: 'wake', ok: true, reason });
  } else {
    log.emit({ type: 'wake', ok: false, reason, skipped: outcome.reason });
  }
  return outcome;
}

/** Человеческий ответ на результат проверки — один и тот же в интерфейсе и в тестах. */
export function wakeHint(outcome: WakeOutcome): string {
  switch (outcome.kind) {
    case 'sent':
      return 'GitHub принял просьбу: отправка начнётся в течение пары минут. Если отправлять нечего, уведомление не придёт — это нормально.';
    case 'skipped':
      return {
        offline: 'Телефон сейчас без интернета — проверьте связь и повторите.',
        token: 'Сначала подключите семейное хранилище: без токена запустить отправку нельзя.',
        config: 'Настройки «будильника» не найдены в файле приложения (vapid.json).',
        throttle: 'Только что уже просили запуск — повторите через минуту.',
      }[outcome.reason];
    case 'failed':
      if (outcome.status === 403) {
        return 'GitHub отказал: у токена нет права запускать проверки (Actions: write). Добавьте это право — и «будильник» заработает.';
      }
      if (outcome.status === 404) {
        return 'GitHub не нашёл репозиторий: токен не видит публичный репозиторий приложения. Добавьте его в доступ токена.';
      }
      if (outcome.status === 422) {
        return 'GitHub не принял запрос (422): вероятно, указана ветка без файла отправки. Сообщите разработчику.';
      }
      return outcome.status === null
        ? 'Запрос не дошёл (сеть или прерванное соединение). Попробуйте ещё раз.'
        : `GitHub отклонил запрос (код ${outcome.status}). Сообщите разработчику этот код.`;
  }
}
