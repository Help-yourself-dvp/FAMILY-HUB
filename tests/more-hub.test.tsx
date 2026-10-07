/**
 * Выпуск 3 разбора 07.10.2026: вкладка «Ещё» стала хабом (Настройки · Справка ·
 * О приложении), Настройки собраны в понятные группы, технические подробности уехали
 * в «Для разработчика». Вымышленные данные, сеть запрещена.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { loadSession } from '../src/data/session';
import { INITIAL_SYNC_STATE, setSyncState } from '../src/data/sync/state';
import type { Member } from '../src/domain/types';

let selfId = '';

const member = (id: string, name: string): Member => ({
  id,
  name,
  kind: 'members',
  rev: 1,
  createdAt: '2026-10-03T07:00:00Z',
  updatedAt: '2026-10-03T07:00:00Z',
  updatedBy: id,
  deletedAt: null,
  color: '#123456',
  emoji: null,
});

beforeEach(async () => {
  await Promise.all([
    db.kv.clear(),
    db.members.clear(),
    db.shopping.clear(),
    db.tasks.clear(),
    db.deadlines.clear(),
    db.activity.clear(),
  ]);
  await kvSet(KV_KEYS.profileName, 'Учебный участник');
  selfId = (await loadSession()).deviceId;
  await db.members.bulkPut([member(selfId, 'Учебный участник')]);
  window.history.replaceState({}, '', '/#/');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
});

afterEach(() => {
  cleanup();
  setSyncState({ ...INITIAL_SYNC_STATE });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/#/');
});

async function openMore() {
  render(<App ready />);
  const nav = await screen.findByRole('navigation', { name: 'Основная навигация' });
  fireEvent.click(within(nav).getByRole('link', { name: 'Ещё' }));
  return await screen.findByRole('link', { name: /Настройки/u });
}

describe('Вкладка «Ещё» — хаб, а не сразу настройки', () => {
  it('показывает четыре входа: Настройки, Справка, О приложении, Для разработчика', async () => {
    await openMore();
    const screenEl = document.querySelector('.screen') as HTMLElement;
    expect(within(screenEl).getByText('Настройки')).toBeTruthy();
    expect(within(screenEl).getByText('Справка')).toBeTruthy();
    expect(within(screenEl).getByText('О приложении')).toBeTruthy();
    expect(within(screenEl).getByText('Для разработчика')).toBeTruthy();
    // «+» на этой странице не нужен: добавлять тут нечего.
    expect(screen.queryByRole('button', { name: 'Добавить' })).toBeNull();
  });

  it('«Справка» — все разделы с пояснениями, включая правило 28 дней', async () => {
    render(<App ready />);
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Ещё' }));
    fireEvent.click(await screen.findByRole('link', { name: /Справка/u }));

    // «Покупки»/«Дела»/«Сроки» есть и в нижней навигации, поэтому смотрим в тело справки.
    const help = (await screen.findByText(/Коротко о том, как всё устроено/u)).closest(
      '.screen',
    ) as HTMLElement;
    expect(within(help).getByText('Покупки')).toBeTruthy();
    expect(within(help).getByText('Дела')).toBeTruthy();
    expect(within(help).getByText('Сроки')).toBeTruthy();
    fireEvent.click(within(help).getByText('Календарь телефона и Google'));
    expect(await screen.findByText(/не принимает напоминания дальше 4 недель/u)).toBeTruthy();
    fireEvent.click(within(help).getByText('Синхронизация'));
    expect(await screen.findByText(/Все изменения сохранены/u)).toBeTruthy();
  });

  it('«О приложении» — версия и схема данных, без технических блоков', async () => {
    render(<App ready />);
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Ещё' }));
    fireEvent.click(await screen.findByRole('link', { name: /О приложении/u }));

    const about = (await screen.findByText(/Приватное семейное приложение/u)).closest(
      '.screen',
    ) as HTMLElement;
    expect(within(about).getAllByText(/Схема данных v\d+/u).length).toBeGreaterThan(0);
    expect(within(about).queryByText('Диагностика')).toBeNull();
    expect(within(about).queryByText('Журнал синхронизации')).toBeNull();
  });

  it('«Для разработчика» — отдельная страница со ссылкой на код, диагностикой и журналом', async () => {
    render(<App ready />);
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Ещё' }));
    fireEvent.click(await screen.findByRole('link', { name: /Для разработчика/u }));

    const dev = (await screen.findByText(/Технические подробности/u)).closest(
      '.screen',
    ) as HTMLElement;
    const repo = within(dev).getByRole('link', { name: 'Help-yourself-dvp/FAMILY-HUB' });
    expect(repo.getAttribute('href')).toContain('github.com/Help-yourself-dvp/FAMILY-HUB');
    expect(within(dev).getByText('Диагностика')).toBeTruthy();
    expect(within(dev).getByText('Журнал синхронизации')).toBeTruthy();
    expect(
      within(dev).getByText(/не подключено — данные пока только на этом телефоне/u),
    ).toBeTruthy();
    // «+» тут не нужен, как и на остальных «редких» страницах.
    expect(screen.queryByRole('button', { name: 'Добавить' })).toBeNull();
  });
});

describe('Настройки собраны в группы', () => {
  async function openSettings() {
    await openMore();
    const screenEl = document.querySelector('.screen') as HTMLElement;
    fireEvent.click(within(screenEl).getByText('Настройки'));
    return await screen.findByRole('region', { name: 'Профиль' });
  }

  it('пять групп по смыслу; техника переехала на страницу «Для разработчика»', async () => {
    await openSettings();
    for (const group of [
      'Профиль',
      'Семья и синхронизация',
      'Уведомления',
      'Оформление',
      'Данные',
    ]) {
      expect(await screen.findByRole('region', { name: group })).toBeTruthy();
    }
    expect(screen.queryByText('Диагностика')).toBeNull();
    expect(screen.queryByText('Журнал синхронизации')).toBeNull();
  });

  it('карточки «О приложении» в настройках больше нет', async () => {
    await openSettings();
    expect(screen.queryByText(/Приложение не хранит номера документов/u)).toBeNull();
  });
});
