/**
 * «Будить отправителя» (0.5.8, решение владельца 05.10.2026).
 *
 * Зачем: расписание GitHub не пунктуально — за трое суток цикл запускался 12 раз вместо
 * ~144 (факт от 04.10.2026), поэтому уведомление о новой покупке могло прийти через часы.
 * Теперь сразу после успешной записи данных в семейное хранилище приложение просит GitHub
 * запустить отправку немедленно (workflow_dispatch). Уведомление приходит через 1–2 минуты.
 *
 * Что важно знать:
 *  - это ТОЛЬКО просьба «проверь напоминания»: содержимое данных не передаётся;
 *  - если у токена нет права запускать проверки (Actions: write) — приложение молчит,
 *    а факт попытки виден в журнале диагностики (`wake`);
 *  - настройки «будильника» лежат рядом с публичным ключом push (part of public/vapid.json):
 *    они не секретные, зато меняются без пересборки приложения;
 *  - не чаще одной просьбы в минуту и только когда приложение открыто: семейные данные
 *    не должны превращаться в поток запусков.
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

let lastWakeAt = 0;

/** Только для тестов: сбрасывает ограничение частоты между проверками. */
export function resetWakeThrottle(): void {
  lastWakeAt = 0;
}

async function loadWakeConfig(): Promise<WakeConfig | null> {
  try {
    const res = await fetch(new URL('vapid.json', document.baseURI).href);
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
 * механизм, его сбой не должен мешать синхронизации. Возвращает true только при 204.
 */
export async function wakePushSender(reason: string): Promise<boolean> {
  if (Date.now() - lastWakeAt < WAKE_MIN_INTERVAL_MS) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const cfg = await loadWakeConfig();
  if (!cfg) return false;
  const token = await auth.getToken();
  if (!token) return false;

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
    const ok = res.status === 204;
    log.emit({ type: 'wake', ok, reason });
    return ok;
  } catch {
    log.emit({ type: 'wake', ok: false, reason });
    return false;
  }
}
