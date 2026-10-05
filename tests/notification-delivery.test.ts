/**
 * Поведение настоящего SW и foreground-канала на вымышленных данных.
 * Исходник SW — Vite ?raw, не node:fs. Сеть запрещена, IndexedDB тестовая.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import swSource from '../public/sw.js?raw';
import { db, kvGet, kvSet, KV_KEYS } from '../src/data/db';
import { loadSession } from '../src/data/session';
import { notificationChannels } from '../src/notifications/channels';
import {
  deliveryKey,
  notificationDeliverySnapshot,
  readDeliveryReceipt,
} from '../src/notifications/deliveryState';
import { runReminderCheck } from '../src/notifications/remindersWatch';
import { taskNotificationEvents } from '../src/domain/taskNotificationRules.mjs';
import { runTaskNotificationCheck } from '../src/notifications/tasksWatch';
import { notificationAppearance } from '../src/notifications/appearance';
import type { Deadline, Task } from '../src/domain/types';

const SCOPE = 'https://fixture.example/FAMILY-HUB/';
const DUE = '2026-10-02';
const PUSH_TAG = `fixture-deadline.${DUE}.0.json`;
const foregroundShow = vi.fn<(title: string, options: NotificationOptions) => Promise<void>>();

interface WorkerClient {
  url: string;
  focus: () => Promise<unknown>;
  navigate?: (url: string) => Promise<unknown>;
}

function worker(storage?: Pick<IDBFactory, 'open'>) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const show = vi
    .fn<(title: string, options: NotificationOptions) => Promise<void>>()
    .mockResolvedValue();
  const matchAll = vi.fn<() => Promise<WorkerClient[]>>().mockResolvedValue([]);
  const openWindow = vi.fn<(url: string) => Promise<unknown>>().mockResolvedValue(null);
  const self = {
    registration: { scope: SCOPE, showNotification: show },
    location: { origin: 'https://fixture.example' },
    clients: { matchAll, openWindow },
    addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
      handlers.set(name, handler);
    },
  };
  // В тесте исполняем обычный JS с закрытой сетью и явными заглушками SW API.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Только тест: наш SW ?raw, браузер и сеть заменены заглушками. В приложение eval не попадает.
  const execute = new Function(
    'self',
    'URL',
    'Date',
    'indexedDB',
    'setTimeout',
    'fetch',
    'caches',
    swSource,
  ) as (...args: unknown[]) => void;
  execute(
    self,
    URL,
    Date,
    storage ?? indexedDB,
    setTimeout,
    () => {
      throw new Error('Сеть в тесте запрещена');
    },
    {},
  );
  const fire = async (name: string, fields: Record<string, unknown>) => {
    const tasks: Promise<unknown>[] = [];
    handlers.get(name)!({ ...fields, waitUntil: (task: Promise<unknown>) => tasks.push(task) });
    await Promise.all(tasks);
  };
  const push = (patch: Record<string, unknown> = {}) =>
    fire('push', {
      data: {
        json: () => ({
          title: 'Учебное уведомление',
          body: 'Вымышленный текст',
          route: '#/deadlines',
          tag: PUSH_TAG,
          ...patch,
        }),
      },
    });
  const click = async (route: string) => {
    const close = vi.fn();
    await fire('notificationclick', { notification: { data: { route }, close } });
    expect(close).toHaveBeenCalledOnce();
  };
  return { show, matchAll, openWindow, fire, push, click };
}

function deadline(): Deadline {
  return {
    id: 'fixture-deadline',
    kind: 'deadlines',
    rev: 1,
    createdAt: '2026-10-02T09:00:00Z',
    updatedAt: '2026-10-02T09:00:00Z',
    updatedBy: 'fixture-device',
    deletedAt: null,
    title: 'Учебный срок',
    deadlineKind: 'custom',
    dueDate: DUE,
    remindersDays: [0],
    recurrence: { type: 'none' },
    lastCompletedAt: null,
    history: [],
    visibility: 'family',
    note: null,
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T09:00:00Z'));
  await Promise.all([db.kv.clear(), db.deadlines.clear(), db.tasks.clear(), db.members.clear()]);
  const session = await loadSession();
  await kvSet(KV_KEYS.deviceId, session.deviceId);
  foregroundShow.mockReset().mockResolvedValue();
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('navigator', {
    userAgent: 'fixture-browser',
    serviceWorker: {
      getRegistration: vi
        .fn()
        .mockResolvedValue({ scope: SCOPE, showNotification: foregroundShow }),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('источник уведомления и переход по нажатию', () => {
  it('foreground получает логотип/статусный значок владельца из scope, сохраняет route', async () => {
    await notificationChannels.byId('local-foreground')!.deliver([
      {
        id: 'fixture-branded',
        title: 'Family Hub: срок',
        body: 'Учебный текст',
        route: '#/deadlines',
        createdAt: '2026-10-02T09:00:00Z',
      },
    ]);
    expect(foregroundShow.mock.calls[0]?.[1]).toMatchObject(notificationAppearance(SCOPE));
    expect(foregroundShow.mock.calls[0]?.[1]).toMatchObject({ data: { route: '#/deadlines' } });
  });

  it('push не подставляет чужой icon из payload и получает собственное оформление', async () => {
    const sw = worker();
    await sw.push({
      icon: 'https://unrelated.invalid/icon.png',
      badge: 'https://unrelated.invalid/badge.png',
    });
    expect(sw.show.mock.calls[0]?.[1]).toMatchObject(notificationAppearance(SCOPE));
    expect(sw.show.mock.calls[0]?.[1]).toMatchObject({
      data: { source: 'web-push', route: '#/deadlines' },
    });
  });

  it('PBS оформляется тем же значком, что push/foreground', async () => {
    await db.deadlines.put(deadline());
    const sw = worker();
    await sw.fire('periodicsync', { tag: 'fh-reminders' });
    expect(sw.show.mock.calls[0]?.[1]).toMatchObject(notificationAppearance(SCOPE));
  });

  it('ресурсы оформления не привязаны жёстко к GitHub Pages и не имеют внешнего origin', () => {
    expect(notificationAppearance('https://fixture.example/').icon).toBe(
      'https://fixture.example/icons/icon-192.png',
    );
    expect(notificationAppearance(SCOPE).badge).toBe(`${SCOPE}icons/notification-badge-96.png`);
  });

  it('PING подтверждает возможности активного SW, без данных уведомлений', async () => {
    const sw = worker();
    const postMessage = vi.fn();
    await sw.fire('message', { data: { type: 'PING' }, ports: [{ postMessage }] });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'PONG',
      at: '2026-10-02T09:00:00.000Z',
      notificationsRevision: 2,
    });
  });

  it('foreground сохраняет маршрут события и отдельно считает свой показ', async () => {
    await notificationChannels.byId('local-foreground')!.deliver([
      {
        id: 'fixture-event',
        title: 'Учебное уведомление',
        body: 'Учебный текст',
        route: '#/settings',
        createdAt: '2026-10-02T09:00:00Z',
      },
    ]);
    expect(foregroundShow.mock.calls[0]?.[1]).toMatchObject({
      data: { route: '#/settings', source: 'local-foreground' },
    });
    expect((await readDeliveryReceipt('local-foreground')).shownCount).toBe(1);
    expect((await readDeliveryReceipt('web-push')).receivedCount).toBe(0);
  });

  it('push записывает безопасное подтверждение и маркер только после успешного показа', async () => {
    const sw = worker();
    await sw.push();
    expect(sw.show.mock.calls[0]?.[1]).toMatchObject({
      data: { route: '#/deadlines', source: 'web-push' },
      tag: PUSH_TAG,
    });
    expect(await readDeliveryReceipt('web-push')).toEqual({
      receivedCount: 1,
      shownCount: 1,
      lastReceivedAt: '2026-10-02T09:00:00.000Z',
      lastShownAt: '2026-10-02T09:00:00.000Z',
    });
    expect(await kvGet(`remind.push.${PUSH_TAG}`)).toBe(true);
  });

  it('проверочный push приходит независимо от foreground и не пишет маркер срока', async () => {
    await db.deadlines.put(deadline());
    expect(await runReminderCheck()).toBe(1);
    const sw = worker();
    const tag = 'fh-push-test-fixture';
    await sw.push({ kind: 'push-test', tag, route: '#/settings' });
    expect(sw.show).toHaveBeenCalledOnce();
    expect(sw.show.mock.calls[0]?.[1]).toMatchObject({
      data: { source: 'web-push', isTest: true, route: '#/settings' },
    });
    expect(await kvGet(`remind.push.${tag}`)).toBeUndefined();
    expect((await readDeliveryReceipt('web-push')).receivedCount).toBe(1);
  });

  it('неуспешный показ push не отмечается отправленным на устройстве', async () => {
    const sw = worker();
    sw.show.mockRejectedValue(new Error('Учебная ошибка показа'));
    await expect(sw.push()).rejects.toThrow('Учебная ошибка показа');
    expect((await readDeliveryReceipt('web-push')).receivedCount).toBe(1);
    expect((await readDeliveryReceipt('web-push')).shownCount).toBe(0);
    expect(await kvGet(`remind.push.${PUSH_TAG}`)).toBeUndefined();
  });

  it('сбой служебного хранилища не блокирует само уведомление', async () => {
    const sw = worker({
      open: () => {
        throw new Error('Учебная ошибка IndexedDB');
      },
    });
    await sw.push();
    expect(sw.show).toHaveBeenCalledOnce();
  });

  it('нажатие запускает закрытое приложение сразу в разделе источника', async () => {
    const sw = worker();
    await sw.click('#/deadlines');
    expect(sw.openWindow).toHaveBeenCalledWith(`${SCOPE}#/deadlines`);
  });

  it('нажатие использует только окно Family Hub, не вкладку другого PWA', async () => {
    const sw = worker();
    const unrelated = {
      url: 'https://fixture.example/OTHER/',
      focus: vi.fn().mockResolvedValue(null),
      navigate: vi.fn().mockResolvedValue(null),
    };
    const focus = vi.fn().mockResolvedValue(null);
    const navigate = vi.fn().mockResolvedValue({});
    sw.matchAll.mockResolvedValue([unrelated, { url: `${SCOPE}#/shopping`, focus, navigate }]);
    await sw.click('#/deadlines');
    expect(unrelated.navigate).not.toHaveBeenCalled();
    expect(unrelated.focus).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`${SCOPE}#/deadlines`);
    expect(focus).toHaveBeenCalledOnce();
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it('недоступная навигация существующего окна открывает новое', async () => {
    const sw = worker();
    sw.matchAll.mockResolvedValue([
      {
        url: SCOPE,
        focus: vi.fn().mockResolvedValue(null),
        navigate: vi.fn().mockRejectedValue(new Error('Вкладка закрылась')),
      },
    ]);
    await sw.click('#/settings');
    expect(sw.openWindow).toHaveBeenCalledWith(`${SCOPE}#/settings`);
  });

  it('сторонний адрес из уведомления не открывается', async () => {
    const sw = worker();
    await sw.click('https://unrelated.invalid/');
    expect(sw.openWindow).toHaveBeenCalledWith(`${SCOPE}#/`);
  });
});

describe('напоминания не теряются и не повторяют другой канал', () => {
  it('PBS задач использует те же адресные события/теги, не broadcast; foreground не повторяет', async () => {
    const self = await loadSession();
    const current: Task = {
      id: 'task-fixture',
      kind: 'tasks',
      rev: 1,
      createdAt: '2026-10-02T09:00:00Z',
      updatedAt: '2026-10-02T09:00:00Z',
      updatedBy: 'fixture-other',
      deletedAt: null,
      title: 'Учебная задача',
      note: null,
      assigneeId: self.deviceId,
      dueDate: null,
      status: 'open',
      doneAt: null,
      recurrence: { type: 'none' },
      assignmentId: 'assign-fixture',
      assignedBy: 'fixture-other',
    };
    await db.tasks.bulkPut([
      current,
      { ...current, id: 'unassigned', assigneeId: null },
      { ...current, id: 'peer-task', assigneeId: 'peer' },
    ]);
    const sw = worker();
    await sw.fire('periodicsync', { tag: 'fh-reminders' });
    expect(sw.show).toHaveBeenCalledOnce();
    expect(sw.show.mock.calls[0]?.[1]).toMatchObject({
      tag: taskNotificationEvents(current, [self.deviceId], DUE)[0]?.tag,
      data: { route: '#/tasks' },
    });
    expect(await runTaskNotificationCheck()).toBe(0);
    await sw.fire('periodicsync', { tag: 'fh-reminders' });
    expect(sw.show).toHaveBeenCalledOnce();
  });

  it('foreground не дублирует уже полученный Web Push при открытии', async () => {
    await db.deadlines.put(deadline());
    await worker().push();
    expect(await runReminderCheck()).toBe(0);
    expect(foregroundShow).not.toHaveBeenCalled();
  });

  it('после сбоя foreground напоминание не помечается показанным и повторяется успешно', async () => {
    await db.deadlines.put(deadline());
    foregroundShow.mockRejectedValueOnce(new Error('Учебный сбой'));
    expect(await runReminderCheck()).toBe(0);
    expect(await runReminderCheck()).toBe(1);
    expect(foregroundShow).toHaveBeenCalledTimes(2);
  });

  it('PBS имеет отдельное подтверждение, а foreground затем не повторяет его', async () => {
    await db.deadlines.put(deadline());
    const sw = worker();
    await sw.fire('periodicsync', { tag: 'fh-reminders' });
    expect((await readDeliveryReceipt('periodic-background')).shownCount).toBe(1);
    expect((await readDeliveryReceipt('web-push')).receivedCount).toBe(0);
    expect(await runReminderCheck()).toBe(0);
    expect(foregroundShow).not.toHaveBeenCalled();
    await sw.fire('periodicsync', { tag: 'fh-reminders' });
    expect(sw.show).toHaveBeenCalledOnce();
  });
});

it('диагностический снимок берёт только счётчики/время, не произвольные поля kv', async () => {
  await kvSet(deliveryKey('web-push'), {
    receivedCount: 2,
    shownCount: 1,
    lastReceivedAt: '2026-10-02T09:00:00.000Z',
    lastShownAt: 'не время',
    title: 'Учебное приватное название',
    endpoint: 'https://fixture.invalid/private',
    token: 'fixture-token',
  });
  const snapshot = await notificationDeliverySnapshot();
  expect(snapshot.webPush.receivedCount).toBe(2);
  expect(snapshot.webPush.lastShownAt).toBeNull();
  expect(JSON.stringify(snapshot)).not.toContain('Учебное приватное');
  expect(JSON.stringify(snapshot)).not.toContain('fixture.invalid');
  expect(JSON.stringify(snapshot)).not.toContain('fixture-token');
});
