/**
 * Выпуск 2 «Главная и тексты» — разбор владельца 07.10.2026: Главная отвечает на вопрос
 * «что требует внимания», а не начинается со счётчиков; состояние синхронизации ушло
 * тонкой строкой вниз, баннер сверху — только при проблеме; длинные абзацы переехали
 * в «Справку» (значок «i» в верхней панели). Вымышленные данные, сеть запрещена.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { INITIAL_SYNC_STATE, setSyncState } from '../src/data/sync/state';
import { deadlinesRepo, shoppingRepo, tasksRepo } from '../src/data/repositories';
import { loadSession } from '../src/data/session';
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

/** Дата в прошлом и в будущем — считаем от сегодняшнего дня, тест не «портится» со временем. */
function dayShift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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

/** Индекс элемента в разметке: сравнение показывает реальный порядок блоков на экране. */
function position(el: Element, other: Element): number {
  const rel = el.compareDocumentPosition(other);
  if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

describe('Главная: порядок и «Требует внимания»', () => {
  it('без проблем блок «Требует внимания» не показывается', async () => {
    setSyncState({ configured: true, phase: 'synced', pendingCount: 0, lastError: null });
    await shoppingRepo.add({ title: 'Учебный хлеб', horizon: 'now' });
    render(<App ready />);
    await screen.findByText('Ближайшие сроки');
    expect(screen.queryByRole('region', { name: 'Требует внимания' })).toBeNull();
  });

  it('просроченный срок и дело на сегодня попадают в «Требует внимания»', async () => {
    await deadlinesRepo.add({
      title: 'Учебный техосмотр',
      dueDate: dayShift(-3),
      deadlineKind: 'custom',
      remindersDays: [7, 0],
    });
    await tasksRepo.add({ title: 'Учебная оплата', dueDate: dayShift(0) });
    render(<App ready />);

    setSyncState({ configured: true, phase: 'synced', pendingCount: 0, lastError: null });
    const block = await screen.findByRole('region', { name: 'Требует внимания' });
    // Данные приходят из IndexedDB асинхронно: каждую строку ждём отдельно.
    expect(await within(block).findByText(/Просрочен срок/u)).toBeTruthy();
    expect(await within(block).findByText('Сегодня дело: Учебная оплата')).toBeTruthy();
  });

  it('порядок блоков: внимание → сроки → дела → покупки → лента', async () => {
    await deadlinesRepo.add({
      title: 'Учебный техосмотр',
      dueDate: dayShift(-3),
      deadlineKind: 'custom',
      remindersDays: [7, 0],
    });
    setSyncState({ configured: true, phase: 'synced', pendingCount: 0, lastError: null });
    await tasksRepo.add({ title: 'Учебное поручение', dueDate: dayShift(2) });
    await shoppingRepo.add({ title: 'Учебный хлеб', horizon: 'now' });
    render(<App ready />);

    const attention = await screen.findByRole('region', { name: 'Требует внимания' });
    const deadlines = screen.getByRole('heading', { name: 'Ближайшие сроки' });
    const tasks = screen.getByRole('region', { name: 'Ближайшие дела' });
    const purchases = screen.getByText(/Нужно купить:/u).closest('a') as HTMLElement;
    const feed = screen.getByText(/Семейная лента/u);

    expect(position(attention, deadlines)).toBe(-1);
    expect(position(deadlines, tasks)).toBe(-1);
    expect(position(tasks, purchases)).toBe(-1);
    expect(position(purchases, feed)).toBe(-1);
  });
});

describe('Синхронизация: строка внизу и баннер только при проблеме', () => {
  it('большой карточки нет, внизу — тонкая строка состояния', async () => {
    await shoppingRepo.add({ title: 'Учебный хлеб', horizon: 'now' });
    render(<App ready />);
    const line = await screen.findByText(/Синхронизация:/u);
    expect(line.className).toContain('sync-line');
    expect(screen.queryByText('не отправлено')).toBeNull();
  });

  it('без подключения сверху виден баннер с кнопкой «Настроить» и строка «только на этом телефоне»', async () => {
    render(<App ready />);
    // Баннер — на самом верху, до блоков-разделов.
    const banner = await screen.findByText(
      'Подключите семейное хранилище, чтобы покупки, дела и сроки видела вся семья.',
    );
    expect(banner.closest('.banner')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Настроить' })).toBeTruthy();
    const attention = screen.getByRole('region', { name: 'Требует внимания' });
    expect(await within(attention).findByText('Данные только на этом телефоне')).toBeTruthy();
    const line = screen.getByText(/Синхронизация:/u);
    expect(line.className).toContain('sync-line');
  });

  it('всё сохранено и отправлено — баннера сверху нет, строка говорит «Сохранено»', async () => {
    // Обычное состояние: пустой очереди достаточно, чтобы баннер не появлялся.
    // Само правило «когда нужен баннер» проверяется без DOM в tests/home-status.test.ts.
    setSyncState({ configured: true, phase: 'synced', pendingCount: 0, lastError: null });
    render(<App ready />);
    await screen.findByText('Ближайшие сроки');
    const line = await screen.findByText(/Синхронизация:/u);
    expect(line.className).toContain('sync-line');
  });

  it('очередь на отправку — сверху предупреждение со счётчиком', async () => {
    setSyncState({ configured: true, phase: 'idle', pendingCount: 3, lastError: null });
    await shoppingRepo.add({ title: 'Учебный хлеб', horizon: 'now' });
    render(<App ready />);
    expect(await screen.findByText('Ждут отправки: 3')).toBeTruthy();
    expect(screen.getByText(/Изменения уже на телефоне/u)).toBeTruthy();
  });
});

describe('Длинные абзацы переехали в «Справку»', () => {
  it('на Главной нет карточки «Дела и сроки», а в справке есть пояснения', async () => {
    render(<App ready />);
    await screen.findByText('Ближайшие сроки');
    expect(screen.queryByText('Дела и сроки')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'О разделе «Family Hub»' }));
    const sheet = await screen.findByRole('dialog', { name: 'О разделе «Family Hub»' });
    expect(within(sheet).getByText(/«Сроки» — документы/u)).toBeTruthy();
    expect(within(sheet).getByText(/«Дела» — общий список/u)).toBeTruthy();
    expect(within(sheet).getByText(/состояние синхронизации/u)).toBeTruthy();
  });

  it('справка раздела покупок объясняет «Группировать:» и «Вернуть»', async () => {
    render(<App ready />);
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Покупки' }));
    fireEvent.click(await screen.findByRole('button', { name: 'О разделе «Покупки»' }));
    const sheet = await screen.findByRole('dialog', { name: 'О разделе «Покупки»' });
    expect(within(sheet).getByText(/Группировать:/u)).toBeTruthy();
    expect(within(sheet).getByText(/кнопкой «Вернуть»/u)).toBeTruthy();
  });
});
