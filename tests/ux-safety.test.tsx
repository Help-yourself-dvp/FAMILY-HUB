/**
 * Выпуск 1 «Читаемость и безопасность» — разбор владельца 07.10.2026:
 * у случайного удаления появилось подтверждение (срок) и возврат (покупка),
 * у списка покупок — подпись «Группировать:», редкое «Очистить купленное» уехало
 * в меню секции «Куплено», из строки дела убран автор («Последнее изменение: …»),
 * на Главной вместо «куплено» — «Нужно купить». Вымышленные данные, сеть запрещена.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { deadlinesRepo, shoppingRepo, tasksRepo } from '../src/data/repositories';
import { loadSession } from '../src/data/session';
import type { Member } from '../src/domain/types';

let selfId = '';
const PEER = 'fixture-peer';
const confirmAnswer = vi.fn(() => true);

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
  await db.members.bulkPut([
    member(selfId, 'Учебный участник'),
    member(PEER, 'Учебный исполнитель'),
  ]);
  window.history.replaceState({}, '', '/#/');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
  confirmAnswer.mockClear();
  confirmAnswer.mockReturnValue(true);
  vi.spyOn(window, 'confirm').mockImplementation(confirmAnswer);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/#/');
});

async function openTab(name: 'Главная' | 'Покупки' | 'Дела' | 'Сроки') {
  const nav = await screen.findByRole('navigation', { name: 'Основная навигация' });
  fireEvent.click(within(nav).getByRole('link', { name }));
}

describe('Опасные действия: подтверждение и возврат', () => {
  it('удаление срока спрашивает подтверждение, отказ ничего не удаляет', async () => {
    const d = await deadlinesRepo.add({
      title: 'Учебный техосмотр',
      dueDate: '2027-05-01',
      deadlineKind: 'custom',
      remindersDays: [30, 7, 0],
    });
    confirmAnswer.mockReturnValue(false);
    render(<App ready />);
    await openTab('Сроки');

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить «Учебный техосмотр»' }));
    expect(confirmAnswer).toHaveBeenCalledWith('Удалить срок «Учебный техосмотр»?');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Удалить «Учебный техосмотр»' })).not.toBeNull(),
    );
    expect((await db.deadlines.get(d.id))?.deletedAt ?? null).toBeNull();
  });

  it('согласие удаляет срок', async () => {
    const d = await deadlinesRepo.add({
      title: 'Учебный техосмотр',
      dueDate: '2027-05-01',
      deadlineKind: 'custom',
      remindersDays: [30, 7, 0],
    });
    render(<App ready />);
    await openTab('Сроки');
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить «Учебный техосмотр»' }));

    await waitFor(async () => expect((await db.deadlines.get(d.id))?.deletedAt).toBeTruthy());
  });

  it('удалённую покупку можно вернуть кнопкой «Вернуть»', async () => {
    const item = await shoppingRepo.add({ title: 'Учебное молоко', horizon: 'now' });
    render(<App ready />);
    await openTab('Покупки');

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить Учебное молоко' }));
    await waitFor(async () => expect((await db.shopping.get(item.id))?.deletedAt).toBeTruthy());

    const bar = await screen.findByText('Удалено: «Учебное молоко»');
    expect(bar).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));

    await waitFor(async () => {
      const row = await db.shopping.get(item.id);
      expect(row?.deletedAt ?? null).toBeNull();
      expect(row?.rev).toBeGreaterThan(item.rev);
    });
    expect(await screen.findByRole('button', { name: 'Удалить Учебное молоко' })).toBeTruthy();
  });
});

describe('Покупки: подпись группировки и меню секции «Куплено»', () => {
  it('над чипами есть подпись «Группировать:»', async () => {
    await shoppingRepo.add({ title: 'Учебный хлеб', horizon: 'now' });
    render(<App ready />);
    await openTab('Покупки');
    expect(await screen.findByText('Группировать:')).toBeTruthy();
  });

  it('«Очистить купленное» живёт в меню секции и требует подтверждения', async () => {
    const bought = await shoppingRepo.add({ title: 'Учебный сыр', horizon: 'now' });
    await shoppingRepo.toggleDone(bought.id, true);
    render(<App ready />);
    await openTab('Покупки');

    // Пока «Куплено» свёрнуто, действие недоступно — оно не мозолит глаза в списке.
    expect(screen.queryByRole('button', { name: 'Очистить купленное' })).toBeNull();
    fireEvent.click(await screen.findByRole('switch', { name: 'Показывать завершённые' }));
    const menu = await screen.findByLabelText('Ещё действия с купленным');
    fireEvent.click(menu);
    const clear = await screen.findByRole('button', { name: 'Очистить купленное' });

    // Отказ в подтверждении — купленное остаётся на месте.
    confirmAnswer.mockReturnValueOnce(false);
    fireEvent.click(clear);
    expect(confirmAnswer).toHaveBeenCalledWith('Убрать купленные позиции из списка — 1 шт.?');
    await waitFor(async () =>
      expect((await db.shopping.get(bought.id))?.deletedAt ?? null).toBeNull(),
    );

    fireEvent.click(clear);
    await waitFor(async () => expect((await db.shopping.get(bought.id))?.deletedAt).toBeTruthy());
  });
});

describe('Тексты: Главная и строка дела', () => {
  it('Главная отвечает «Нужно купить», счётчик «куплено» убран', async () => {
    await shoppingRepo.add({ title: 'Учебный хлеб', horizon: 'now' });
    const bought = await shoppingRepo.add({ title: 'Учебный сыр', horizon: 'now' });
    await shoppingRepo.toggleDone(bought.id, true);
    render(<App ready />);

    const card = (await screen.findByText('Нужно купить')).closest('.card') as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).getByText('Скоро')).toBeTruthy();
    expect(within(card).getByText('Когда-нибудь')).toBeTruthy();
    // «куплено» и «сейчас / скоро» — прежние счётчики. В самой ленте слово «куплено»
    // остаётся (это название действия), поэтому проверяем именно карточку покупок.
    expect(within(card).queryByText('куплено')).toBeNull();
    expect(within(card).queryByText('сейчас / скоро')).toBeNull();
  });

  it('автор последнего изменения не виден в списке дел, но есть при открытии дела', async () => {
    const t = await tasksRepo.add({ title: 'Учебное поручение' });
    // Правку сделал другой участник: строка списка не должна об этом сообщать.
    await db.tasks.put({ ...(await db.tasks.get(t.id))!, updatedBy: PEER });
    render(<App ready />);
    await openTab('Дела');

    await screen.findByRole('button', { name: 'Изменить дело «Учебное поручение»' });
    expect(screen.queryByText(/Последнее изменение/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Изменить дело «Учебное поручение»' }));
    const sheet = await screen.findByRole('dialog', { name: 'Изменить дело' });
    expect(within(sheet).getByText('Последнее изменение: Учебный исполнитель.')).toBeTruthy();
  });
});
