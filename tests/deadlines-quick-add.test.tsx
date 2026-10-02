/** Реальная оболочка + HashRouter + тестовая IndexedDB. Сеть и семейные данные не используются. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { loadSession } from '../src/data/session';

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

async function quickDeadline() {
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  const menu = await screen.findByRole('dialog', { name: 'Что добавим?' });
  fireEvent.click(within(menu).getByRole('button', { name: 'Добавить срок' }));
  return await screen.findByRole('dialog', { name: 'Новый срок' });
}

async function openDeadlineTab() {
  const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
  fireEvent.click(within(nav).getByRole('link', { name: 'Сроки' }));
  await screen.findByRole('button', { name: 'Добавить срок' });
}

describe('Сроки: оба пути добавления', () => {
  it('круглый + с Главной открывает раздел Сроки и настоящую форму', async () => {
    render(<App ready />);
    const form = await quickDeadline();
    expect(within(form).getByLabelText('Что за срок')).toBeTruthy();
    expect(window.location.hash).toBe('#/deadlines');
    expect(screen.queryByRole('dialog', { name: 'Что добавим?' })).toBeNull();
  });

  it('круглый + в уже открытых Сроках позволяет закрыть и снова открыть форму', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const first = await quickDeadline();
    fireEvent.click(within(first).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull());
    const second = await quickDeadline();
    expect(within(second).getByLabelText('Что за срок')).toBeTruthy();
    expect(window.location.hash).toBe('#/deadlines');
  });

  it('созданный через + срок сохраняется один раз, закрытие формы не сбрасывает раздел', async () => {
    render(<App ready />);
    const form = await quickDeadline();
    fireEvent.change(within(form).getByLabelText('Что за срок'), {
      target: { value: 'Учебный срок FAB' },
    });
    fireEvent.change(within(form).getByLabelText(/^Дата/u), { target: { value: '2027-04-01' } });
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull());
    expect((await db.deadlines.toArray()).map((row) => [row.title, row.dueDate])).toEqual([
      ['Учебный срок FAB', '2027-04-01'],
    ]);
    expect(window.location.hash).toBe('#/deadlines');
    await screen.findByRole('button', { name: 'Изменить «Учебный срок FAB»' });
    expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull();
  });

  it('обычная кнопка Добавить срок продолжает открывать ту же форму', async () => {
    render(<App ready />);
    await openDeadlineTab();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить срок' }));
    const form = await screen.findByRole('dialog', { name: 'Новый срок' });
    expect(within(form).getByLabelText('Что за срок')).toBeTruthy();
  });
});
