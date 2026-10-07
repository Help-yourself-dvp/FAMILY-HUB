/**
 * Полировка после 0.6.24 (замечания владельца 07.10.2026):
 * — плашка синхронизации вверху короткая и не выдавливает название раздела;
 * — «Ближайшие сроки» на Главной идут строго по дате (а не «через 42 дня, потом 1018»);
 * — фильтры и сортировка в «Делах» — одной компактной строкой.
 * Вымышленные данные, сеть запрещена.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { deadlinesRepo, tasksRepo } from '../src/data/repositories';
import { loadSession } from '../src/data/session';
import { INITIAL_SYNC_STATE, setSyncState } from '../src/data/sync/state';
import { nearestDeadlines } from '../src/domain/deadlineRules';
import type { Deadline, Member } from '../src/domain/types';

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

const deadline = (over: Partial<Deadline> & { id: string; title: string }): Deadline => {
  const base: Deadline = {
    id: '',
    title: '',
    rev: 1,
    kind: 'deadlines',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'me',
    deletedAt: null,
    deadlineKind: 'custom',
    dueDate: '2027-01-01',
    remindersDays: [7, 0],
    recurrence: { type: 'none' },
    history: [],
    visibility: 'family',
    note: null,
    alertDays: null,
    warnDays: null,
  };
  return { ...base, ...over, recurrence: over.recurrence ?? base.recurrence };
};

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
  setSyncState({ configured: true, phase: 'synced', pendingCount: 0, lastError: null });
});

afterEach(() => {
  cleanup();
  setSyncState({ ...INITIAL_SYNC_STATE });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/#/');
});

describe('nearestDeadlines — правило «сначала ближайшее»', () => {
  it('сортирует по дате, а не по порядку в базе', () => {
    const list = [
      deadline({ id: 'far', title: 'Очень далёкое', dueDate: '2029-07-21' }),
      deadline({ id: 'near', title: 'Скоро', dueDate: '2026-11-19' }),
      deadline({ id: 'mid', title: 'Позже', dueDate: '2027-01-08' }),
    ];
    expect(nearestDeadlines(list).map((d) => d.id)).toEqual(['near', 'mid', 'far']);
  });

  it('берёт только три ближайших и пропускает удалённые', () => {
    const list = Array.from({ length: 6 }, (_v, n) =>
      deadline({
        id: `d${n}`,
        title: `Срок ${n}`,
        dueDate: `2027-0${n + 1}-01`,
      }),
    );
    list.push(
      deadline({
        id: 'gone',
        title: 'Удалённый',
        dueDate: '2026-10-10',
        deletedAt: '2026-10-05T00:00:00.000Z',
      }),
    );
    expect(nearestDeadlines(list).map((d) => d.id)).toEqual(['d0', 'd1', 'd2']);
  });

  it('просроченный срок остаётся первым: он и есть ближайший', () => {
    const list = [
      deadline({ id: 'future', title: 'Будущее', dueDate: '2027-01-01' }),
      deadline({ id: 'late', title: 'Просрочено', dueDate: '2020-01-01' }),
    ];
    expect(nearestDeadlines(list).map((d) => d.id)).toEqual(['late', 'future']);
  });
});

describe('«Ближайшие сроки» на Главной', () => {
  it('показывает три самых близких по дате, а не «через 1018 дней» вместо «через 93»', async () => {
    // Именно этот случай заметил владелец: далёкий срок оказывался выше близкого.
    await deadlinesRepo.add({
      title: 'Учебный паспорт',
      dueDate: dayShift(1018),
      deadlineKind: 'custom',
      remindersDays: [7, 0],
    });
    await deadlinesRepo.add({
      title: 'Учебное ТО',
      dueDate: dayShift(93),
      deadlineKind: 'custom',
      remindersDays: [7, 0],
    });
    await deadlinesRepo.add({
      title: 'Учебная страховка',
      dueDate: dayShift(42),
      deadlineKind: 'custom',
      remindersDays: [7, 0],
    });
    render(<App ready />);

    const section = (await screen.findByText('Ближайшие сроки')).closest('section') as HTMLElement;
    await within(section).findByText('Учебная страховка');
    await within(section).findByText('Учебное ТО');
    await within(section).findByText('Учебный паспорт');
    const titles = [...section.querySelectorAll('.small')].map((el) => el.textContent ?? '');
    expect(titles.indexOf('Учебная страховка')).toBeLessThan(titles.indexOf('Учебное ТО'));
    expect(titles.indexOf('Учебное ТО')).toBeLessThan(titles.indexOf('Учебный паспорт'));
  });
});

describe('Плашка синхронизации в верхней строке', () => {
  function pill(): HTMLElement {
    return screen.getByRole('button', { name: /Состояние синхронизации/u });
  }

  it('в исправном состоянии — короткое «Сохранено», название раздела не выдавливается', async () => {
    render(<App ready />);
    await screen.findByText('Ближайшие сроки');
    expect(pill().textContent).toBe('Сохранено');
    expect(screen.getByText('Family Hub')).toBeTruthy();
  });

  it('«Все изменения сохранены» живёт в нижней строке Главной, а не в плашке', async () => {
    render(<App ready />);
    const line = await screen.findByText(/Синхронизация:/u);
    expect(line.textContent).toContain('Все изменения сохранены');
    expect(pill().textContent).not.toContain('Все изменения сохранены');
  });

  it('во время работы плашка говорит «Синхронизация…» — так понятнее', async () => {
    setSyncState({ configured: true, phase: 'syncing', pendingCount: 2, lastError: null });
    render(<App ready />);
    await screen.findByText('Ближайшие сроки');
    expect(pill().textContent).toBe('Синхронизация…');
    // И в подвале Главной слово не дублируется («Синхронизация: Синхронизация…»).
    const line = screen.getByText(/^Синхронизация…$/u);
    expect(line.textContent).toBe('Синхронизация…');
  });
});

describe('«Дела»: фильтры одной строкой', () => {
  async function openTasks() {
    render(<App ready />);
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Дела' }));
    return await screen.findByRole('button', { name: 'Добавить дело' });
  }

  it('чипы фильтра — один ряд во всю ширину, сортировка — у заголовка списка', async () => {
    await tasksRepo.add({ title: 'Учебное поручение' });
    await openTasks();
    // Чипы: одна строка, без переноса и без соседнего селекта (0.6.27 — он налезал).
    const chips = screen.getByRole('group', { name: 'Фильтр дел' });
    expect(chips.className).toContain('chips--line');
    for (const chip of ['Все дела', 'Мои дела', 'Без исполнителя']) {
      expect(within(chips).getByRole('button', { name: chip })).toBeTruthy();
    }
    // Сортировка живёт в строке заголовка «К выполнению · N».
    const heading = screen.getByRole('heading', { name: /К выполнению/u });
    const headerRow = heading.parentElement as HTMLElement;
    const select = within(headerRow).getByLabelText('Сортировать дела');
    expect(select.className).toContain('select--compact');
    expect(chips.contains(select)).toBe(false);
    expect(screen.queryByText('Сортировать по')).toBeNull();
  });

  it('сортировка доступна и когда по фильтру ничего не найдено', async () => {
    await openTasks();
    expect(await screen.findByText('Добавьте первое дело')).toBeTruthy();
    expect(screen.getByLabelText('Сортировать дела')).toBeTruthy();
  });

  it('фильтр по-прежнему работает', async () => {
    await tasksRepo.add({ title: 'Учебное поручение' });
    await openTasks();
    fireEvent.click(screen.getByRole('button', { name: 'Без исполнителя' }));
    expect(await screen.findByText('Учебное поручение')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Мои дела' }));
    expect(await screen.findByText('Здесь нет открытых дел')).toBeTruthy();
  });
});
