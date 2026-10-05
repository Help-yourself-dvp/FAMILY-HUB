/** Реальный App/HashRouter/Sheet, вымышленные участники/дела, сеть запрещена. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { tasksRepo } from '../src/data/repositories';
import { loadSession } from '../src/data/session';
import type { Member } from '../src/domain/types';

let selfId = '';
const confirmDelete = vi.fn(() => true);
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
    db.tasks.clear(),
    db.shopping.clear(),
    db.deadlines.clear(),
    db.kv.clear(),
    db.members.clear(),
    db.activity.clear(),
  ]);
  await kvSet(KV_KEYS.profileName, 'Учебный участник');
  selfId = (await loadSession()).deviceId;
  await db.members.bulkPut([
    member(selfId, 'Учебный участник'),
    member('fixture-peer', 'Учебный исполнитель'),
  ]);
  window.history.replaceState({}, '', '/#/');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
  confirmDelete.mockClear();
  vi.spyOn(window, 'confirm').mockImplementation(confirmDelete);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/#/');
});

async function openTasks() {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Основная навигация' })).getByRole('link', {
      name: 'Дела',
    }),
  );
  await screen.findByRole('button', { name: 'Добавить дело' });
}
async function quickTask() {
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  const menu = await screen.findByRole('dialog', { name: 'Что добавим?' });
  fireEvent.click(within(menu).getByRole('button', { name: 'Добавить дело' }));
  return screen.findByRole('dialog', { name: 'Новое дело' });
}
async function addNamed(form: HTMLElement, name: string) {
  fireEvent.change(within(form).getByLabelText('Что нужно сделать'), { target: { value: name } });
  fireEvent.click(within(form).getByRole('button', { name: 'Добавить дело' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новое дело' })).toBeNull());
}

describe('Дела: базовая приёмка', () => {
  it('Главная показывает ближайшие дела с датой, затем без даты; завершённые скрыты', async () => {
    await tasksRepo.add({ title: 'Без даты' });
    const completed = await tasksRepo.add({ title: 'Сделано с датой', dueDate: '2027-04-01' });
    await tasksRepo.setDone(completed.id, true);
    await tasksRepo.add({
      title: 'Ближайшее поручение',
      dueDate: '2027-03-01',
      assigneeId: 'fixture-peer',
    });
    await tasksRepo.add({ title: 'Следующее поручение', dueDate: '2027-05-01' });
    render(<App ready />);
    const section = await screen.findByRole('region', { name: 'Ближайшие дела' });
    await within(section).findByText('Ближайшее поручение');
    // Решение владельца 05.10.2026: дела без даты тоже видны, но строго в конце списка.
    await within(section).findByText('Без даты');
    const texts = [...section.querySelectorAll('.small')].map((el) => el.textContent ?? '');
    expect(texts.indexOf('Без даты')).toBeGreaterThan(texts.indexOf('Ближайшее поручение'));
    expect(within(section).queryByText('Сделано с датой')).toBeNull();
    expect(section.textContent).toContain('Учебный исполнитель');
    fireEvent.click(within(section).getByRole('link', { name: 'Все дела' }));
    await screen.findByRole('button', { name: 'Добавить дело' });
    expect(window.location.hash).toBe('#/tasks');
  });

  it('из вкладки создаёт недатированное дело и показывает запись без сети', async () => {
    render(<App ready />);
    await openTasks();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дело' }));
    const form = await screen.findByRole('dialog', { name: 'Новое дело' });
    await addNamed(form, 'Учебное дело');
    await screen.findByRole('button', { name: 'Изменить дело «Учебное дело»' });
    expect((await db.tasks.toArray())[0]).toMatchObject({
      title: 'Учебное дело',
      dueDate: null,
      assigneeId: null,
    });
    expect(window.location.hash).toBe('#/tasks');
  });

  it('из круглого + на Главной открывает настоящую форму с повторным открытием', async () => {
    render(<App ready />);
    const first = await quickTask();
    expect(window.location.hash).toBe('#/tasks');
    fireEvent.click(within(first).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новое дело' })).toBeNull());
    await addNamed(await quickTask(), 'Дело через +');
    expect(await db.tasks.count()).toBe(1);
  });

  it('запрос из + не теряется при незавершённой загрузке приложения', async () => {
    const view = render(<App ready={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    const menu = await screen.findByRole('dialog', { name: 'Что добавим?' });
    fireEvent.click(within(menu).getByRole('button', { name: 'Добавить дело' }));
    await waitFor(() => expect(window.location.hash).toBe('#/tasks'));
    expect(screen.queryByRole('dialog', { name: 'Новое дело' })).toBeNull();
    view.rerender(<App ready />);
    await screen.findByRole('dialog', { name: 'Новое дело' });
  });

  it('сохраняет описание, исполнителя и дату; на экране видны имя и подробности', async () => {
    render(<App ready />);
    const form = await quickTask();
    fireEvent.change(within(form).getByLabelText(/^Описание/u), {
      target: { value: 'Учебные подробности' },
    });
    fireEvent.change(within(form).getByLabelText('Исполнитель'), {
      target: { value: 'fixture-peer' },
    });
    fireEvent.change(within(form).getByLabelText(/^Срок/u), { target: { value: '2027-04-01' } });
    await addNamed(form, 'Учебное поручение');
    const row = await screen.findByRole('button', { name: 'Изменить дело «Учебное поручение»' });
    expect(row.textContent).toContain('Учебный исполнитель');
    expect(row.textContent).toContain('Учебные подробности');
    expect(row.textContent).toContain('01.04.2027');
  });

  it('не допускает пустое название, не пишет пустую задачу', async () => {
    render(<App ready />);
    const form = await quickTask();
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить дело' }));
    await screen.findByText('Напишите, что нужно сделать.');
    expect(await db.tasks.count()).toBe(0);
    expect(screen.getByRole('dialog', { name: 'Новое дело' })).toBeTruthy();
  });

  it('выполнение и возврат не теряют задачу, лента показывает выполнено, не куплено', async () => {
    await tasksRepo.add({ title: 'Завершить учебное' });
    render(<App ready />);
    await openTasks();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выполнить «Завершить учебное»' }));
    await waitFor(async () => expect((await db.tasks.toArray())[0]?.status).toBe('done'));
    fireEvent.click(await screen.findByText('Выполнено · 1'));
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Вернуть в работу «Завершить учебное»' }),
    );
    await waitFor(async () => expect((await db.tasks.toArray())[0]?.status).toBe('open'));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Основная навигация' })).getByRole('link', {
        name: 'Главная',
      }),
    );
    fireEvent.click(await screen.findByText(/Семейная лента/u));
    await screen.findByText('выполнено', { selector: '.badge' });
  });

  it('фильтры показывают свои/неназначенные дела, чужие не удаляются', async () => {
    await tasksRepo.add({ title: 'Моё учебное', assigneeId: selfId });
    await tasksRepo.add({ title: 'Чужое учебное', assigneeId: 'fixture-peer' });
    await tasksRepo.add({ title: 'Общее учебное' });
    render(<App ready />);
    await openTasks();
    fireEvent.click(screen.getByRole('button', { name: 'Мои дела' }));
    await screen.findByRole('button', { name: 'Изменить дело «Моё учебное»' });
    expect(screen.queryByRole('button', { name: 'Изменить дело «Чужое учебное»' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Без исполнителя' }));
    await screen.findByRole('button', { name: 'Изменить дело «Общее учебное»' });
    expect(await db.tasks.count()).toBe(3);
  });

  it('правка меняет существующее дело, дату можно убрать без новой записи', async () => {
    await tasksRepo.add({ title: 'До правки', dueDate: '2027-04-01' });
    render(<App ready />);
    await openTasks();
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить дело «До правки»' }));
    const form = await screen.findByRole('dialog', { name: 'Изменить дело' });
    fireEvent.change(within(form).getByLabelText('Что нужно сделать'), {
      target: { value: 'После правки' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Убрать срок' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Изменить дело' })).toBeNull());
    expect((await db.tasks.toArray())[0]).toMatchObject({
      title: 'После правки',
      dueDate: null,
      rev: 2,
    });
    expect(await db.tasks.count()).toBe(1);
  });

  it('удаление спрашивает подтверждение и оставляет невидимый tombstone', async () => {
    await tasksRepo.add({ title: 'Удалить учебное' });
    render(<App ready />);
    await openTasks();
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить дело «Удалить учебное»' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Изменить дело «Удалить учебное»' })).toBeNull(),
    );
    expect(confirmDelete).toHaveBeenCalledOnce();
    expect((await db.tasks.toArray())[0]?.deletedAt).toBeTruthy();
  });
});
