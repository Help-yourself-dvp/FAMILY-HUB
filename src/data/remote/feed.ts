/**
 * Лента (подписка) — сторона приложения (0.6.0).
 *
 * Приложение не создаёт события в календаре (система этого не разрешает), зато умеет
 * подготовить постоянную ссылку: отправитель собирает .ics и кладёт по этой ссылке, а
 * календарь телефона сам его перечитывает. Здесь живут только настройки подписки —
 * разделы, «секретные» части адресов и время публикации:
 *
 *   data/feed.json = { sections, slugs, previousSlugs, publishedAt }
 *
 * Файл читают оба: приложение (чтобы показать ссылку) и отправитель (чтобы знать, что
 * публиковать). Нет файла — значит, лента ещё ни разу не включалась, и публиковать нечего.
 */
import { auth } from './authStrategy';
import { GitHubClient, GitHubError } from './githubClient';
import { kvGet, KV_KEYS } from '../db';

export type FeedSection = 'deadlines' | 'tasks';

export interface FeedSections {
  deadlines: boolean;
  tasks: boolean;
}

export interface FeedState {
  sections: FeedSections;
  slugs: Record<FeedSection, string>;
  /** Ссылки, которые перестанут работать после публикации (смена ссылки). */
  previousSlugs: string[];
  publishedAt: string | null;
}

export interface FeedConfig {
  owner: string;
  repo: string;
  branch: string;
}

/** Только цифры и латиница нижнего регистра: адрес должен быть неугадываемым. */
const SLUG_RE = /^[a-f0-9]{16,64}$/u;

/** Секретная часть адреса: 32 шестнадцатеричных знака (как у секретных ссылок GitHub). */
export function newFeedSlug(random: () => string = () => crypto.randomUUID()): string {
  return random().replaceAll('-', '').toLowerCase();
}

export function emptyFeedState(): FeedState {
  return {
    sections: { deadlines: false, tasks: false },
    slugs: { deadlines: newFeedSlug(), tasks: newFeedSlug() },
    previousSlugs: [],
    publishedAt: null,
  };
}

/** Настройки публичного расположения ленты: лежат в vapid.json, меняются без пересборки. */
export async function loadFeedConfig(): Promise<FeedConfig | null> {
  try {
    const res = await fetch(new URL('vapid.json', document.baseURI).href);
    const cfg = (await res.json()) as { feed?: Partial<FeedConfig> };
    const f = cfg.feed;
    if (!f || typeof f.owner !== 'string' || typeof f.repo !== 'string') return null;
    return {
      owner: f.owner,
      repo: f.repo,
      branch: typeof f.branch === 'string' ? f.branch : 'feed',
    };
  } catch {
    return null;
  }
}

/** Постоянный адрес файла ленты — его вставляют в календарь телефона. */
export function feedUrl(cfg: FeedConfig, slug: string): string {
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/feed/${slug}.ics`;
}

function parseState(raw: unknown): FeedState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  const sections = (doc.sections ?? {}) as Record<string, unknown>;
  const slugs = (doc.slugs ?? {}) as Record<string, unknown>;
  if (typeof slugs.deadlines !== 'string' || typeof slugs.tasks !== 'string') return null;
  if (!SLUG_RE.test(slugs.deadlines) || !SLUG_RE.test(slugs.tasks)) return null;
  const previous = Array.isArray(doc.previousSlugs)
    ? doc.previousSlugs.filter((s): s is string => typeof s === 'string' && SLUG_RE.test(s))
    : [];
  return {
    sections: { deadlines: sections.deadlines === true, tasks: sections.tasks === true },
    slugs: { deadlines: slugs.deadlines, tasks: slugs.tasks },
    previousSlugs: previous,
    publishedAt: typeof doc.publishedAt === 'string' ? doc.publishedAt : null,
  };
}

function remote() {
  return kvGet<string>(KV_KEYS.remoteOwner).then(async (owner) => {
    const repo = await kvGet<string>(KV_KEYS.remoteRepo);
    const branch = (await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main';
    if (!owner || !repo) return null;
    return new GitHubClient({ owner, repo, branch }, () => auth.getToken());
  });
}

/** Читает настройки ленты из семейного хранилища. Нет файла — null (лента не включалась). */
export async function readFeedState(): Promise<FeedState | null> {
  const client = await remote();
  if (!client) return null;
  const cur = await client.getFile('data/feed.json', null, true);
  if (cur.status !== 'ok') return null;
  try {
    return parseState(JSON.parse(cur.file.content));
  } catch {
    return null;
  }
}

/**
 * Сохраняет настройки ленты. Конфликт записи разбирается повторным чтением (как у подписок):
 * файл пишут ещё и отправитель (отметка о публикации), поэтому гонка возможна.
 */
export async function saveFeedState(state: FeedState): Promise<void> {
  const client = await remote();
  if (!client) throw new GitHubError(0, 'семейное хранилище не подключено', 'no-token');
  const payload = JSON.stringify(
    {
      sections: state.sections,
      slugs: state.slugs,
      previousSlugs: state.previousSlugs,
      publishedAt: state.publishedAt,
    },
    null,
    2,
  );
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const cur = await client.getFile('data/feed.json', null, true);
    const sha = cur.status === 'ok' ? cur.file.sha : null;
    try {
      await client.putFile(
        'data/feed.json',
        payload,
        sha,
        state.sections.deadlines || state.sections.tasks
          ? 'feed: настройки ленты'
          : 'feed: лента выключена',
      );
      return;
    } catch (e) {
      lastError = e;
      if (!(e instanceof GitHubError) || e.code !== 'conflict') throw e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new GitHubError(0, 'не удалось сохранить', 'unknown');
}

/** Включает/выключает раздел, сохраняя остальное. Смена ссылки — отдельной функцией. */
export async function setFeedSection(
  current: FeedState | null,
  section: FeedSection,
  enabled: boolean,
): Promise<FeedState> {
  const base = current ?? emptyFeedState();
  const next: FeedState = {
    ...base,
    sections: { ...base.sections, [section]: enabled },
  };
  await saveFeedState(next);
  return next;
}

/**
 * Смена ссылки: новые адреса, старые уходят в список на удаление у отправителя.
 * Старые ссылки перестают работать после ближайшей публикации — это и есть цель.
 */
export async function rotateFeedLinks(current: FeedState | null): Promise<FeedState> {
  const base = current ?? emptyFeedState();
  const previous = [
    ...new Set([...base.previousSlugs, base.slugs.deadlines, base.slugs.tasks]),
  ].slice(-4);
  const next: FeedState = {
    sections: base.sections,
    slugs: { deadlines: newFeedSlug(), tasks: newFeedSlug() },
    previousSlugs: previous,
    publishedAt: base.publishedAt,
  };
  await saveFeedState(next);
  return next;
}
