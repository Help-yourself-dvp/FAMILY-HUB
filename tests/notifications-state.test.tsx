/**
 * Регрессия приёмки 2026-10-02: после холодного старта переключатель push
 * должен отражать живую подписку, календарь — факт скачивания .ics.
 * Только вымышленные сроки и заглушки браузера; сеть и семейные данные не нужны.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationsSection from '../src/features/settings/NotificationsSection';
import { db, kvGet, kvSet } from '../src/data/db';
import type { Deadline } from '../src/domain/types';
import { notificationChannels } from '../src/notifications/channels';
import { downloadIcs } from '../src/notifications/ics';

const PUSH_KEY = 'notify.channels.push';
const ICS_KEY = 'notify.channels.ics';
const PUSH_LABEL = 'Push при закрытом приложении';
const ICS_LABEL = 'Календарь телефона (ICS)';
const subscription = { unsubscribe: vi.fn<() => Promise<boolean>>() };
const getSubscription = vi.fn<() => Promise<typeof subscription | null>>();
const subscribe = vi.fn();
const requestPermission = vi.fn();
const createObjectURL = vi.fn(() => 'blob:test-calendar');
const calendarClick = vi.fn(() => undefined);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function openNotifications() {
  const view = render(<NotificationsSection />);
  fireEvent.click(screen.getByText('Уведомления', { selector: '.grow' }));
  await screen.findByRole('switch', { name: ICS_LABEL });
  return view;
}

function pushSwitch() {
  return screen.getByRole('switch', { name: PUSH_LABEL });
}

function icsSwitch() {
  return screen.getByRole('switch', { name: ICS_LABEL });
}

beforeEach(async () => {
  await Promise.all([db.kv.clear(), db.deadlines.clear()]);
  getSubscription.mockReset().mockResolvedValue(subscription);
  subscription.unsubscribe.mockReset().mockResolvedValue(true);
  subscribe.mockReset();
  requestPermission.mockReset();
  createObjectURL.mockClear();
  calendarClick.mockClear();
  const registration = { pushManager: { getSubscription, subscribe } };
  vi.stubGlobal('navigator', {
    userAgent: 'test-browser',
    maxTouchPoints: 0,
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
    },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission });
  vi.stubGlobal('URL', {
    createObjectURL,
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(calendarClick);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NotificationsSection — восстановление push', () => {
  it('живая подписка включена после первого открытия и повторного монтирования', async () => {
    const view = await openNotifications();
    await waitFor(() => expect(pushSwitch().getAttribute('aria-checked')).toBe('true'));
    await waitFor(async () => expect(await kvGet(PUSH_KEY)).toBe(true));
    expect(getSubscription).toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    view.unmount();
    await openNotifications();
    await waitFor(() => expect(getSubscription).toHaveBeenCalledTimes(2));
    expect(pushSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('сохранённое «включено» не мигает «выключено», пока браузер проверяет подписку', async () => {
    await kvSet(PUSH_KEY, true);
    const pending = deferred<typeof subscription | null>();
    getSubscription.mockReturnValueOnce(pending.promise);
    await openNotifications();
    await waitFor(() => expect(getSubscription).toHaveBeenCalled());
    expect(pushSwitch().getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      pending.resolve(subscription);
      await pending.promise;
    });
    expect(pushSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('исчезнувшая подписка выключает переключатель и исправляет старый кэш', async () => {
    await kvSet(PUSH_KEY, true);
    getSubscription.mockResolvedValue(null);
    await openNotifications();
    await waitFor(async () => expect(await kvGet(PUSH_KEY)).toBe(false));
    expect(pushSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('ошибка проверки не выдаётся за отсутствие подписки и не стирает кэш', async () => {
    await kvSet(PUSH_KEY, true);
    getSubscription.mockRejectedValueOnce(new Error('Ошибка браузерного API'));
    await openNotifications();
    await screen.findByText(/Не удалось проверить push/u);
    expect(pushSwitch().getAttribute('aria-checked')).toBe('true');
    expect(await kvGet(PUSH_KEY)).toBe(true);
  });

  it('ручное включение и выключение сохраняются в kv', async () => {
    getSubscription.mockResolvedValue(null);
    const push = notificationChannels.byId('web-push')!;
    vi.spyOn(push, 'enable').mockResolvedValue({ enabled: true });
    const disable = vi.spyOn(push, 'disable').mockResolvedValue();
    await openNotifications();
    await waitFor(async () => expect(await kvGet(PUSH_KEY)).toBe(false));

    fireEvent.click(pushSwitch());
    await waitFor(async () => expect(await kvGet(PUSH_KEY)).toBe(true));
    expect(pushSwitch().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(pushSwitch());
    await waitFor(async () => expect(await kvGet(PUSH_KEY)).toBe(false));
    expect(disable).toHaveBeenCalledOnce();
    expect(pushSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('запоздалая диагностика не откатывает ручное выключение', async () => {
    await kvSet(PUSH_KEY, true);
    const pending = deferred<typeof subscription | null>();
    getSubscription.mockReturnValueOnce(pending.promise);
    vi.spyOn(notificationChannels.byId('web-push')!, 'disable').mockResolvedValue();
    await openNotifications();
    await waitFor(() => expect(getSubscription).toHaveBeenCalled());

    fireEvent.click(pushSwitch());
    await waitFor(async () => expect(await kvGet(PUSH_KEY)).toBe(false));
    await act(async () => {
      pending.resolve(subscription);
      await pending.promise;
    });
    expect(pushSwitch().getAttribute('aria-checked')).toBe('false');
    expect(await kvGet(PUSH_KEY)).toBe(false);
  });

  it('без регистрации SW диагностика не ждёт бесконечно serviceWorker.ready', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'test-browser',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
        ready: new Promise<never>(() => undefined),
      },
    });
    const snapshot = await notificationChannels.byId('web-push')!.diagnose();
    expect(snapshot.details.subscribed).toBe(false);
    expect(snapshot.details.serviceWorkerRegistered).toBe(false);
    expect(getSubscription).not.toHaveBeenCalled();
  });
});

function demoDeadline(): Deadline {
  return {
    id: 'test-deadline',
    kind: 'deadlines',
    rev: 1,
    createdAt: '2026-10-02T09:00:00Z',
    updatedAt: '2026-10-02T09:00:00Z',
    updatedBy: 'test-device',
    deletedAt: null,
    title: 'Учебный срок',
    deadlineKind: 'custom',
    dueDate: '2026-11-02',
    remindersDays: [30, 0],
    recurrence: { type: 'none' },
    lastCompletedAt: null,
    history: [],
    visibility: 'family',
    note: null,
  };
}

describe('NotificationsSection — календарь телефона', () => {
  it('до скачивания календарь выключен; пустой список не включает его', async () => {
    await openNotifications();
    expect(icsSwitch().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(icsSwitch());
    await screen.findByText(/Сроков пока нет/u);
    expect(icsSwitch().getAttribute('aria-checked')).toBe('false');
    expect(await kvGet(ICS_KEY)).not.toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('скачивание включает канал; после повторного открытия флаг сохраняется; выключение сбрасывает его', async () => {
    await db.deadlines.put(demoDeadline());
    const view = await openNotifications();
    fireEvent.click(icsSwitch());
    await waitFor(async () => expect(await kvGet(ICS_KEY)).toBe(true));
    expect(icsSwitch().getAttribute('aria-checked')).toBe('true');
    expect(calendarClick).toHaveBeenCalledOnce();
    expect((await notificationChannels.byId('ics-calendar')!.diagnose()).enabled).toBe(true);

    view.unmount();
    await openNotifications();
    expect(icsSwitch().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(icsSwitch());
    await waitFor(async () => expect(await kvGet(ICS_KEY)).toBe(false));
    expect(icsSwitch().getAttribute('aria-checked')).toBe('false');
    expect((await notificationChannels.byId('ics-calendar')!.diagnose()).enabled).toBe(false);
    expect(calendarClick).toHaveBeenCalledOnce();
  });

  it('скачивание из раздела «Сроки» тоже запоминается для настроек', async () => {
    await downloadIcs([demoDeadline()]);
    expect(await kvGet(ICS_KEY)).toBe(true);
    await openNotifications();
    expect(icsSwitch().getAttribute('aria-checked')).toBe('true');
  });
});
