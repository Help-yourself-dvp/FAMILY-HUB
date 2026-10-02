/**
 * Семейная лента на принимающем устройстве (приёмка 0.1.7): правило вывода
 * действия из «было/стало» для чужих изменений, применённых синхронизацией.
 */
import { describe, expect, it } from 'vitest';
import { remoteActionOf } from '../src/data/sync/core';
import type { ShoppingItem } from '../src/domain/types';

function row(patch: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: 'x',
    rev: 1,
    kind: 'shopping',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'dev-2',
    deletedAt: null,
    title: 'Молоко',
    canonicalKey: 'молоко',
    qty: null,
    unit: null,
    category: null,
    store: null,
    horizon: 'now',
    note: null,
    done: false,
    doneAt: null,
    doneBy: null,
    ...patch,
  };
}

describe('remoteActionOf', () => {
  it('не было локально → создано', () => {
    expect(remoteActionOf(undefined, row())).toBe('created');
  });
  it('стало купленным → куплено', () => {
    expect(remoteActionOf(row(), row({ rev: 2, done: true }))).toBe('completed');
  });
  it('появился tombstone → удалено', () => {
    expect(remoteActionOf(row(), row({ rev: 2, deletedAt: '2026-10-01T10:00:00.000Z' }))).toBe(
      'deleted',
    );
  });
  it('прочие изменения → изменено', () => {
    expect(remoteActionOf(row(), row({ rev: 2, qty: 2 }))).toBe('updated');
  });
});
