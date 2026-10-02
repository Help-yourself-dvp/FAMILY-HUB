/**
 * Тесты ядра синхронизации на фальшивых хранилищах: push, pull, retry на 409,
 * и «не писать, если merged совпал с remote» (экономия коммитов и минут Actions).
 */
import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  syncKind,
  type LocalStorePort,
  type RemoteStorePort,
} from '../src/data/sync/core';
import type { EntityKind, RemoteFile, Syncable, ShoppingItem } from '../src/domain/types';
import { SCHEMA_VERSION } from '../src/domain/types';

const NOW = '2026-10-01T10:00:00.000Z';

function item(id: string, over: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id,
    rev: 1,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'dev-A',
    deletedAt: null,
    kind: 'shopping',
    title: id,
    canonicalKey: id,
    qty: null,
    unit: null,
    category: null,
    store: null,
    horizon: 'now',
    note: null,
    done: false,
    doneAt: null,
    doneBy: null,
    ...over,
  };
}

class FakeLocal implements LocalStorePort {
  entities: Record<EntityKind, Record<string, Syncable>> = {
    shopping: {},
    tasks: {},
    deadlines: {},
    dictionary: {},
    members: {},
  };
  base: Record<EntityKind, Record<string, number>> = {
    shopping: {},
    tasks: {},
    deadlines: {},
    dictionary: {},
    members: {},
  };
  writes = 0;

  read<T extends Syncable>(kind: EntityKind): Promise<Record<string, T>> {
    return Promise.resolve(this.entities[kind] as Record<string, T>);
  }
  readBase(kind: EntityKind): Promise<Record<string, number>> {
    return Promise.resolve(this.base[kind]);
  }
  write<T extends Syncable>(kind: EntityKind, merged: Record<string, T>): Promise<void> {
    this.entities[kind] = merged;
    for (const [id, e] of Object.entries(merged)) this.base[kind][id] = e.rev;
    this.writes += 1;
    return Promise.resolve();
  }
}

class FakeRemote implements RemoteStorePort {
  file: RemoteFile<Syncable> = {
    schemaVersion: SCHEMA_VERSION,
    fileRev: 0,
    updatedAt: '',
    entities: {},
  };
  sha: string | null = null;
  /** Сколько раз бросить ConflictError перед успехом. */
  failConflicts = 0;
  putCalls = 0;

  read<T extends Syncable>(): Promise<{ file: RemoteFile<T>; sha: string | null }> {
    return Promise.resolve({ file: this.file as RemoteFile<T>, sha: this.sha });
  }
  write<T extends Syncable>(
    _kind: EntityKind,
    file: RemoteFile<T>,
    sha: string | null,
  ): Promise<string> {
    if (this.failConflicts > 0) {
      this.failConflicts -= 1;
      throw new ConflictError('sha mismatch (409)');
    }
    if (this.sha !== sha && this.sha !== null) throw new ConflictError('unexpected sha');
    this.file = file;
    this.sha = `sha-${++this.putCalls}`;
    return Promise.resolve(this.sha);
  }
}

describe('push: локальное изменение уходит в remote', () => {
  it('одна запись, одна запись в remote, base обновлён', async () => {
    const local = new FakeLocal();
    const remote = new FakeRemote();
    local.entities.shopping = { milk: item('milk') };

    const r = await syncKind('shopping', local, remote, { nowIso: () => NOW });

    expect(r.pushed).toBe(1);
    expect(remote.file.entities.milk).toBeDefined();
    expect(remote.file.fileRev).toBe(1);
    expect(local.base.shopping.milk).toBe(1);
    // повторный цикл ничего не пишет: merged === remote
    const before = remote.putCalls;
    const r2 = await syncKind('shopping', local, remote, { nowIso: () => NOW });
    expect(r2.pushed).toBe(0);
    expect(remote.putCalls).toBe(before);
  });
});

describe('pull: изменение с другого устройства приходит локально', () => {
  it('remote содержит запись, которой нет локально', async () => {
    const local = new FakeLocal();
    const remote = new FakeRemote();
    remote.file.entities = { bread: { ...item('bread'), updatedBy: 'dev-iphone' } };
    remote.sha = 'sha-x';

    const r = await syncKind('shopping', local, remote, { nowIso: () => NOW });

    expect(r.pulled).toBe(1);
    expect(local.entities.shopping.bread).toBeDefined();
    expect(remote.putCalls).toBe(0); // писать нечего
  });
});

describe('одновременные изменения разных сущностей не теряются', () => {
  it('локально молоко, в remote хлеб → обе в merged', async () => {
    const local = new FakeLocal();
    const remote = new FakeRemote();
    local.entities.shopping = { milk: item('milk', { updatedBy: 'dev-honor' }) };
    remote.file.entities = { bread: item('bread', { updatedBy: 'dev-iphone' }) };
    remote.sha = 'sha-x';

    await syncKind('shopping', local, remote, { nowIso: () => NOW });

    expect(Object.keys(local.entities.shopping).sort()).toEqual(['bread', 'milk']);
    expect(Object.keys(remote.file.entities).sort()).toEqual(['bread', 'milk']);
  });
});

describe('retry на 409 Conflict', () => {
  it('первый PUT отклонён, второй успешен', async () => {
    const local = new FakeLocal();
    const remote = new FakeRemote();
    remote.failConflicts = 1;
    local.entities.shopping = { milk: item('milk') };

    const retries: number[] = [];
    const r = await syncKind('shopping', local, remote, {
      nowIso: () => NOW,
      onRetry: (_k, attempt) => retries.push(attempt),
    });

    expect(retries).toEqual([1]);
    expect(r.attempts).toBe(2);
    expect(remote.file.entities.milk).toBeDefined();
  });

  it('исчерпание попыток → ошибка наружу, данные не теряются', async () => {
    const local = new FakeLocal();
    const remote = new FakeRemote();
    remote.failConflicts = 99;
    local.entities.shopping = { milk: item('milk') };

    await expect(
      syncKind('shopping', local, remote, { nowIso: () => NOW, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(ConflictError);

    // локальные данные intact — при следующей успешной синхронизации они уйдут
    expect(local.entities.shopping.milk).toBeDefined();
  });
});

describe('конфликт одной сущности фиксируется, но не теряет данные', () => {
  it('обе стороны правили milk → merged содержит победителя, конфликт учтён', async () => {
    const local = new FakeLocal();
    const remote = new FakeRemote();
    local.entities.shopping = {
      milk: {
        ...item('milk'),
        qty: 1,
        rev: 2,
        updatedAt: '2026-10-01T10:00:00Z',
        updatedBy: 'dev-A',
      } as unknown as Syncable,
    };
    local.base.shopping = { milk: 1 };
    remote.file.entities = {
      milk: {
        ...item('milk'),
        qty: 9,
        rev: 2,
        updatedAt: '2026-10-01T11:00:00Z',
        updatedBy: 'dev-B',
      } as unknown as Syncable,
    };
    remote.sha = 'sha-x';

    let conflictCount = 0;
    const r = await syncKind('shopping', local, remote, {
      nowIso: () => NOW,
      onConflict: (_k, n) => {
        conflictCount += n;
      },
    });

    expect(conflictCount).toBe(1);
    expect(r.conflicts).toBe(1);
    expect((local.entities.shopping['milk'] as ShoppingItem).qty).toBe(9); // remote позже
  });
});
