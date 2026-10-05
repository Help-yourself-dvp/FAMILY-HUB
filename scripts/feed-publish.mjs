/**
 * Лента (подписка) — быстрая публикация (0.6.9).
 *
 * Зачем отдельный скрипт: событие, добавленное на телефоне, должно попасть в календарь
 * как можно скорее. Раньше ленту публиковал тот же цикл, что шлёт напоминания, и ему
 * для этого нужна была установка зависимостей (web-push) — около минуты на `npm ci`
 * ПЕРЕД первой строкой самой публикации. Лента же не зависит ни от одного пакета:
 * `feed.mjs` — чистый текст календаря, доступ к GitHub — встроенный `fetch`.
 *
 * Поэтому публикация вынесена в отдельный job workflow БЕС установки зависимостей:
 * от «просьбы запуска» до файла в ветке `feed` — секунды, а не минуты. Напоминания
 * (push) остались в своём job с зависимостями и никак не влияют на ленту.
 *
 * Что делает этот скрипт (ровно то же, что делала лента внутри цикла отправки):
 *   1. читает data/feed.json из семейного хранилища — какие разделы включены и какие
 *      у них «секретные» ссылки; нет файла — лента ни разу не включалась, публиковать
 *      нечего (это не ошибка);
 *   2. собирает .ics для каждого раздела из data/deadlines.json и data/tasks.json;
 *      выключенный раздел публикуется ПУСТЫМ календарём — подписка очистится, а не
 *      останется со старыми событиями;
 *   3. удаляет файлы прошлых ссылок (после «Сменить ссылку») и пишет отметку
 *      publishedAt в data/feed.json — её показывает приложение («Обновлено: …»).
 *
 * Сбой одного раздела не должен ронять остальное: лента — отдельный канал, и частично
 * обновлённая лента лучше, чем отсутствующая. Ошибки уходят в аннотации запуска.
 *
 * Проверка: tests/feed-publish.test.ts — на вымышленных данных, без сети.
 */
import { buildFeedIcs } from './feed.mjs';
import { entityRows } from './push-sender-data.mjs';

/** Разделы ленты в фиксированном порядке: файлы создаются детерминированно. */
export const FEED_SECTIONS = ['deadlines', 'tasks'];

/** Секретная часть ссылки: 16–64 шестнадцатеричных знака (как у секретных ссылок GitHub). */
const SLUG_RE = /^[a-f0-9]{16,64}$/u;

/**
 * Настройки ленты из data/feed.json. Нет файла или он битый — null (лента не включена).
 * Разделы без корректной ссылки считаются недействительными целиком: публиковать
 «куда-то ещё» нельзя, а половина настроек хуже их отсутствия.
 */
export function parseFeedSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const sections = raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
  const slugs = raw.slugs && typeof raw.slugs === 'object' ? raw.slugs : {};
  const ok = (v) => typeof v === 'string' && SLUG_RE.test(v);
  if (!ok(slugs.deadlines) || !ok(slugs.tasks)) return null;
  return {
    sections: { deadlines: sections.deadlines === true, tasks: sections.tasks === true },
    slugs: { deadlines: slugs.deadlines, tasks: slugs.tasks },
    previousSlugs: Array.isArray(raw.previousSlugs) ? raw.previousSlugs.filter(ok) : [],
  };
}

/**
 * Полный цикл публикации ленты. Все побочные эффекты — через внедрённые зависимости,
 * поэтому тесты гоняют его на фикстурах без сети и без семейных данных.
 *
 * @param {object} deps
 * @param {{ family: string, public: string, publicToken: string }} deps.env
 *   family — «владелец/репозиторий» семейного хранилища; public — публичного.
 * @param {(path: string) => Promise<unknown>} deps.getJson чтение JSON из семейного хранилища
 * @param {(path: string, data: unknown, message: string) => Promise<void>} deps.putJson
 *   запись JSON в семейное хранилище (сама решает конфликты повтором)
 * @param {(args: { section: string, slug: string, content: string }) => Promise<void>} deps.publishIcs
 * @param {(slug: string) => Promise<boolean>} deps.deleteIcs
 * @param {(message: string) => void} [deps.log]
 * @param {(level: string, message: string) => void} [deps.annotation]
 * @param {() => string} [deps.now] отметка publishedAt (в тестах — фиксированное время)
 * @returns {Promise<{ enabled: boolean, published: number, removed: number }>}
 */
