/**
 * Блок «Лента (подписка)» в Настройках (0.6.0): переключатели разделов пишут файл настроек в
 * семейное хранилище, ссылки видны и копируются, «Сменить ссылку» выдаёт новые адреса,
 * а подсказки честно говорят про задержку обновления и про «Удалить будильники» на iPhone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedSubscriptionSection from '../src/features/settings/FeedSubscriptionSection';
import { eventsWord, formatPublishedAt } from '../src/features/settings/feedFormat';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { auth } from '../src/data/remote/authStrategy';
import { resetFeedPathCache } from '../src/data/remote/feed';

const VAPID = {
  vapidPublicKey: 'fixture',
  feed: { owner: 'fixture-owner', repo: 'FAMILY-HUB', branch: 'feed' },
  pushWake: {
    owner: 'fixture-owner',
    repo: 'FAMILY-HUB',
    workflow: 'push-sender.yml',
    ref: 'arena/01a0fbcb-family-hub',
  },
};

const FEED_ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:deadline-keep@family-hub.local',
  'SUMMARY:Family Hub · Опубликованный',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const toB64 = (text: string) => btoa(text);
const fromB64 = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));

let stored: Record<string, unknown> | null = null;
let puts: string[] = [];
/** Запуски отправителя, о которых просило приложение (POST .../dispatches). */
let dispatches: string[] = [];
/** Задержка сохранения: позволяет увидеть подпись «включаем…» в момент записи. */
let putGate: Promise<void> | null = null;
/**
 * Как ведёт себя адрес подписки (raw.githubusercontent.com). Провайдеры в России его иногда
 * закрывают, поэтому у приложения есть запасной путь через api.github.com.
 */
let rawMode: 'ok' | 'fail' | 'missing' = 'ok';
/** Ответ запасного пути: содержимое файла ленты ('' — файла нет, 'fail' — запрос не прошёл). */
let apiMode: 'ok' | 'fail' | 'missing' = 'ok';

function stubGithub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('vapid.json')) {
        return new Response(JSON.stringify(VAPID), { status: 200 });
      }
      if (String(url).includes('raw.githubusercontent.com')) {
        if (rawMode === 'fail') throw new TypeError('Failed to fetch');
        if (rawMode === 'missing') return new Response('404: Not Found', { status: 404 });
        return new Response(FEED_ICS, { status: 200 });
      }
      if (String(url).includes('/contents/feed/')) {
        if (apiMode === 'fail') throw new TypeError('Failed to fetch');
        if (apiMode === 'missing') return new Response('{}', { status: 404 });
        return new Response(FEED_ICS, { status: 200 });
      }
      const target = new URL(String(url));
      if (!target.pathname.startsWith('/repos/')) throw new Error(`неожиданный запрос ${url}`);
      if (target.pathname.endsWith('/dispatches')) {
        dispatches.push(String(url));
        return new Response(null, { status: 204 });
      }
      if (init?.method === 'PUT') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as {
          content: string;
        };
        puts.push(fromB64(body.content));
        if (putGate) await putGate;
        return new Response(JSON.stringify({ content: { sha: 'new' } }), { status: 200 });
      }
      if (target.pathname.endsWith('/data/feed.json')) {
        if (!stored) return new Response('{}', { status: 404 });
        return new Response(
          JSON.stringify({
            sha: 'sha-1',
            encoding: 'base64',
            content: toB64(JSON.stringify(stored)),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }),
  );
}

beforeEach(async () => {
  stored = null;
  puts = [];
  dispatches = [];
  putGate = null;
  rawMode = 'ok';
  apiMode = 'ok';
  // Память о рабочем пути чтения — между тестами сбрасываем, иначе тесты влияют друг на друга.
  resetFeedPathCache();
  await db.kv.clear();
  await db.deadlines.clear();
  await db.tasks.clear();
  await kvSet(KV_KEYS.remoteOwner, 'fixture-owner');
  await kvSet(KV_KEYS.remoteRepo, 'fixture-data');
  await kvSet(KV_KEYS.remoteBranch, 'main');
  vi.spyOn(auth, 'getToken').mockResolvedValue('fixture-token');
  stubGithub();
});

