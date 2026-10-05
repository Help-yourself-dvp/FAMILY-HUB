/**
 * Быстрая публикация ленты (0.6.9) — scripts/feed-publish.mjs.
 *
 * Проверяем цикл на вымышленных данных: сеть запрещена, поэтому все побочные эффекты
 * (чтение/запись семейного хранилища, публикация файлов) — внедрённые фейки. Важно:
 *  - выключенный раздел уезжает ПУСТЫМ календарём (подписка очистится);
 *  - сбой одного раздела не роняет другой;
 *  - отметка publishedAt пишется только после реальной публикации;
 *  - без файла настроек ничего не публикуется и это не ошибка.
 */
import { describe, expect, it } from 'vitest';
import { FEED_SECTIONS, parseFeedSettings, runFeedPublish } from '../scripts/feed-publish.mjs';

const SETTINGS = {
  sections: { deadlines: true, tasks: true },
  slugs: {
    deadlines: 'a'.repeat(32),
    tasks: 'b'.repeat(32),
  },
  previousSlugs: [],
};

const DEADLINES = {
  schemaVersion: 1,
  entities: {
    'dl-1': {
      id: 'dl-1',
      rev: 1,
      title: 'ТО автомобиля',
      dueDate: '2026-11-15',
      remindersDays: [30, 0],
      deletedAt: null,
      visibility: 'family',
      updatedAt: '2026-10-01T09:00:00.000Z',
    },
  },
};

const TASKS = {
  schemaVersion: 1,
  entities: {
    't-1': {
      id: 't-1',
      rev: 1,
      title: 'Забрать документы',
      dueDate: '2026-11-20',
      status: 'open',
      deletedAt: null,
      updatedAt: '2026-10-02T09:00:00.000Z',
    },
  },
};

/** Фейки окружения: запоминают вызовы, чтобы проверять побочные эффекты. */
function makeDeps(over: Partial<Parameters<typeof runFeedPublish>[0]> = {}) {
  const published: { section: string; slug: string; content: string }[] = [];
  const deleted: string[] = [];
  const written: { path: string; data: unknown; message: string }[] = [];
  const notes: [string, string][] = [];
  const deps = {
    env: { family: 'o/data', public: 'o/app', publicToken: 'token' },
    getJson: (path: string) => {
      if (path === 'data/feed.json') return Promise.resolve(SETTINGS);
      if (path === 'data/deadlines.json') return Promise.resolve(DEADLINES);
      if (path === 'data/tasks.json') return Promise.resolve(TASKS);
      return Promise.resolve(null);
    },
    putJson: (path: string, data: unknown, message: string) => {
      written.push({ path, data, message });
      return Promise.resolve();
    },
    publishIcs: ({
      section,
      slug,
      content,
    }: {
      section: string;
      slug: string;
      content: string;
    }) => {
      published.push({ section, slug, content });
      return Promise.resolve();
    },
    deleteIcs: (slug: string) => {
      deleted.push(slug);
      return Promise.resolve(true);
    },
    annotation: (level: string, message: string) => notes.push([level, message]),
    now: () => '2026-10-05T17:00:00.000Z',
    ...over,
  };
  return { deps, published, deleted, written, notes };
}

describe('настройки ленты (parseFeedSettings)', () => {
  it('нет файла или битые ссылки — лента не включалась', () => {
    expect(parseFeedSettings(null)).toBeNull();
    expect(parseFeedSettings([])).toBeNull();
    expect(parseFeedSettings({ slugs: { deadlines: 'x', tasks: 'b'.repeat(32) } })).toBeNull();
    expect(parseFeedSettings({ slugs: {} })).toBeNull();
  });

  it('разделы включаются только явным true', () => {
    const s = parseFeedSettings({
      sections: { deadlines: true, tasks: 'yes' },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: ['c'.repeat(32), 'плохая', 5],
    });
    expect(s).toEqual({
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: ['c'.repeat(32)],
    });
  });
});

