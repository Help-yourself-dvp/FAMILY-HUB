/** Только фикстуры и исходник публичного workflow, без семейного хранилища. */
import { describe, expect, it } from 'vitest';
import { deadlineRows } from '../scripts/push-sender-data.mjs';
import pushWorkflow from '../.github/workflows/push-sender.yml?raw';

const deadline = {
  id: 'fixture-deadline',
  title: 'Учебный срок',
  dueDate: '2026-10-02',
  remindersDays: [0],
  deletedAt: null,
  visibility: 'family',
};

describe('отправитель push — формат сроков', () => {
  it('читает entities из конверта RemoteFile, который пишет синхронизация приложения', () => {
    expect(
      deadlineRows({
        schemaVersion: 1,
        fileRev: 2,
        updatedAt: '2026-10-02T08:00:00Z',
        entities: { 'fixture-deadline': deadline },
      }),
    ).toEqual([deadline]);
  });

  it('пустое хранилище и прежний массив тоже читаются', () => {
    expect(deadlineRows({ entities: {} })).toEqual([]);
    expect(deadlineRows([deadline])).toEqual([deadline]);
  });

  it('некорректный конверт не принимается за список сроков', () => {
    for (const invalid of [null, undefined, 'text', 3, {}, { entities: [] }]) {
      expect(deadlineRows(invalid)).toBeNull();
    }
  });
});

describe('отправитель push — чистый GitHub runner', () => {
  it('устанавливает зависимости из lock-файла до запуска скрипта', () => {
    const installAt = pushWorkflow.indexOf('npm ci');
    const senderAt = pushWorkflow.indexOf('node scripts/push-sender.mjs');
    expect(installAt).toBeGreaterThan(-1);
    expect(senderAt).toBeGreaterThan(installAt);
  });
});
