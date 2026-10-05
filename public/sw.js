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
    const reply = { type: 'PONG', at: new Date().toISOString(), notificationsRevision: 2 };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
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

  // Настройки приложения (vapid.json) — ВСЕГДА сначала из сети, даже если копия уже
  // лежит в кэше. Здесь адреса возможностей (лента, «будильник»); устаревшая копия
  // заставляла бы приложение считать, что владелец их ещё не настроил, и показывать
  // ошибку вместо ссылки. Кэш остаётся только запасным вариантом для офлайна.
  if (url.pathname.endsWith('/vapid.json')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const hit = await cache.match(req);
        try {
          const res = await fetch(req, { cache: 'no-store' });
          if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
          return res;
        } catch {
          return hit || Response.error();
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

/** Логотип владельца и производная одноцветная маска, только свой origin/scope.
 * Те же пути в src/notifications/appearance.ts; совпадение покрыто тестами.
 * ОС может оставить атрибуцию Chrome/скрыть содержимое на lock screen. */
function notificationAppearance() {
  return {
    icon: new URL('icons/icon-192.png', self.registration.scope).href,
    badge: new URL('icons/notification-badge-96.png', self.registration.scope).href,
    lang: 'ru',
    dir: 'ltr',
  };
}

/* Настоящий Web Push: может сработать без открытой страницы.
   Служебное подтверждение содержит только счётчики и время, НЕ текст уведомления.
   Ошибка IndexedDB не должна помешать показу. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    data = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    data = { title: 'Family Hub', body: event.data ? event.data.text() : '' };
  }
  const n = data.notification && typeof data.notification === 'object' ? data.notification : data;
  const title = typeof n.title === 'string' && n.title ? n.title : 'Family Hub';
  const tag = n.tag || data.tag || data.id;
  const isTest = data.kind === 'push-test';
  event.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(title, {
          ...notificationAppearance(),
          body: typeof n.body === 'string' ? n.body : '',
          tag: typeof tag === 'string' ? tag : undefined,
          data: { route: n.navigate || data.route || '#/', source: 'web-push', isTest },
        });
      } catch (error) {
        await recordNotificationDelivery('web-push', false);
        throw error;
      }
      // Совпадает с маркером sender: ID.дата.ступень.json. При открытии
      // приложения не повторяем уже обработанный здесь push локальным каналом.
      const marker =
        !isTest && typeof tag === 'string' && tag.length <= 250 ? 'remind.push.' + tag : null;
      await recordNotificationDelivery('web-push', true, marker);
    })(),
  );
});

/** Разрешены только наши hash-разделы, а не сторонний URL из payload. */
function notificationTarget(route) {
  const base = new URL(self.registration.scope);
  const fallback = new URL('#/', base).href;
  try {
    const target = new URL(typeof route === 'string' ? route : '#/', base);
    const section = target.hash.slice(1).split('?')[0];
    const insideApp =
      target.origin === base.origin &&
      (target.pathname === base.pathname || target.pathname === base.pathname + 'index.html');
    const allowed = ['', '/', '/shopping', '/tasks', '/deadlines', '/settings'].includes(section);
    return insideApp && allowed ? target.href : fallback;
  } catch {
    return fallback;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data && event.notification.data.route;
  const target = notificationTarget(route);
  event.waitUntil(
    (async () => {
      const base = new URL(self.registration.scope);
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        try {
          const url = new URL(client.url);
          // Не перехватываем вкладку другого PWA на том же github.io origin.
          if (
            url.origin !== base.origin ||
            (url.pathname !== base.pathname && url.pathname !== base.pathname + 'index.html') ||
            typeof client.focus !== 'function'
          )
            continue;
          if (client.url !== target) {
            if (typeof client.navigate !== 'function') continue;
            if (!(await client.navigate(target))) continue;
          }
          return await client.focus();
        } catch {
          // Закрытая вкладка / недоступная навигация: пробуем другую или новую.
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

/**
 * Одна чистая политика для приложения и Node sender. Без базы/сети/логов.
 * Открытое назначенное дело: отдельное назначение другим и дата сегодня.
 * Поля assignmentId/assignedBy optional: старые записи не дают ложную рассылку назначений.
 */
function taskNotificationEvents(task, recipientIds, today) {
  if (
    !task ||
    task.deletedAt ||
    task.status !== 'open' ||
    !task.assigneeId ||
    !recipientIds.includes(task.assigneeId)
  )
    return [];
  const recipient = task.assigneeId;
  const events = [];
  if (
    typeof task.assignmentId === 'string' &&
    task.assignmentId &&
    typeof task.assignedBy === 'string' &&
    task.assignedBy &&
    !recipientIds.includes(task.assignedBy)
  ) {
    events.push({
      kind: 'assigned',
      tag: `task.${task.id}.${recipient}.assigned.${task.assignmentId}.json`,
      title: 'Family Hub: вам назначено дело',
      body: `Вам назначено дело «${task.title}».`,
      route: '#/tasks',
    });
  }
  if (task.dueDate === today) {
    events.push({
      kind: 'due',
      tag: `task.${task.id}.${recipient}.due.${task.dueDate}.json`,
      title: 'Family Hub: дело на сегодня',
      body: `Сегодня нужно выполнить «${task.title}».`,
      route: '#/tasks',
    });
  }
  return events;
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
    const tasks = await idbGetAll(db, 'tasks');
    const kvRows = await idbGetAll(db, 'kv');
    const marked = new Set();
    const deviceId = kvRows.find((row) => row.key === 'device.id')?.value;
    const memberId = kvRows.find((row) => row.key === 'profile.memberId')?.value;
    const recipientIds = [deviceId, memberId].filter((id) => typeof id === 'string' && id);
    for (const row of kvRows) {
      if (typeof row.key === 'string' && row.key.startsWith('remind.') && row.value === true)
        marked.add(row.key);
    }
    const from = moscowToday();
    for (const d of deadlines) {
      if (!d || d.deletedAt || d.visibility === 'private' || !d.dueDate) continue;
      const steps = Array.isArray(d.remindersDays) ? d.remindersDays : [];
      const left = daysUntilUtc(d.dueDate, from);
      const hits = left < 0 ? (steps.length ? ['overdue'] : []) : steps.filter((r) => r === left);
      for (const hit of hits) {
        const marker = 'remind.sw.' + d.id + '.' + d.dueDate + '.' + String(hit);
        const stem = d.id + '.' + d.dueDate + '.' + String(hit);
        if (
          marked.has(marker) ||
          marked.has('remind.push.' + stem + '.json') ||
          (typeof deviceId === 'string' && marked.has('remind.' + deviceId + '.' + stem))
        )
          continue;
        const body =
          hit === 'overdue'
            ? 'Срок «' + d.title + '» прошёл — проверьте, что сделано.'
            : hit === 0
              ? 'Сегодня срок: «' + d.title + '».'
              : '«' + d.title + '»: осталось ' + hit + ' дн. (до ' + d.dueDate + ').';
        try {
          await self.registration.showNotification('Family Hub: срок', {
            ...notificationAppearance(),
            body,
            tag: marker,
            data: { route: '#/deadlines', source: 'periodic-background' },
          });
        } catch (error) {
          await recordNotificationDelivery('periodic-background', false);
          throw error;
        }
        await idbPut(db, 'kv', { key: marker, value: true });
        await recordNotificationDelivery('periodic-background', true);
        marked.add(marker);
      }
    }
    for (const task of tasks) {
      for (const event of taskNotificationEvents(task, recipientIds, from)) {
        const marker = 'remind.sw.' + event.tag;
        if (
          marked.has(marker) ||
          marked.has('remind.task.' + event.tag) ||
          marked.has('remind.push.' + event.tag)
        )
          continue;
        try {
          await self.registration.showNotification(event.title, {
            ...notificationAppearance(),
            body: event.body,
            tag: event.tag,
            data: { route: '#/tasks', source: 'periodic-background' },
          });
        } catch (error) {
          await recordNotificationDelivery('periodic-background', false);
          throw error;
        }
        await idbPut(db, 'kv', { key: marker, value: true });
        await recordNotificationDelivery('periodic-background', true);
        marked.add(marker);
      }
    }
  } finally {
    db.close();
  }
}

/**
 * Контракт с src/notifications/deliveryState.ts. Только whitelisted поля;
 * текст, endpoint, ID срока и ключи в диагностическую запись не попадают.
 */
async function recordNotificationDelivery(source, shown, marker = null) {
  let db;
  try {
    db = await openFamilyDb();
    if (!db.objectStoreNames.contains('kv')) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      const key = 'notify.delivery.' + source;
      const req = store.get(key);
      req.onsuccess = () => {
        const previous = req.result?.value || {};
        const count = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);
        const at = new Date().toISOString();
        store.put({
          key,
          value: {
            receivedCount: count(previous.receivedCount) + 1,
            shownCount: count(previous.shownCount) + (shown ? 1 : 0),
            lastReceivedAt: at,
            lastShownAt: shown ? at : previous.lastShownAt || null,
          },
        });
        if (shown && marker) store.put({ key: marker, value: true });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Служебный счётчик не важнее самого уведомления.
  } finally {
    if (db) db.close();
  }
}
