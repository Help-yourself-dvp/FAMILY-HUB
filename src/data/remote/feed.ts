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
    const res = await fetch(new URL('vapid.json', document.baseURI).href, { cache: 'no-store' });
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

/** Префикс UID в ленте: `deadline-<id>@family-hub.local` / `task-<id>@family-hub.local`. */
const FEED_UID_RE = /UID:(?:deadline|task)-([^@\r\n]+)@family-hub\.local/gu;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Идентификаторы событий из опубликованного файла ленты. Переносы строк разворачиваем:
 * RFC 5545 разрешает резать длинные строки, и UID может оказаться склеенным из двух.
 */
export function parseFeedIds(ics: string): Set<string> {
  const unfolded = ics.replace(/\r?\n[ \t]/gu, '');
  const ids = new Set<string>();
  for (const match of unfolded.matchAll(FEED_UID_RE)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Читает опубликованный файл ленты (он публичный, поэтому доступен без токена) и отдаёт
 * идентификаторы событий. null — прочитать не удалось: это не ошибка приложения, поэтому
 * вызывающий просто ничего не показывает.
 */
export type FeedFileResult =
  /** Файл прочитан. */
  | { kind: 'ok'; ids: Set<string> }
  /** Файла по этой ссылке ещё нет (404): публикация не проходила или ссылку сменили. */
  | { kind: 'not-published' }
  /** Прочитать не удалось: сеть/провайдер или GitHub недоступен. */
  | { kind: 'unreachable' };

/**
 * Запрос с ограничением времени. Без него закрытый провайдером адрес не «падает», а висит:
 * браузер держит соединение минутами, и проверка выглядит как «кнопка не работает»
 * (жалоба владельца 05.10.2026).
 */
async function fetchWithTimeout(
  url: string,
  ms: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Короткий предел для адреса подписки: он может быть закрыт провайдером. */
const SUBSCRIPTION_TIMEOUT_MS = 6000;
/** Предел для запасного пути: он рабочий, но сеть бывает медленной. */
const API_TIMEOUT_MS = 12000;

/** Только для тестов: забыть, какой путь чтения файла сработал. */
export function resetFeedPathCache(): void {
  workingPath = null;
}

/**
 * Помним, какой путь чтения сработал: если адрес подписки закрыт, не мучаем его каждый раз,
 * а сразу идём через api.github.com. Память — до перезагрузки страницы, этого достаточно.
 */
let workingPath: 'subscription' | 'api' | null = null;

/** Запасной путь чтения: через API GitHub (открыт для публичных файлов, CORS разрешён). */
async function fetchFeedViaApi(cfg: FeedConfig, slug: string): Promise<FeedFileResult> {
  try {
    const token = await auth.getToken();
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/feed/${slug}.ics?ref=${cfg.branch}`,
      API_TIMEOUT_MS,
      {
        headers: {
          Accept: 'application/vnd.github.raw',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      },
    );
    if (res.status === 404) return { kind: 'not-published' };
    if (!res.ok) return { kind: 'unreachable' };
    return { kind: 'ok', ids: parseFeedIds(await res.text()) };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * Читает опубликованный файл ленты по ссылке подписки. Первый путь — сам адрес подписки
 * (raw.githubusercontent.com). Если он не открылся (так бывает у российских провайдеров,
 * этот домен иногда блокируют), повторяем через api.github.com: он у приложения и так
 * рабочий, потому что через него идёт синхронизация. На саму подписку это не влияет —
 * Google скачивает ленту со своей стороны, — но проверка в приложении должна работать.
 */
export async function fetchFeedIds(cfg: FeedConfig, slug: string): Promise<FeedFileResult> {
  if (workingPath !== 'api') {
    try {
      const res = await fetchWithTimeout(feedUrl(cfg, slug), SUBSCRIPTION_TIMEOUT_MS, {
        cache: 'no-store',
      });
      if (res.status === 404) return { kind: 'not-published' };
      if (res.ok) {
        workingPath = 'subscription';
        return { kind: 'ok', ids: parseFeedIds(await res.text()) };
      }
    } catch {
      // Адрес закрыт или не ответил вовремя — идём запасным путём ниже.
    }
  }
  const viaApi = await fetchFeedViaApi(cfg, slug);
  if (viaApi.kind === 'ok') workingPath = 'api';
  return viaApi;
}

/** Что из семейных записей не попало в ленту и почему — простыми словами для владельца. */
export interface FeedGap {
  title: string;
  reason: string;
}

export interface FeedCheck {
  /** Сколько событий реально лежит в опубликованном файле. */
  published: number;
  /** Записи, которых в файле нет (удалённые не считаем — их владелец и не ждёт). */
  missing: FeedGap[];
}

interface FeedItemLike {
  id: string;
  title?: string;
  deletedAt?: string | null;
  visibility?: string;
  status?: string;
  dueDate?: string | null;
}

/**
 * Сверяет семейные записи с опубликованным файлом. Причины сформулированы так, чтобы
 * владелец сразу понимал, ждать ему или поправить запись: личный срок и дело без даты не
 * публикуются по правилам, а отсутствие только что созданного — это задержка публикации.
 */
export function checkFeedSection(
  section: FeedSection,
  items: FeedItemLike[],
  ids: Set<string>,
): FeedCheck {
  const missing: FeedGap[] = [];
  for (const item of items) {
    if (item.deletedAt) continue;
    const title = (item.title ?? '').trim() || 'без названия';
    if (section === 'deadlines' && item.visibility === 'private') {
      missing.push({ title, reason: 'личный срок — в общую ленту не попадает' });
      continue;
    }
    if (section === 'tasks' && item.status !== 'open') {
      missing.push({ title, reason: 'дело завершено — из ленты уходит' });
      continue;
    }
    if (!DATE_ONLY_RE.test(item.dueDate ?? '')) {
      missing.push({
        title,
        reason:
          section === 'deadlines'
            ? 'без даты — календарю нечего поставить'
            : 'без даты — в календарь не встанет',
      });
      continue;
    }
    if (!ids.has(item.id)) {
      missing.push({ title, reason: 'ещё не опубликовано — подождите пару минут' });
    }
  }
  return { published: ids.size, missing };
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
