/**
 * Запрос «сразу открыть форму создания» из круглого «+» — одноразовый.
 *
 * Он лежит в состоянии записи истории, а состояние записи переживает перезагрузку
 * страницы. Свайп сверху вниз на телефоне перезагружает приложение, поэтому до
 * исправления форма открывалась снова при каждом обновлении — пока пользователь не
 * уходил в другой раздел. Здесь проверяем: запрос гасится сразу после открытия формы
 * и перезагрузка страницы форму не открывает.
 *
 * Реальная оболочка + HashRouter + тестовая IndexedDB. Сеть и семейные данные не
 * используются.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { loadSession } from '../src/data/session';

/** Запрос «открыть форму» всё ещё лежит в состоянии текущей записи истории? */
function composeInHistory(): boolean {
  const state = window.history.state as { usr?: { compose?: boolean } } | null;
  return state?.usr?.compose === true;
}

async function goFromFab(item: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  const menu = await screen.findByRole('dialog', { name: 'Что добавим?' });
  fireEvent.click(within(menu).getByRole('button', { name: item }));
}

beforeEach(async () => {
  await Promise.all([
    db.kv.clear(),
    db.members.clear(),
    db.shopping.clear(),
    db.deadlines.clear(),
    db.activity.clear(),
  ]);
  await kvSet(KV_KEYS.profileName, 'Учебный участник');
  await loadSession();
  window.history.replaceState({}, '', '/#/');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/#/');
});

describe('Форма из «+»: запрос одноразовый', () => {
  it('открывает форму, но не оставляет запрос в истории', async () => {
    render(<App ready />);
    await goFromFab('Добавить срок');
    expect(await screen.findByRole('dialog', { name: 'Новый срок' })).toBeTruthy();
    await waitFor(() => expect(composeInHistory()).toBe(false));
  });

  it('перезагрузка страницы (свайп вниз) не открывает форму снова', async () => {
    render(<App ready />);
    await goFromFab('Добавить срок');
    expect(await screen.findByRole('dialog', { name: 'Новый срок' })).toBeTruthy();

    // Перезагрузка страницы: приложение загружается заново на том же адресе и с той же
    // записью истории — ровно то, что происходит при свайпе сверху вниз.
    cleanup();
    render(<App ready />);
    await screen.findByRole('button', { name: 'Добавить срок' });
    expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull();
  });

  it.each([
    ['Добавить покупку', 'Новая покупка'],
    ['Добавить дело', 'Новое дело'],
  ])('%s: после перезагрузки форма тоже не открывается', async (item, sheetTitle) => {
    render(<App ready />);
    await goFromFab(item);
    expect(await screen.findByRole('dialog', { name: sheetTitle })).toBeTruthy();

    cleanup();
    render(<App ready />);
    await waitFor(() => expect(composeInHistory()).toBe(false));
    expect(screen.queryByRole('dialog', { name: sheetTitle })).toBeNull();
  });

  it('обычный переход по вкладке «Сроки» форму не открывает', async () => {
    render(<App ready />);
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Сроки' }));
    await screen.findByRole('button', { name: 'Добавить срок' });
    expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull();
    expect(composeInHistory()).toBe(false);
  });
});
