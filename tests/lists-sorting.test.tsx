/**
 * Сортировки списков — просьба владельца 06.10.2026: «Семейная лента» (по участнику, по типу,
 * по дате), «Дела» (не только по сроку: исполнитель, название) и «Сроки» (тип, ответственный,
 * название). Проверяем на вымышленных данных, сеть запрещена, семейные данные не читаются.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { loadSession } from '../src/data/session';
import type { ActivityEntry, Deadline, Member, Task } from '../src/domain/types';

let selfId = '';

const PEER = 'fixture-peer';

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

const activity = (over: Partial<ActivityEntry> & { id: string }): ActivityEntry => ({
  at: '2026-10-06T10:00:00.000Z',
  actorId: selfId,
  actorName: 'Учебный участник',
  kind: 'shopping',
  action: 'created',
  title: 'Учебная запись',
  place: null,
  ...over,
});

const task = (over: Partial<Task> & { id: string; title: string }): Task =>
  ({
    rev: 1,
    kind: 'tasks',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: selfId,
    deletedAt: null,
    note: null,
    assigneeId: null,
    dueDate: null,
    status: 'open',
    doneAt: null,
    ...over,
  }) as Task;

const deadline = (over: Partial<Deadline> & { id: string; title: string }): Deadline =>
  ({
    rev: 1,
    kind: 'deadlines',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: selfId,
    deletedAt: null,
    deadlineKind: 'custom',
    dueDate: '2026-11-01',
    remindersDays: [7, 0],
    recurrence: { type: 'none' },
    history: [],
    visibility: 'family',
    note: null,
    ...over,
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
  await db.members.bulkPut([member(selfId, 'Учебный участник'), member(PEER, 'Учебный исполнитель')]);
  window.history.replaceState({}, '', '/#/');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/#/');
});

/** Порядок строк по их aria-label — так видно, что сортировка реально поменяла список. */
function labels(pattern: RegExp): string[] {
  return screen
    .getAllByRole('button', { name: pattern })
    .map((button) => button.getAttribute('aria-label') ?? '');
}

function openTab(name: 'Дела' | 'Сроки') {
  const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
  fireEvent.click(within(nav).getByRole('link', { name }));
}

describe('«Семейная лента»: сортировка и фильтр по участнику', () => {
  beforeEach(async () => {
    await db.activity.bulkPut([
      activity({
        id: 'a1',
        at: '2026-10-06T12:00:00.000Z',
        actorId: PEER,
        actorName: 'Учебный исполнитель',
        kind: 'deadlines',
        title: 'Учебный срок исполнителя',
      }),
      activity({ id: 'a2', at: '2026-10-06T11:00:00.000Z', kind: 'shopping', title: 'Учебная покупка участника' }),
      activity({ id: 'a3', at: '2026-10-06T10:00:00.000Z', kind: 'tasks', title: 'Учебное дело участника' }),
    ]);
  });

  async function openFeed() {
    render(<App ready />);
    fireEvent.click(await screen.findByText(/Семейная лента/u));
    return await screen.findByTestId('activity-list');
  }

  function titles(list: HTMLElement): string[] {
    return [...list.querySelectorAll('[data-testid="activity-item"]')].map(
      (item) => item.textContent ?? '',
    );
  }

  it('по умолчанию — сначала новые', async () => {
    const list = await openFeed();
    expect(titles(list)).toHaveLength(3);
    expect(titles(list)[0]).toContain('Учебный срок исполнителя');
    expect(titles(list)[2]).toContain('Учебное дело участника');
  });

  it('«по участнику» ставит рядом записи одного человека', async () => {
    const list = await openFeed();
    fireEvent.change(screen.getByLabelText('Сортировать ленту'), { target: { value: 'member' } });

    const shown = titles(list);
    // Имена по алфавиту: «Учебный исполнитель» раньше «Учебного участника».
    expect(shown[0]).toContain('Учебный срок исполнителя');
    expect(shown[1]).toContain('Учебная покупка участника');
    expect(shown[2]).toContain('Учебное дело участника');
  });

  it('«по типу» группирует записи разделов', async () => {
    const list = await openFeed();
    fireEvent.change(screen.getByLabelText('Сортировать ленту'), { target: { value: 'kind' } });

    const shown = titles(list);
    // Дела → Покупки → Сроки (русские названия разделов, а не английские ключи).
    expect(shown[0]).toContain('Учебное дело участника');
    expect(shown[1]).toContain('Учебная покупка участника');
    expect(shown[2]).toContain('Учебный срок исполнителя');
  });

  it('фильтр «кто» оставляет записи только выбранного человека', async () => {
    const list = await openFeed();
    fireEvent.change(screen.getByLabelText('Кто в ленте'), { target: { value: selfId } });

    const shown = titles(list);
    expect(shown).toHaveLength(2);
    expect(shown.join(' ')).not.toContain('Учебный срок исполнителя');
  });
});

