/*
  Service Worker Family Hub (ТЗ §10).

  Стратегия:
   - app shell кэшируется при установке по списку из app-shell.json;
   - навигация: network-first с откатом в кэш → приложение открывается офлайн (§6);
   - статика того же origin: stale-while-revalidate → мгновенный старт;
   - api.github.com: ТОЛЬКО сеть, никогда не кэшируется. Кэширование ответов API
     означало бы хранение семейных данных в Cache API и показ устаревшего состояния;
   - обновление: НЕ skipWaiting автоматически. Приложение показывает «Доступна новая
     версия» и само отправляет SKIP_WAITING, когда пользователь согласен. Иначе
     обновление может подменить ресурсы под работающей страницей.

  iOS: установленное на Home Screen web-приложение исключено из 7-дневной очистки
  хранилища Safari (docs/RESEARCH.md, факт F8).
*/
const SHELL_URL = new URL('app-shell.json', self.registration.scope).href;
const SHELL_CACHE_PREFIX = 'fh-shell-';
const RUNTIME_CACHE = 'fh-runtime-v1';
// Предел ожидания сети при навигации: офлайн-старт важнее свежести (§6).
const NAV_TIMEOUT_MS = 4000;

// api.github.com и любые чужие origin — никогда не кэшируем.
function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      let manifest;
      try {
        const res = await fetch(SHELL_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`app-shell.json: HTTP ${res.status}`);
        manifest = await res.json();
      } catch (e) {
        // Без списка precache offline-режим неполноценен, но приложение должно
        // установиться. Пишем причину — её покажет экран «Диагностика».
        console.warn('[sw] не удалось прочитать app-shell.json:', e && e.message);
        manifest = { buildId: 'fallback-' + Date.now(), precache: ['index.html'] };
      }

      const cacheName = SHELL_CACHE_PREFIX + manifest.buildId;
      const cache = await caches.open(cacheName);

      // Кэшируем по одному: addAll() откатывается целиком при одной ошибке,
      // а нам важнее сохранить максимум, чем ничего.
      const results = await Promise.allSettled(
        manifest.precache.map((p) => cache.add(new URL(p, self.registration.scope).href)),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0)
        console.warn(`[sw] не закэшировано файлов: ${failed} из ${manifest.precache.length}`);

      await caches.open(RUNTIME_CACHE);
      self.skipWaitingOnDemand = cacheName;
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const current = self.skipWaitingOnDemand;
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(SHELL_CACHE_PREFIX) && k !== current)
          .map((k) => caches.delete(k)),
      );
      // Runtime-кэш накапливал ассеты ВСЕХ прежних версий (хэшированные js/css,
      // иконки со старыми ?v=): «память сайтов» росла с каждым обновлением
      // (приёмка 0.1.8: 11 МБ). Ядро приложения лежит в shell-кэше текущей версии,
      // поэтому runtime безопасно пересоздать: недостающее докатится само.
      await caches.delete(RUNTIME_CACHE);
      await caches.open(RUNTIME_CACHE);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data && data.type === 'PING') {
    event.source && event.source.postMessage({ type: 'PONG', at: new Date().toISOString() });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!isSameOrigin(url)) return; // в т.ч. api.github.com — только сеть

  if (req.mode === 'navigate') {
    // Network-first с ПРЕДЕЛОМ ожидания (приёмка 0.1.5): свайп-обновление при
    // подвисшем github.io раньше держало страницу мёртвой ~30 секунд. Теперь через
    // 4 секунды открываемся из кэша, а сеть догонит в фоне или в следующий запуск.
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => null);
        const fresh = await Promise.race([
          network,
          new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS)),
        ]);
        if (fresh) return fresh;
        if (cached) {
          void network; // догоняющее обновление кэша
          return cached;
        }
        return (await network) || Response.error();
      })(),
    );
    return;
  }

  // Статика: stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      return hit || network || Response.error();
    })(),
  );
});

/* Web Push (ТЗ §11). Обработчик зарегистрирован сейчас, но реальная доставка
   включается на ЭТАПЕ 3 после проверки на устройствах.
   iOS 18.4+ поддерживает Declarative Web Push: при наличии ключа "web_push": 8030
   система показывает уведомление сама, не пробуждая SW (факт F8 в RESEARCH.md).
   Поэтому в payload будем класть обе формы — каждый браузер возьмёт свою.
   ВАЖНО: silent push на iOS запрещён — каждое сообщение обязано быть видимым. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Family Hub', body: event.data ? event.data.text() : '' };
  }
  const n = data.notification || data;
  const title = n.title || 'Family Hub';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: n.body || '',
      tag: n.tag || data.id || undefined,
      lang: 'ru',
      data: { route: n.navigate || data.route || './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.route) || './';
  const target = new URL(route, self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) {
          await c.navigate(target);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })(),
  );
});

// Подписка могла стать недействительной (iOS отзывает подписки, факт F7).
// Сообщаем приложению, чтобы оно обновило запись в devices.json.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const c of clients) c.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
    })(),
  );
});

/* ---------------------------------------------------------------------------
 * Фоновые напоминания о сроках БЕЗ сервера (Android, Periodic Background Sync).
 * Chrome будит SW примерно раз в 12 часов; мы читаем локальную базу, находим
 * сработавшие сегодня ступени и показываем системное уведомление — работает при
 * закрытом приложении и выключенном экране. Каждое напоминание — строго один раз
 * (маркеры в kv того же IndexedDB «family-hub»).
 * ------------------------------------------------------------------------- */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'fh-reminders') {
    event.waitUntil(checkRemindersOffline());
  }
});

function openFamilyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('family-hub');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db, store) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function moscowToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
}

function daysUntilUtc(due, from) {
  const a = new Date(from + 'T12:00:00Z').getTime();
  const b = new Date(due + 'T12:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

async function checkRemindersOffline() {
  let db;
  try {
    db = await openFamilyDb();
  } catch {
    return; // базы нет — напоминать некому
  }
  try {
    const deadlines = await idbGetAll(db, 'deadlines');
    const kvRows = await idbGetAll(db, 'kv');
    const marked = new Set();
    for (const row of kvRows) {
      if (typeof row.key === 'string' && row.key.startsWith('remind.sw.')) marked.add(row.key);
    }
    const from = moscowToday();
    for (const d of deadlines) {
      if (!d || d.deletedAt || d.visibility === 'private' || !d.dueDate) continue;
      const steps = Array.isArray(d.remindersDays) ? d.remindersDays : [];
      const left = daysUntilUtc(d.dueDate, from);
      const hits = left < 0 ? (steps.length ? ['overdue'] : []) : steps.filter((r) => r === left);
      for (const hit of hits) {
        const marker = 'remind.sw.' + d.id + '.' + d.dueDate + '.' + String(hit);
        if (marked.has(marker)) continue;
        const body =
          hit === 'overdue'
            ? 'Срок «' + d.title + '» прошёл — проверьте, что сделано.'
            : hit === 0
              ? 'Сегодня срок: «' + d.title + '».'
              : '«' + d.title + '»: осталось ' + hit + ' дн. (до ' + d.dueDate + ').';
        await self.registration.showNotification('Family Hub: срок', {
          body,
          tag: marker,
          lang: 'ru',
          data: { route: '#/deadlines' },
        });
        await idbPut(db, 'kv', { key: marker, value: true });
        marked.add(marker);
      }
    }
  } finally {
    db.close();
  }
}