describe('лента в Настройках', () => {
  it('до включения объясняет, что ссылка появится сразу после включения раздела', async () => {
    render(<FeedSubscriptionSection />);
    await screen.findByLabelText('Лента: Сроки');
    expect(screen.getByLabelText('Лента: Дела с датой')).toBeTruthy();
    // Ссылок нет, пока разделы выключены, и это сказано словами.
    expect(screen.queryByTestId('feed-url-deadlines')).toBeNull();
    expect(screen.getAllByText(/включите его, и ссылка появится сразу/u)).toHaveLength(2);
  });

  it('после включения раздела ссылка становится видимой и вставляется в календарь', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: null,
    };
    render(<FeedSubscriptionSection />);
    const url = await screen.findByTestId('feed-url-deadlines');
    expect(url.textContent).toBe(
      `https://raw.githubusercontent.com/fixture-owner/FAMILY-HUB/feed/feed/${'a'.repeat(32)}.ics`,
    );
    expect(screen.getByText('Файл появится после ближайшего запуска')).toBeTruthy();
  });

  it('включение раздела сохраняет файл настроек и объясняет задержку', async () => {
    stored = {
      sections: { deadlines: false, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: null,
    };
    render(<FeedSubscriptionSection />);
    const sw = await screen.findByLabelText('Лента: Сроки');
    await userEvent.click(sw);
    await waitFor(() => expect(puts.length).toBe(1));
    const saved = JSON.parse(puts[0] ?? '{}') as {
      sections: { deadlines: boolean; tasks: boolean };
      slugs: { deadlines: string };
    };
    expect(saved.sections.deadlines).toBe(true);
    expect(saved.sections.tasks).toBe(false);
    // Секретная часть адреса при включении не меняется — ссылка остаётся прежней.
    expect(saved.slugs.deadlines).toBe('a'.repeat(32));
    expect(await screen.findByText(/ближайший запуск/u)).toBeTruthy();
  });

  it('показывает, когда лента обновлялась (чтобы проверять без похода в GitHub)', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:15:46.000Z',
    };
    render(<FeedSubscriptionSection />);
    const line = await screen.findByTestId('feed-published-deadlines');
    expect(line.textContent).toContain('Обновлено:');
    // 11:15 UTC = 14:15 по Москве; формат — единый для всей семьи.
    expect(line.textContent).toContain('14:15');
    expect(line.textContent).toContain('Москва');
    // Пока отправитель не публиковал, обещаем появление файла, а не время.
    expect(screen.queryByTestId('feed-published-tasks')).toBeNull();
  });

  it('число событий склоняется по-русски', () => {
    expect([1, 2, 5, 11, 21, 22].map(eventsWord)).toEqual([
      'событие',
      'события',
      'событий',
      'событий',
      'событие',
      'события',
    ]);
  });

  it('время публикации переводится в Москву и не ломается на мусоре', () => {
    expect(formatPublishedAt('2026-10-05T11:15:46.000Z')).toBe('05.10, 14:15 (Москва)');
    expect(formatPublishedAt('не дата')).toBe('время неизвестно');
  });

  it('во время сохранения подпись говорит «включаем…/выключаем…», как в push-блоке', async () => {
    stored = {
      sections: { deadlines: false, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: null,
    };
    let release!: () => void;
    putGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<FeedSubscriptionSection />);
    const sw = await screen.findByLabelText('Лента: Сроки');
    expect(screen.getByTestId('feed-state-deadlines').textContent).toBe('выключено');
    expect(screen.getByTestId('feed-state-tasks').textContent).toBe('выключено');

    await userEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByTestId('feed-state-deadlines').textContent).toBe('включаем…'),
    );
    // Соседний раздел не мигает: подпись относится только к своему переключателю.
    expect(screen.getByTestId('feed-state-tasks').textContent).toBe('выключено');
    release();
    await waitFor(() =>
      expect(screen.getByTestId('feed-state-deadlines').textContent).toBe('включено'),
    );

    // Выключение подписано так же честно.
    let releaseOff!: () => void;
    putGate = new Promise<void>((resolve) => {
      releaseOff = resolve;
    });
    await userEvent.click(screen.getByLabelText('Лента: Сроки'));
    await waitFor(() =>
      expect(screen.getByTestId('feed-state-deadlines').textContent).toBe('выключаем…'),
    );
    releaseOff();
    await waitFor(() =>
      expect(screen.getByTestId('feed-state-deadlines').textContent).toBe('выключено'),
    );
  });

  it('показывает, что в файле, и объясняет, почему запись не попала', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    await db.deadlines.bulkPut([
      { id: 'keep', title: 'Опубликованный', dueDate: '2026-10-07', visibility: 'family' },
      { id: 'priv', title: 'Секретное', dueDate: '2026-10-08', visibility: 'private' },
      { id: 'fresh', title: 'Только что', dueDate: '2026-10-09', visibility: 'family' },
    ] as never);
    render(<FeedSubscriptionSection />);
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain(
        'В файле сейчас: 1 событие',
      ),
    );
    const check = screen.getByTestId('feed-check-deadlines');
    expect(check.textContent).toContain('Секретное');
    expect(check.textContent).toContain('личный срок');
    expect(check.textContent).toContain('Ещё не опубликовано: 1');
    // И честная подсказка про причину на стороне Google.
    expect(check.textContent).toContain('Google');
  });

  it('адрес подписки закрыт провайдером — читаем файл через api.github.com', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    // Ровно случай владельца: raw.githubusercontent.com не открывается, а api.github.com
    // работает — через него идёт синхронизация.
    rawMode = 'fail';
    await db.deadlines.put({
      id: 'keep',
      title: 'Опубликованный',
      dueDate: '2026-10-07',
      visibility: 'family',
    } as never);
    render(<FeedSubscriptionSection />);
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain(
        'В файле сейчас: 1 событие',
      ),
    );
  });

  it('файла по ссылке ещё нет — говорим, что публикация не проходила', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    rawMode = 'missing';
    apiMode = 'missing';
    render(<FeedSubscriptionSection />);
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain(
        'Файла по этой ссылке пока нет',
      ),
    );
    expect(screen.getByTestId('feed-check-deadlines').textContent).toContain('Обновить ленту');
  });

  it('не читается ни одним путём — объясняем честно и про подписку не пугаем', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    rawMode = 'fail';
    apiMode = 'fail';
    render(<FeedSubscriptionSection />);
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain(
        'прочитать не удалось',
      ),
    );
    const check = screen.getByTestId('feed-check-deadlines');
    expect(check.textContent).toContain('не влияет');
    expect(check.textContent).toContain('BEGIN:VCALENDAR');
  });

  it('во время чтения файла сразу видно «Проверяю файл…», а кнопка занята', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    // Чтение «зависает»: без метки «проверяю…» нажатие выглядело как неработающая кнопка.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('vapid.json')) {
          return new Response(JSON.stringify(VAPID), { status: 200 });
        }
        if (String(url).includes('raw.githubusercontent.com')) {
          await gate;
          return new Response(FEED_ICS, { status: 200 });
        }
        const target = new URL(String(url));
        if (target.pathname.endsWith('/data/feed.json')) {
          return new Response(
            JSON.stringify({
              sha: 's',
              encoding: 'base64',
              content: toB64(JSON.stringify(stored)),
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );
    render(<FeedSubscriptionSection />);
    expect(await screen.findByText('Проверяю файл…')).toBeTruthy();
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: 'читаю файл…' });
    expect(btn.disabled).toBe(true);
    release();
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain('В файле сейчас'),
    );
  });

  it('если адрес подписки закрыт, следующий раз читаем сразу через API (без ожидания)', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    rawMode = 'fail';
    render(<FeedSubscriptionSection />);
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain('В файле сейчас'),
    );
    const rawCalls = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
        String(c[0]).includes('raw.githubusercontent.com'),
      ).length;
    const before = rawCalls();
    await userEvent.click(screen.getByRole('button', { name: 'Перечитать файл' }));
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain('В файле сейчас'),
    );
    // Повторное чтение не мучает закрытый адрес: сразу идёт запасной путь.
    expect(rawCalls()).toBe(before);
  });

  it('«Обновить ленту сейчас» просит GitHub запустить отправителя и обещает перечитать файл', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    render(<FeedSubscriptionSection />);
    await screen.findByTestId('feed-url-deadlines');
    await userEvent.click(screen.getByRole('button', { name: 'Обновить ленту сейчас' }));
    await waitFor(() => expect(dispatches).toHaveLength(1));
    expect(dispatches[0]).toContain('/actions/workflows/push-sender.yml/dispatches');
    expect(await screen.findByText(/1–2 минуты/u)).toBeTruthy();
  });

  it('результат сверки стоит под кнопками, а не над ссылкой', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    render(<FeedSubscriptionSection />);
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain('В файле сейчас'),
    );
    const check = screen.getByTestId('feed-check-deadlines');
    const button = screen.getByRole('button', { name: 'Перечитать файл' });
    // Владелец 05.10.2026: жал на кнопку и искал ответ рядом с ней, а не выше ссылки.
    expect(button.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('«Перечитать файл» обновляет сверку без новых правок', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T11:48:30.000Z',
    };
    render(<FeedSubscriptionSection />);
    await screen.findByTestId('feed-check-deadlines');
    await userEvent.click(screen.getByRole('button', { name: 'Перечитать файл' }));
    await waitFor(() =>
      expect(screen.getByTestId('feed-check-deadlines').textContent).toContain('В файле сейчас'),
    );
  });

  it('«Сменить ссылку» выдаёт новые адреса, а прежние уходят на удаление', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: '2026-10-05T09:00:00.000Z',
    };
    render(<FeedSubscriptionSection />);
    await screen.findByTestId('feed-url-deadlines');
    await userEvent.click(screen.getByRole('button', { name: 'Сменить ссылку' }));
    await waitFor(() => expect(puts.length).toBe(1));
    const saved = JSON.parse(puts[0] ?? '{}') as {
      slugs: { deadlines: string; tasks: string };
      previousSlugs: string[];
    };
    expect(saved.slugs.deadlines).not.toBe('a'.repeat(32));
    expect(saved.slugs.tasks).not.toBe('b'.repeat(32));
    expect(saved.previousSlugs).toContain('a'.repeat(32));
    expect(await screen.findByText(/Старые перестанут работать/u)).toBeTruthy();
  });

  it('ссылка копируется, а при недоступности буфера предлагает копировать вручную', async () => {
    stored = {
      sections: { deadlines: true, tasks: false },
      slugs: { deadlines: 'a'.repeat(32), tasks: 'b'.repeat(32) },
      previousSlugs: [],
      publishedAt: null,
    };
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    render(<FeedSubscriptionSection />);
    await screen.findByTestId('feed-url-deadlines');
    const buttons = screen.getAllByRole('button', { name: 'Скопировать ссылку' });
    await userEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findByText(/скопируйте вручную/u)).toBeTruthy();
  });

  it('подсказка честно говорит про обновление раз в часы и «Удалить будильники»', async () => {
    render(<FeedSubscriptionSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Как подписаться' }));
    const sheet = await screen.findByRole('dialog', { name: 'Лента: как это работает' });
    expect(within(sheet).getByText(/Подписной\s+календарь/u)).toBeTruthy();
    expect(within(sheet).getByText(/Добавить по URL/u)).toBeTruthy();
    expect(within(sheet).getByText(/часы, иногда сутки/u)).toBeTruthy();
    expect(within(sheet).getByText(/Удалить будильники/u)).toBeTruthy();
    expect(within(sheet).getByText(/только исполнитель/u)).toBeTruthy();
  });
});