describe('«Дела»: сортировка открытых', () => {
  beforeEach(async () => {
    await db.tasks.bulkPut([
      task({ id: 't-free', title: 'Учебное без исполнителя' }),
      task({
        id: 't-peer',
        title: 'Учебное дело исполнителя',
        assigneeId: PEER,
        dueDate: '2026-12-01',
        createdAt: '2026-10-02T09:00:00.000Z',
      }),
      task({
        id: 't-self',
        title: 'Учебное дело участника',
        assigneeId: selfId,
        dueDate: '2026-10-20',
        createdAt: '2026-10-03T09:00:00.000Z',
      }),
    ]);
  });

  it('по умолчанию — по сроку, датированные раньше, без даты в конце', async () => {
    render(<App ready />);
    openTab('Дела');
    await screen.findByRole('button', { name: 'Изменить дело «Учебное дело участника»' });

    const shown = labels(/Изменить дело/u);
    expect(shown[0]).toContain('Учебное дело участника');
    expect(shown[1]).toContain('Учебное дело исполнителя');
    expect(shown[2]).toContain('Учебное без исполнителя');
  });

  it('«по исполнителю» — без исполнителя, затем по именам', async () => {
    render(<App ready />);
    openTab('Дела');
    await screen.findByRole('button', { name: 'Изменить дело «Учебное дело участника»' });

    fireEvent.change(screen.getByLabelText('Сортировать дела'), { target: { value: 'assignee' } });

    const shown = labels(/Изменить дело/u);
    expect(shown[0]).toContain('Учебное без исполнителя');
    expect(shown[1]).toContain('Учебное дело исполнителя');
    expect(shown[2]).toContain('Учебное дело участника');
  });
});

describe('«Сроки»: сортировка', () => {
  beforeEach(async () => {
    await db.deadlines.bulkPut([
      deadline({ id: 'd-car', title: 'Учебное ТО машины', deadlineKind: 'vehicle', dueDate: '2026-11-01' }),
      deadline({ id: 'd-pass', title: 'Учебный паспорт', deadlineKind: 'document', dueDate: '2026-11-05' }),
    ]);
  });

  it('по умолчанию — по дате', async () => {
    render(<App ready />);
    openTab('Сроки');
    await screen.findByRole('button', { name: 'Изменить «Учебное ТО машины»' });

    const shown = labels(/Изменить «/u);
    expect(shown[0]).toContain('Учебное ТО машины');
    expect(shown[1]).toContain('Учебный паспорт');
  });

  it('«по типу» ставит документы раньше машин', async () => {
    render(<App ready />);
    openTab('Сроки');
    await screen.findByRole('button', { name: 'Изменить «Учебное ТО машины»' });

    fireEvent.change(screen.getByLabelText('Сортировать сроки'), { target: { value: 'kind' } });

    const shown = labels(/Изменить «/u);
    expect(shown[0]).toContain('Учебный паспорт');
    expect(shown[1]).toContain('Учебное ТО машины');
  });
});
