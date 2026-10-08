/**
 * Инициализация приложения: сессия, тема, порты синхронизации, Service Worker.
 * Отдельный модуль, чтобы main.tsx оставался тонким, а порядок инициализации — явным.
 */
import {
  kvGet,
  kvSet,
  KV_KEYS,
  requestPersistentStorage,
  localEntities,
  baseSnapshot,
  writeMerged,
} from '../data/db';
import { loadSession, updateProfile } from '../data/session';
import { auth } from '../data/remote/authStrategy';
import {
  createPorts,
  setPorts,
  startAutoSync,
  refreshPending,
  type LocalStorePort,
} from '../data/sync/engine';
import type { EntityKind, Syncable } from '../domain/types';
import { setSyncState } from '../data/sync/state';
import { initTheme, type ThemeMode } from './theme';
import { log } from '../shared/log';

export interface AppConfig {
  theme: ThemeMode;
  deviceId: string;
  profileName: string;
  remote: { owner: string; repo: string; branch: string } | null;
  hasToken: boolean;
  /** navigator.storage.persist() реально сработал (важно для Safari 17+, факт F8). */
  persistedStorage: boolean;
}

/**
 * Читает настройку удалённого репозитория и, если токен и репозиторий заданы,
 * подключает RemoteStore. Без них приложение остаётся в полностью рабочем
 * ЛОКАЛЬНОМ РЕЖИМЕ (§2.5) — это первый экран, а не аварийный.
 */
export async function configureRemote(): Promise<boolean> {
  const owner = await kvGet<string>(KV_KEYS.remoteOwner);
  const repo = await kvGet<string>(KV_KEYS.remoteRepo);
  const branch = (await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main';
  const token = await auth.getToken();

  if (!owner || !repo || !token) {
    setPorts(makeLocalPort(), null);
    setSyncState({ configured: false, phase: 'not-configured' });
    return false;
  }

  const ports = createPorts(() => auth.getToken(), { owner, repo, branch });
  setPorts(ports.local, ports.remote);
  setSyncState({ configured: true });
  return true;
}

function makeLocalPort(): LocalStorePort {
  return {
    read: <T extends Syncable>(kind: EntityKind) => localEntities<T>(kind),
    readBase: (kind: EntityKind) => baseSnapshot(kind),
    write: <T extends Syncable>(kind: EntityKind, merged: Record<string, T>, at: string) =>
      writeMerged<T>(kind, merged, at),
  };
}

/** Храним остановку автосинхронизации. Объявлено до bootstrap(), чтобы исключить TDZ. */
let stopAutoSync: (() => void) | null = null;

export async function bootstrap(): Promise<AppConfig> {
  const theme = await initTheme();
  const session = await loadSession();

  // Имя по умолчанию — чтобы лента и updatedBy не были пустыми с первого запуска.
  if (!session.name) {
    await updateProfile({ name: 'Я' });
  }

  const persisted = await requestPersistentStorage();
  const configured = await configureRemote();
  await refreshPending();

  if (configured) {
    stopAutoSync = startAutoSync();
  }

  return {
    theme,
    deviceId: session.deviceId,
    profileName: (await kvGet<string>(KV_KEYS.profileName)) ?? 'Я',
    remote: configured
      ? {
          owner: (await kvGet<string>(KV_KEYS.remoteOwner))!,
          repo: (await kvGet<string>(KV_KEYS.remoteRepo))!,
          branch: (await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main',
        }
      : null,
    hasToken: Boolean(await auth.getToken()),
    persistedStorage: persisted,
  };
}

/** Перезапуск автосинхронизации после подключения/отключения репозитория. */
export async function restartSync(): Promise<boolean> {
  const configured = await configureRemote();
  stopAutoSync?.();
  stopAutoSync = configured ? startAutoSync() : null;
  if (!configured) await refreshPending();
  return configured;
}

/** Регистрация Service Worker — только в production-сборке (§6.1). */
type PeriodicSyncManager = {
  register(tag: string, options: { minInterval: number }): Promise<void>;
};

async function registerPeriodicReminders(reg: ServiceWorkerRegistration): Promise<void> {
  try {
    const withPeriodic = reg as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager };
    if (!withPeriodic.periodicSync) return; // iPhone/Safari: канала нет, напоминания в приложении
    const status = await navigator.permissions?.query({
      name: 'periodic-background-sync' as PermissionName,
    });
    if (status && status.state !== 'granted') return;
    await withPeriodic.periodicSync.register('fh-reminders', {
      minInterval: 12 * 60 * 60 * 1000,
    });
  } catch {
    // Не поддержано или не разрешено: напоминания остаются в приложении — не ошибка.
  }
}

/** Регистрация SW, полученная при запуске: нужна для ручной и фоновой проверки обновлений. */
let swRegistration: ServiceWorkerRegistration | null = null;
let lastUpdateCheckAt = 0;
/** Как часто проверять обновления сами, без действий человека. */
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function noteUpdateAvailable(): void {
  log.emit({ type: 'app:update-available' });
  window.dispatchEvent(new CustomEvent('fh:update-available'));
}

/**
 * Есть ли уже установленное, но ещё не применённое обновление.
 *
 * Раньше плашка «Доступна новая версия» появлялась только если обновление нашлось
 * во время открытой сессии (`updatefound`). Если человек закрыл приложение в момент
 * установки, обновление ждало в `reg.waiting`, и плашки не было вовсе — обновление
 * применялось молча при следующем открытии (вопрос владельца 07.10.2026).
 */
export function updateAvailableFrom(
  reg: { waiting?: object | null; installing?: object | null },
  hasController: boolean,
): boolean {
  return hasController && Boolean(reg.waiting || reg.installing);
}

/**
 * Проверить обновление прямо сейчас (кнопка на странице «Для разработчика»).
 * `found` — новая версия ставится, плашка «Обновить» появится сверху.
 */
export async function checkForUpdate(): Promise<'found' | 'current' | 'unavailable'> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return 'unavailable';
  const reg = swRegistration ?? (await navigator.serviceWorker.getRegistration());
  if (!reg) return 'unavailable';
  try {
    await reg.update();
  } catch {
    // Нет сети или проверка не удалась — это не ошибка приложения.
    return 'unavailable';
  }
  lastUpdateCheckAt = Date.now();
  if (updateAvailableFrom(reg, Boolean(navigator.serviceWorker.controller))) {
    noteUpdateAvailable();
    return 'found';
  }
  return 'current';
}