export async function runFeedPublish({
  env,
  getJson,
  putJson,
  publishIcs,
  deleteIcs,
  log = () => {},
  annotation = () => {},
  now = () => new Date().toISOString(),
}) {
  const summary = { enabled: false, published: 0, removed: 0 };

  if (!env?.public || !env?.publicToken) {
    annotation('warning', 'Лента: нет доступа к публичному репозиторию — публикация пропущена.');
    return summary;
  }

  const settings = parseFeedSettings(await getJson('data/feed.json'));
  if (!settings) {
    // Ленту ни разу не включали: события в календарь не ходят, и это нормально.
    log('feed: лента не включена — публиковать нечего');
    return summary;
  }
  summary.enabled = true;

  // Приложение пишет в хранилище конверт RemoteFile { entities }, а не массив —
  // разворачиваем тем же чистым адаптером, что и отправитель напоминаний.
  const [deadlines, tasks] = await Promise.all([
    Promise.resolve(getJson('data/deadlines.json'))
      .then((doc) => entityRows(doc) || [])
      .catch((e) => {
        annotation('warning', `Лента: не прочитаны сроки (${e?.message || 'сбой'}).`);
        return [];
      }),
    Promise.resolve(getJson('data/tasks.json'))
      .then((doc) => entityRows(doc) || [])
      .catch((e) => {
        annotation('warning', `Лента: не прочитаны дела (${e?.message || 'сбой'}).`);
        return [];
      }),
  ]);

  for (const section of FEED_SECTIONS) {
    const slug = settings.slugs[section];
    // Выключенный раздел публикуем ПУСТЫМ календарём: подписка очистится, а не
    // останется со старыми событиями. (В 0.6.0–0.6.8 флаг раздела до сборки не
    // доходил — выключение не убирало события из ленты; обещание в интерфейсе
    // при этом оставалось. Здесь проводка исправлена.)
    const content = buildFeedIcs({
      section,
      deadlines: settings.sections.deadlines ? deadlines : [],
      tasks: settings.sections.tasks ? tasks : [],
    });
    try {
      await publishIcs({ section, slug, content });
      summary.published += 1;
    } catch (e) {
      // Один раздел не должен мешать другому: файл сроков важнее файла дел.
      annotation('warning', `Лента (${section}): публикация не удалась (${e?.message || 'сбой'}).`);
    }
  }

  for (const old of settings.previousSlugs) {
    if (old === settings.slugs.deadlines || old === settings.slugs.tasks) continue;
    if (await deleteIcs(old)) summary.removed += 1;
  }

  // Отметка публикации: приложение показывает «Обновлено: …» и сверяет по ней файл.
  // Пишем только если хоть один файл ушёл: иначе «Обновлено» врало бы.
  if (summary.published > 0) {
    try {
      await putJson(
        'data/feed.json',
        {
          sections: settings.sections,
          slugs: settings.slugs,
          previousSlugs: [],
          publishedAt: now(),
        },
        'feed: лента опубликована',
      );
    } catch (e) {
      annotation(
        'warning',
        `Лента: файлы опубликованы, но отметку записать не удалось (${e?.message || 'сбой'}).`,
      );
    }
  }

  annotation(
    'notice',
    `Лента: разделы ${settings.sections.deadlines ? 'сроки' : ''}${
      settings.sections.deadlines && settings.sections.tasks ? ' + ' : ''
    }${settings.sections.tasks ? 'дела' : ''}, файлов опубликовано ${summary.published}, старых ссылок удалено ${summary.removed}.`,
  );
  return summary;
}

/* ------- настоящие зависимости: только когда скрипт запущен в workflow ------- */

const API = 'https://api.github.com';