describe('цикл публикации (runFeedPublish)', () => {
  it('оба включённых раздела публикуются с событиями и отметкой времени', async () => {
    const { deps, published, written } = makeDeps();
    const result = await runFeedPublish(deps);
    expect(result).toEqual({ enabled: true, published: 2, removed: 0 });

    const deadlines = published.find((p) => p.section === 'deadlines');
    const tasks = published.find((p) => p.section === 'tasks');
    expect(deadlines?.slug).toBe('a'.repeat(32));
    expect(deadlines?.content).toContain('SUMMARY:Family Hub · ТО автомобиля');
    expect(deadlines?.content).toContain('TRIGGER:-P30D');
    expect(tasks?.content).toContain('SUMMARY:Family Hub · Забрать документы');
    // У дел будильников нет — звонок всем о чужом деле был бы шумом.
    expect(tasks?.content).not.toContain('VALARM');

    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe('data/feed.json');
    expect(written[0]?.data).toMatchObject({
      sections: { deadlines: true, tasks: true },
      previousSlugs: [],
      publishedAt: '2026-10-05T17:00:00.000Z',
    });
  });

  it('выключенный раздел публикуется пустым календарём — подписка очистится', async () => {
    const { deps, published } = makeDeps({
      getJson: (path: string) =>
        Promise.resolve(
          path === 'data/feed.json'
            ? { ...SETTINGS, sections: { deadlines: false, tasks: true } }
            : path === 'data/deadlines.json'
              ? DEADLINES
              : path === 'data/tasks.json'
                ? TASKS
                : null,
        ),
    });
    const result = await runFeedPublish(deps);
    expect(result.published).toBe(2);
    const deadlines = published.find((p) => p.section === 'deadlines');
    expect(deadlines?.content).toContain('BEGIN:VCALENDAR');
    expect(deadlines?.content).not.toContain('BEGIN:VEVENT');
  });

  it('старые ссылки удаляются, текущие — нет', async () => {
    const { deps, deleted } = makeDeps({
      getJson: (path: string) =>
        Promise.resolve(
          path === 'data/feed.json'
            ? { ...SETTINGS, previousSlugs: ['c'.repeat(32), 'a'.repeat(32)] }
            : path === 'data/deadlines.json'
              ? DEADLINES
              : path === 'data/tasks.json'
                ? TASKS
                : null,
        ),
    });
    const result = await runFeedPublish(deps);
    expect(result.removed).toBe(1);
    expect(deleted).toEqual(['c'.repeat(32)]);
  });

  it('лента ни разу не включалась — публиковать нечего, и это не ошибка', async () => {
    const { deps, published, written, notes } = makeDeps({
      getJson: (path: string) => Promise.resolve(path === 'data/feed.json' ? null : DEADLINES),
    });
    const result = await runFeedPublish(deps);
    expect(result).toEqual({ enabled: false, published: 0, removed: 0 });
    expect(published).toHaveLength(0);
    expect(written).toHaveLength(0);
    // Предупреждений нет: молчание здесь — правильное поведение.
    expect(notes.filter(([level]) => level === 'warning')).toHaveLength(0);
  });

  it('нет доступа к публичному репозиторию — честное предупреждение, ничего не публикуем', async () => {
    const { deps, published, notes } = makeDeps({
      env: { family: 'o/data', public: '', publicToken: '' },
    });
    const result = await runFeedPublish(deps);
    expect(result.enabled).toBe(false);
    expect(published).toHaveLength(0);
    expect(notes.some(([, m]) => m.includes('публичному репозиторию'))).toBe(true);
  });

  it('сбой одного раздела не мешает другому', async () => {
    const { deps, published, written, notes } = makeDeps({
      publishIcs: ({
        section,
        slug,
        content,
      }: {
        section: string;
        slug: string;
        content: string;
      }) => {
        if (section === 'deadlines') {
          return Promise.reject(new Error('feed: публикация не удалась (HTTP 500)'));
        }
        published.push({ section, slug, content });
        return Promise.resolve();
      },
    });
    const result = await runFeedPublish(deps);
    expect(result.published).toBe(1);
    expect(published.map((p) => p.section)).toEqual(['tasks']);
    // Отметка пишется: часть ленты свежая — лучше, чем никакой.
    expect(written).toHaveLength(1);
    expect(notes.some(([level]) => level === 'warning')).toBe(true);
  });

  it('нечитаются сроки — дела всё равно публикуются, с предупреждением', async () => {
    const { deps, published, notes } = makeDeps({
      getJson: (path: string) => {
        if (path === 'data/feed.json') return Promise.resolve(SETTINGS);
        if (path === 'data/deadlines.json') return Promise.reject(new Error('HTTP 500'));
        if (path === 'data/tasks.json') return Promise.resolve(TASKS);
        return Promise.resolve(null);
      },
    });
    const result = await runFeedPublish(deps);
    expect(result.published).toBe(2);
    const deadlines = published.find((p) => p.section === 'deadlines');
    expect(deadlines?.content).not.toContain('BEGIN:VEVENT');
    expect(notes.some(([, m]) => m.includes('сроки'))).toBe(true);
  });

  it('отметку опубликовать не удалось — файлы на месте, предупреждение, без падения', async () => {
    const { deps, published, written, notes } = makeDeps({
      putJson: () => Promise.reject(new Error('PUT data/feed.json: HTTP 409')),
    });
    const result = await runFeedPublish(deps);
    expect(result.published).toBe(2);
    expect(published).toHaveLength(2);
    expect(written).toHaveLength(0);
    expect(notes.some(([level, m]) => level === 'warning' && m.includes('отметку'))).toBe(true);
  });

  it('порядок разделов фиксирован: файлы создаются детерминированно', () => {
    expect(FEED_SECTIONS).toEqual(['deadlines', 'tasks']);
  });
});
