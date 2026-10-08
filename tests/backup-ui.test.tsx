/**
 * Настройки → «Данные»: восстановление из резервной копии (0.6.29).
 * Проверяем то, что видит человек: понятный отказ на чужой файл, подтверждение перед
 * записью и итог «добавлено/обновлено». Сеть запрещена, синхронизация — заглушка.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DataSection from '../src/features/settings/DataSection';
import { db } from '../src/data/db';
import type { ShoppingItem, Task } from '../src/domain/types';

const restartSync = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
vi.mock('../src/app/bootstrap', () => ({
  restartSync: () => restartSync(),
}));

const T = '2026-10-07T10:00:00.000Z';

function shopping(id: string): ShoppingItem {
  return {
    id,
    rev: 1,
    createdAt: T,
    updatedAt: T,
    updatedBy: 'dev-test',
    deletedAt: null,
    kind: 'shopping',
    title: `Позиция ${id}`,
    canonicalKey: `poziciya ${id}`,
    qty: null,
    unit: null,
    category: null,
    store: null,
    horizon: 'soon',
    note: null,
    done: false,
    doneAt: null,
    doneBy: null,
  };
}

function task(id: string): Task {
  return {
    id,
    rev: 1,
    createdAt: T,
    updatedAt: T,
    updatedBy: 'dev-test',
    deletedAt: null,
    kind: 'tasks',
    title: `Дело ${id}`,
    note: null,
    assigneeId: null,
    dueDate: null,
    status: 'open',
    doneAt: null,
    recurrence: { type: 'none' },
  };
}

const backupFile = (items: ShoppingItem[], tasks: Task[]) => {
  const payload = {
    app: 'family-hub',
    format: 'family-hub-backup',
    schemaVersion: 1,
    appVersion: '0.6.29',
    exportedAt: T,
    data: { shopping: items, tasks, deadlines: [], members: [], activity: [] },
  };
  return new File([JSON.stringify(payload)], 'family-hub-backup.json', {
    type: 'application/json',
  });
};

const pickFile = (file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(async () => {
  await Promise.all([
    db.shopping.clear(),
    db.tasks.clear(),
    db.deadlines.clear(),
    db.members.clear(),
    db.activity.clear(),
    db.syncMeta.clear(),
    db.kv.clear(),
  ]);
  restartSync.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Восстановление из резервной копии', () => {
  it('добавляет записи из файла и показывает итог', async () => {
    render(<DataSection />);
    pickFile(backupFile([shopping('s1'), shopping('s2')], [task('t1')]));

    await waitFor(async () => expect(await db.shopping.count()).toBe(2));
    expect(await db.tasks.count()).toBe(1);
    expect(await screen.findByText(/Восстановлено: добавлено 3, обновлено 0/)).toBeTruthy();
    expect(restartSync).toHaveBeenCalled();
  });

  it('отказ в подтверждении ничего не меняет', async () => {
    (window.confirm as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<DataSection />);
    pickFile(backupFile([shopping('s1')], []));

    await waitFor(async () => expect(await db.shopping.count()).toBe(0));
    expect(restartSync).not.toHaveBeenCalled();
  });

  it('чужой файл отклоняется с понятным текстом', async () => {
    render(<DataSection />);
    pickFile(new File(['{"hello":1}'], 'другое.json', { type: 'application/json' }));

    expect(await screen.findByText(/не резервная копия Family Hub/)).toBeTruthy();
    expect(await db.shopping.count()).toBe(0);
  });

  it('повторное восстановление того же файла не дублирует записи', async () => {
    render(<DataSection />);
    const file = backupFile([shopping('s1')], []);
    pickFile(file);
    await waitFor(async () => expect(await db.shopping.count()).toBe(1));
    pickFile(file);

    expect(await screen.findByText(/уже есть на устройстве/)).toBeTruthy();
    expect(await db.shopping.count()).toBe(1);
  });
});