function gh(publicToken, publicRepo, path, init = {}) {
  return fetch(`${API}/repos/${publicRepo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${publicToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'family-hub-feed-publisher',
      ...(init.headers || {}),
    },
  });
}

/** Чтение JSON из семейного (приватного) хранилища токеном владельца. */
const FAMILY_BRANCH = process.env.FH_DATA_BRANCH || 'main';

function makeGetJson(familyRepo, familyToken) {
  return async function getJson(path) {
    const res = await fetch(`${API}/repos/${familyRepo}/contents/${path}?ref=${FAMILY_BRANCH}`, {
      headers: {
        Authorization: `Bearer ${familyToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'family-hub-feed-publisher',
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    const j = await res.json();
    if (j.encoding !== 'base64') throw new Error(`GET ${path}: неожиданный формат ответа`);
    try {
      return JSON.parse(Buffer.from(j.content, 'base64').toString('utf-8'));
    } catch {
      return null;
    }
  };
}

/**
 * Запись JSON в семейное хранилище с повтором при конфликте (409): между чтением и
 * записью файл мог изменить кто-то ещё — приложение на телефоне или параллельный job.
 */
function makePutJson(familyRepo, familyToken) {
  return async function putJson(path, data, message) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const cur = await fetch(`${API}/repos/${familyRepo}/contents/${path}?ref=${FAMILY_BRANCH}`, {
        headers: {
          Authorization: `Bearer ${familyToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'family-hub-feed-publisher',
        },
      });
      const sha = cur.ok ? (await cur.json()).sha : null;
      const body = {
        message,
        content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64'),
        branch: FAMILY_BRANCH,
      };
      if (sha) body.sha = sha;
      const res = await fetch(`${API}/repos/${familyRepo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${familyToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'family-hub-feed-publisher',
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
      lastError = new Error(`PUT ${path}: HTTP ${res.status}`);
      if (res.status !== 409) throw lastError;
    }
    throw lastError;
  };
}

/** Публикация файла ленты в отдельную ветку публичного репозитория. */
function makePublishIcs(publicRepo, publicToken) {
  const branch = 'feed';
  return async function publishIcs({ slug, content }) {
    const call = (path, init = {}) => gh(publicToken, publicRepo, path, init);
    const ref = await call(`/git/ref/heads/${branch}`);
    if (ref.status === 404) {
      // Первая публикация: ветку создаём от main. Гонка с параллельным запуском
      // (422 «уже есть») — не ошибка.
      const mainRef = await call('/git/ref/heads/main');
      if (!mainRef.ok) throw new Error(`feed: ветка main недоступна (HTTP ${mainRef.status})`);
      const sha = (await mainRef.json()).object.sha;
      const created = await call('/git/refs', {
        method: 'POST',
        body: JSON.stringify({ ref: 'refs/heads/feed', sha }),
      });
      if (!created.ok && created.status !== 422) {
        throw new Error(`feed: не удалось создать ветку (HTTP ${created.status})`);
      }
    } else if (!ref.ok) {
      throw new Error(`feed: не удалось прочитать ветку (HTTP ${ref.status})`);
    }
    const path = `feed/${slug}.ics`;
    const cur = await call(`/contents/${path}?ref=${branch}`);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const put = await call(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'feed: обновить ленту',
        content: Buffer.from(content, 'utf-8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) throw new Error(`feed: публикация не удалась (HTTP ${put.status})`);
  };
}

/** Удаление файла прошлой ссылки: старое должно перестать работать. */
function makeDeleteIcs(publicRepo, publicToken) {
  return async function deleteIcs(slug) {
    const path = `feed/${slug}.ics`;
    const cur = await gh(publicToken, publicRepo, `/contents/${path}?ref=feed`);
    if (cur.status === 404) return true; // уже нет — цель достигнута
    if (!cur.ok) return false;
    const sha = (await cur.json()).sha;
    const del = await gh(publicToken, publicRepo, `/contents/${path}`, {
      method: 'DELETE',
      body: JSON.stringify({
        message: 'feed: старая ссылка больше не работает',
        sha,
        branch: 'feed',
      }),
    });
    return del.ok;
  };
}

function annotation(level, message) {
  // Формат GitHub Actions: warning/notice/error. Лог — без данных семьи.
  console.log(`::${level}::${message}`);
}

async function main() {
  const familyRepo = `${process.env.FH_DATA_OWNER || 'Help-yourself-dvp'}/${process.env.FH_DATA_REPO || 'family-hub-data'}`;
  const familyToken = process.env.FAMILY_REPO_TOKEN || '';
  const publicRepo = process.env.GITHUB_REPOSITORY || '';
  const publicToken = process.env.PUBLIC_REPO_TOKEN || '';

  if (!familyRepo || !familyToken) {
    annotation('warning', 'Лента: нет доступа к семейному хранилищу — публикация пропущена.');
    return;
  }

  await runFeedPublish({
    env: { family: familyRepo, public: publicRepo, publicToken },
    getJson: makeGetJson(familyRepo, familyToken),
    putJson: makePutJson(familyRepo, familyToken),
    publishIcs: makePublishIcs(publicRepo, publicToken),
    deleteIcs: makeDeleteIcs(publicRepo, publicToken),
    log: (m) => console.log(m),
    annotation,
  });
}

// Запускается только как скрипт: импорт в тесты побочных эффектов не даёт.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ''));
if (isMain) {
  main().catch((e) => {
    // Преходящие сбои сети/GitHub не «краснят» запуск: лента догонит следующий цикл
    // (расписание */5 либо «будильник»), а письмо владельцу о каждом сбое — шум.
    // А вот отсутствие прав/токена — не про сеть: это видно сразу и требует действия.
    const http = /HTTP (\d{3})/u.exec(e instanceof Error ? e.message : '');
    const code = http ? `HTTP ${http[1]}` : 'cycle-error';
    const fatal = code === 'HTTP 401' || code === 'HTTP 403';
    annotation(fatal ? 'error' : 'warning', `Лента: публикация не удалась (${code}).`);
    if (fatal) process.exitCode = 1;
  });
}