/** Следим за установкой новой версии: как только она готова — показываем плашку. */
function watchInstalling(reg: ServiceWorkerRegistration): void {
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    if (!nw) return;
    nw.addEventListener('statechange', () => {
      if (nw.state === 'installed' && navigator.serviceWorker.controller) noteUpdateAvailable();
    });
  });
}

export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
    swRegistration = reg;
    lastUpdateCheckAt = Date.now();
    // Periodic Background Sync (Android/Chrome, установленная PWA): браузер сам
    // будит Service Worker раз в ~12 часов — напоминания о сроках приходят даже
    // при закрытом приложении и выключенном экране, БЕЗ сервера и БЕЗ ветки main
    // (решение владельца 2026-10-01). Интервал выбирает Chrome по своей политике.
    void registerPeriodicReminders(reg);

    watchInstalling(reg);

    // Обновление уже скачано раньше и ждёт своей очереди — говорим об этом сразу.
    if (updateAvailableFrom(reg, Boolean(navigator.serviceWorker.controller)))
      noteUpdateAvailable();

    // Возвращение к приложению — удобный момент проверить обновление (не чаще 15 минут).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
      lastUpdateCheckAt = Date.now();
      void reg.update().catch(() => undefined);
    });
  } catch (e) {
    // Не роняем приложение: SW — улучшение, а не обязательное условие работы.
    log.emit({
      type: 'sync:error',
      kind: 'shopping',
      code: 'sw-register-failed',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function setRemoteConfig(owner: string, repo: string, branch: string): Promise<void> {
  await kvSet(KV_KEYS.remoteOwner, owner.trim());
  await kvSet(KV_KEYS.remoteRepo, repo.trim());
  await kvSet(KV_KEYS.remoteBranch, (branch || 'main').trim());
  await restartSync();
}

export async function clearRemoteConfig(): Promise<void> {
  await kvSet(KV_KEYS.remoteOwner, '');
  await kvSet(KV_KEYS.remoteRepo, '');
  await restartSync();
}
