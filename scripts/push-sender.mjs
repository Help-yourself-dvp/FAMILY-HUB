/**
 * Отправитель напоминаний о сроках (ЭТАП 3) — живёт в ПУБЛИЧНОМ репозитории.
 *
 * Экономика владельца: приватные минуты GitHub (лимит 2000/мес) тратят только
 * workflow в приватном репозитории данных. Этот скрипт запускается cron-ом в
 * публичном FAMILY-HUB — минуты не лимитированы, расход платных минут = 0.
 *
 * Что делает раз в 30 минут:
 *  1. Читает data/deadlines.json из семейного хранилища (приватный репо).
 *  2. Считает ступени напоминаний, сработавшие СЕГОДНЯ (Europe/Moscow), по тому же
 *     правилу, что и в приложении: ровно в день ступени (90/30/7/свой N) и один
 *     раз о просрочке.
 *  3. Проверяет маркеры data/push-sent/<id>.<due>.<step>.json — каждое напоминание
 *     отправляется ОДИН раз (анти-спам, как договорились с владельцем).
 *  4. Шлёт Web Push на подписки из data/push/*.json (подписки кладут сами
 *     устройства при включении push в настройках приложения).
 *  5. Мёртвые подписки (410/404) удаляет из хранилища.
 *
 * Секреты (добавляет владелец в Settings → Secrets and variables → Actions):
 *  FAMILY_REPO_TOKEN   — семейный ключ GitHub с правом Contents RW на репо данных
 *  VAPID_PRIVATE_KEY   — приватный ключ VAPID (публичный лежит в public/vapid.json)
 * Без секретов обычный цикл предупреждает и выходит с кодом 0 до настройки.
 * Явная ручная проверка без конфигурации завершается ошибкой, не ложным успехом.
 * FH_PUSH_MODE=test: отдельная проверка, только GET подписок + send; без сроков,
 * чтения/записи маркеров и удаления подписок. Cron использует reminders.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { sendPushTest } from './push-test.mjs';
import { sendTaskPush } from './task-push.mjs';
import { deadlineRows, entityRows } from './push-sender-data.mjs';
import {
  SHOPPING_FIRST_WINDOW_MS,
  digestAllowed,
  digestText,
  shoppingChanges,
} from './shopping-digest.mjs';

const API = 'https://api.github.com';
const OWNER = process.env.FH_DATA_OWNER || 'Help-yourself-dvp';
const REPO = process.env.FH_DATA_REPO || 'family-hub-data';
const BRANCH = process.env.FH_DATA_BRANCH || 'main';
const TOKEN = process.env.FAMILY_REPO_TOKEN || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const TZ = 'Europe/Moscow';
const TEST_MODE = process.env.FH_PUSH_MODE === 'test';

function log(...args) {
  console.log('[push]', ...args);
}

// Только фиксированный текст и счётчики — пригодны для check-run annotations.
// Ни названий сроков, ни ключей, ни push-эндпоинтов в эти сообщения не добавляем.
function annotation(level, text) {
  console.log(`::${level} title=Family Hub push::${text}`);
}

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'family-hub-push-sender',
      ...(init.headers || {}),
    },
  });
  return res;
}

async function getJsonFile(path) {
  const res = await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  const j = await res.json();
  if (Array.isArray(j)) return j; // листинг директории
  if (j.encoding !== 'base64') throw new Error(`GET ${path}: неожиданный формат ответа`);
  try {
    return JSON.parse(Buffer.from(j.content, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

async function putJsonFile(path, data, message) {
  const cur = await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
  const sha = cur.ok ? (await cur.json()).sha : null;
  const body = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path}: HTTP ${res.status}`);
}

async function deleteFile(path, sha) {
  const res = await gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `push: удалена мёртвая подписка ${path}`,
      sha,
      branch: BRANCH,
    }),
  });
  if (!res.ok) log('delete', path, 'HTTP', res.status);
}

/* ------- даты: тот же календарный смысл, что в приложении (dateOnly) ------- */
function todayMoscow() {
  // 'sv' даёт формат YYYY-MM-DD в нужной таймзоне
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

function daysUntil(due, from) {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${due}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function hitsFor(d, from) {
  const left = daysUntil(d.dueDate, from);
  if (left < 0) return Array.isArray(d.remindersDays) && d.remindersDays.length ? ['overdue'] : [];
  return (Array.isArray(d.remindersDays) ? d.remindersDays : []).filter((r) => left === r);
}

function textFor(d, hit) {
  if (hit === 'overdue') return `Срок «${d.title}» прошёл — проверьте, что сделано.`;
  if (hit === 0) return `Сегодня срок: «${d.title}».`;
  return `«${d.title}»: осталось ${hit} дн. (до ${d.dueDate}).`;
}

async function loadSubscriptions() {
  const subsDir = await getJsonFile('data/push');
  const subs = [];
  if (Array.isArray(subsDir)) {
    for (const f of subsDir) {
      if (!f.name.endsWith('.json')) continue;
      const doc = await getJsonFile(`data/push/${f.name}`);
      if (doc && !doc.revoked && doc.subscription?.endpoint) {
        subs.push({
          path: `data/push/${f.name}`,
          sha: f.sha,
          sub: doc.subscription,
          deviceId: doc.deviceId || f.name.replace(/\.json$/u, ''),
          memberId: doc.memberId || null,
          // Согласие на дайджест покупок (0.5.6): старые файлы поля не имеют — молчим.
          notifyShopping: doc.notifyShopping === true,
        });
      }
    }
  }
  return subs;
}

/* ------------------------------- основной цикл ---------------------------- */
async function main() {
  if (!TOKEN || !VAPID_PRIVATE) {
    log(
      'не настроено: владелец должен добавить секреты FAMILY_REPO_TOKEN и VAPID_PRIVATE_KEY (Settings → Secrets and variables → Actions). Отправка невозможна.',
    );
    annotation(
      TEST_MODE ? 'error' : 'warning',
      'Отправка пропущена: не заданы FAMILY_REPO_TOKEN или VAPID_PRIVATE_KEY.',
    );
    if (TEST_MODE) process.exitCode = 1;
    return;
  }

  const webpush = (await import('web-push')).default;
  // Публичный ключ VAPID не секретен: читаем из файла приложения (workflow делает
  // checkout этого репозитория) или из env, если запускаем вручную.
  let vapidPublic = process.env.VAPID_PUBLIC_KEY || '';
  if (!vapidPublic) {
    try {
      vapidPublic = JSON.parse(readFileSync('public/vapid.json', 'utf-8')).vapidPublicKey || '';
    } catch {
      /* нет файла — не настроено */
    }
  }
  if (!vapidPublic) {
    log('нет публичного ключа VAPID (public/vapid.json или env) — отправка невозможна');
    annotation(TEST_MODE ? 'error' : 'warning', 'Отправка пропущена: нет публичного ключа VAPID.');
    if (TEST_MODE) process.exitCode = 1;
    return;
  }
  webpush.setVapidDetails(
    'https://github.com/Help-yourself-dvp/FAMILY-HUB',
    vapidPublic,
    VAPID_PRIVATE,
  );

  if (TEST_MODE) {
    // Только отдельный тест. НЕТ чтения сроков, push-sent и записи/удаления файлов.
    const subs = await loadSubscriptions();
    const id = `${process.env.GITHUB_RUN_ID || 'manual'}.${randomUUID()}`;
    const result = await sendPushTest(
      subs,
      (sub, payload, options) => webpush.sendNotification(sub, payload, options),
      id,
    );
    const failed = result.subscriptions === 0 || result.failed > 0;
    annotation(
      failed ? 'error' : 'notice',
      `Проверочный push: подписок ${result.subscriptions}, принято провайдером ${result.accepted}, ошибок ${result.failed}, HTTP ${JSON.stringify(result.errorsByStatus)}. Маркеры сроков не изменены. Получение проверяйте на устройстве.`,
    );
    if (failed) process.exitCode = 1;
    return;
  }

  const deadlines = deadlineRows(await getJsonFile('data/deadlines.json')) || [];
  const tasks = deadlineRows(await getJsonFile('data/tasks.json')) || [];
  const shopping = entityRows(await getJsonFile('data/shopping.json')) || [];
  if (deadlines.length === 0 && tasks.length === 0 && shopping.length === 0) {
    annotation('notice', 'Нет записей сроков/дел/покупок, напоминать нечего.');
    return;
  }
  const from = todayMoscow();

  const subs = await loadSubscriptions();
  if (subs.length === 0) {
    log('подписок нет: включите «Push при закрытом приложении» в Настройки → Уведомления');
    annotation('notice', 'Отправка пропущена: нет активных подписок устройств.');
    return;
  }

  const sentDir = (await getJsonFile('data/push-sent')) || [];
  const sentNames = new Set(Array.isArray(sentDir) ? sentDir.map((f) => f.name) : []);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const d of deadlines) {
    if (!d || d.deletedAt || d.visibility === 'private') continue;
    for (const hit of hitsFor(d, from)) {
      const marker = `${d.id}.${d.dueDate}.${hit}.json`;
      if (sentNames.has(marker)) {
        skipped += 1;
        continue;
      }
      const payload = JSON.stringify({
        title: 'Family Hub: срок',
        body: textFor(d, hit),
        route: '#/deadlines',
        tag: marker,
      });
      let okCount = 0;
      for (const s of subs) {
        try {
          // Редкие важные сроки, не покупки: просим высокий приоритет доставки.
          // ОС/сеть всё равно могут задержать показ; подтверждение проверяем на устройстве.
          await webpush.sendNotification(s.sub, payload, { TTL: 24 * 3600, urgency: 'high' });
          okCount += 1;
        } catch (e) {
          failed += 1;
          const status = e?.statusCode;
          if (status === 404 || status === 410) {
            log('мёртвая подписка, удаляю; HTTP', status);
            await deleteFile(s.path, s.sha);
          } else {
            log('ошибка доставки; HTTP', typeof status === 'number' ? status : 'неизвестен');
          }
        }
      }
      if (okCount > 0) {
        await putJsonFile(
          `data/push-sent/${marker}`,
          { at: new Date().toISOString(), deadlineId: d.id, hit: String(hit), delivered: okCount },
          `push: напоминание отправлено (${marker})`,
        );
        sent += 1;
        log('отправлено:', marker, 'на', okCount, 'устройств(а)');
      }
    }
  }
  const taskResult = await sendTaskPush(tasks, subs, from, {
    wasSent: (marker) => Promise.resolve(sentNames.has(marker)),
    send: (sub, payload, options) => webpush.sendNotification(sub, payload, options),
    markSent: async (marker) => {
      await putJsonFile(
        `data/push-sent/${marker}`,
        { at: new Date().toISOString(), kind: 'tasks' },
        'push: отправлено напоминание исполнителю дела',
      );
      sentNames.add(marker);
    },
  });
  annotation(
    taskResult.failed ? 'warning' : 'notice',
    `Дела: принято ${taskResult.accepted}, пропущено по маркерам ${taskResult.skipped}, ошибок ${taskResult.failed}.`,
  );

  // Дайджест покупок (0.5.6): только устройства с включённым тумблером, не чаще раза
  // в 30 минут, свои изменения тому, кто их внёс, не возвращаются.
  const digestRecipients = subs.filter((s) => s.notifyShopping === true);
  if (shopping.length > 0 && digestRecipients.length > 0) {
    const markerPath = 'data/push-sent/shopping-digest.json';
    const marker = await getJsonFile(markerPath);
    const lastSentAt = marker && typeof marker.at === 'string' ? marker.at : null;
    if (!digestAllowed(Date.now(), lastSentAt)) {
      annotation('notice', 'Дайджест покупок: пропуск — прошлый отправлен меньше 30 минут назад.');
    } else {
      // Первый дайджест смотрит на сутки назад (изменения, сделанные до включения тумблера,
      // иначе не попали бы ни в одно уведомление), дальше — окно от прошлой отправки.
      const sinceIso = lastSentAt ?? new Date(Date.now() - SHOPPING_FIRST_WINDOW_MS).toISOString();
      let digestSent = 0;
      let digestErrors = 0;
      for (const s of digestRecipients) {
        const changes = shoppingChanges(shopping, {
          sinceIso,
          excludeIds: [s.deviceId, s.memberId],
        });
        if (changes.length === 0) continue;
        const payload = JSON.stringify({
          title: 'Family Hub: покупки',
          body: digestText(changes),
          route: '#/shopping',
          tag: 'shopping-digest',
        });
        try {
          await webpush.sendNotification(s.sub, payload, { TTL: 6 * 3600, urgency: 'normal' });
          digestSent += 1;
        } catch (e) {
          digestErrors += 1;
          const status = e?.statusCode;
          if (status === 404 || status === 410) {
            log('мёртвая подписка, удаляю; HTTP', status);
            await deleteFile(s.path, s.sha);
          } else {
            log(
              'ошибка доставки дайджеста; HTTP',
              typeof status === 'number' ? status : 'неизвестен',
            );
          }
        }
      }
      if (digestSent > 0) {
        await putJsonFile(
          markerPath,
          { at: new Date().toISOString(), kind: 'shopping', devices: digestSent },
          'push: дайджест покупок отправлен',
        );
      }
      annotation(
        digestErrors > 0 ? 'warning' : 'notice',
        `Покупки: подписок с дайджестом ${digestRecipients.length}, отправлено ${digestSent}, ошибок ${digestErrors}.`,
      );
    }
  }

  annotation(
    failed > 0 ? 'warning' : 'notice',
    `Цикл завершён: отправлено ${sent}, пропущено по маркерам ${skipped}, подписок ${subs.length}, ошибок доставки ${failed}.`,
  );
}

main().catch((e) => {
  // Не красим workflow из-за преходящих сбоев сети/GitHub: напоминание догонит
  // следующий запуск через 30 минут, маркеры не дадут дублей.
  // Ошибки библиотек могут содержать endpoint подписки — наружу только код.
  const http = /HTTP (\d{3})/u.exec(e instanceof Error ? e.message : '');
  const code = http
    ? `HTTP ${http[1]}`
    : e?.code === 'ERR_MODULE_NOT_FOUND'
      ? 'dependency-missing'
      : 'cycle-error';
  // Ошибка конфигурации/прав — не преходящая потеря сети: не выдаём её за зелёный успех.
  const fatal =
    TEST_MODE || code === 'dependency-missing' || code === 'HTTP 401' || code === 'HTTP 403';
  annotation(fatal ? 'error' : 'warning', `Цикл отправки не завершён (${code}).`);
  if (fatal) process.exitCode = 1;
});
