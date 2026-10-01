/**
 * Инициализация приложения: сессия, тема, порты синхронизации, Service Worker.
 * Отдельный модуль, чтобы main.tsx оставался тонким, а порядок инициализации — явным.
 */
import { kvGet, kvSet, KV_KEYS, requestPersistentStorage, localEntities, baseSnapshot, writeMerged } from '../data/db';
import { loadSession, updateProfile } from '../data/session';
import { auth } from '../data/remote/authStrategy';
import { createPorts, setPorts, startAutoSync, refreshPending, type LocalStorePort } from '../data/sync/engine';
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
export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          log.emit({ type: 'app:update-available' });
          window.dispatchEvent(new CustomEvent('fh:update-available'));
        }
      });
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
