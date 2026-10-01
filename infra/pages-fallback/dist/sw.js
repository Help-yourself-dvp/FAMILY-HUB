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
      if (failed > 0) console.warn(`[sw] не закэшировано файлов: ${failed} из ${manifest.precache.length}`);

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
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = (await caches.match(req)) || (await caches.match(new URL('index.html', self.registration.scope).href));
          return cached || Response.error();
        }
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
