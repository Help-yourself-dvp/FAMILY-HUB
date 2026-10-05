/**
 * Блок «Лента (подписка)» в Настройках (0.6.0): переключатели разделов пишут файл настроек в
 * семейное хранилище, ссылки видны и копируются, «Сменить ссылку» выдаёт новые адреса,
 * а подсказки честно говорят про задержку обновления и про «Удалить будильники» на iPhone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedSubscriptionSection from '../src/features/settings/FeedSubscriptionSection';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { auth } from '../src/data/remote/authStrategy';

const VAPID = {
  vapidPublicKey: 'fixture',
  feed: { owner: 'fixture-owner', repo: 'FAMILY-HUB', branch: 'feed' },
};

const toB64 = (text: string) => btoa(text);
const fromB64 = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));

let stored: Record<string, unknown> | null = null;
let puts: string[] = [];

function stubGithub() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('vapid.json')) {
        return Promise.resolve(new Response(JSON.stringify(VAPID), { status: 200 }));
      }
      const target = new URL(String(url));
      if (!target.pathname.startsWith('/repos/')) throw new Error(`неожиданный запрос ${url}`);
      if (init?.method === 'PUT') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as {
          content: string;
        };
        puts.push(fromB64(body.content));
        return Promise.resolve(
          new Response(JSON.stringify({ content: { sha: 'new' } }), { status: 200 }),
        );
      }
      if (target.pathname.endsWith('/data/feed.json')) {
        if (!stored) return Promise.resolve(new Response('{}', { status: 404 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sha: 'sha-1',
              encoding: 'base64',
              content: toB64(JSON.stringify(stored)),
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
}

beforeEach(async () => {
  stored = null;
  puts = [];
  await db.kv.clear();
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
