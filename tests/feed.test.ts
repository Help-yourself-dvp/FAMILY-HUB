/**
 * Лента (подписка) — 0.6.0.
 *
 * Здесь проверяется текст календаря (то, что увидят Google и Apple) и проводка: отправитель
 * берёт разделы и «секретные» части адресов из data/feed.json и публикует файлы в отдельную
 * ветку публичного репозитория. Живая сеть в тестах запрещена — только вымышленные данные.
 */
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_TIMEZONE,
  alarmTrigger,
  buildFeedIcs,
  feedPath,
  feedUrl,
  feedableDeadlines,
  feedableTasks,
  newFeedSlug,
  reminderSteps,
} from '../scripts/feed.mjs';
import senderSource from '../scripts/push-sender.mjs?raw';
import feedPublishSource from '../scripts/feed-publish.mjs?raw';
import { checkFeedSection, parseFeedIds } from '../src/data/remote/feed';
import workflow from '../.github/workflows/push-sender.yml?raw';

const deadline = (over: Record<string, unknown> = {}) => ({
  id: 'dl-1',
  rev: 3,
  title: 'ТО автомобиля',
  dueDate: '2026-11-15',
  remindersDays: [30, 7, 0],
  deletedAt: null,
  visibility: 'family',
  updatedAt: '2026-10-01T09:00:00.000Z',
  ...over,
});

const task = (over: Record<string, unknown> = {}) => ({
  id: 't-1',
  rev: 1,
  title: 'Забрать документы',
  dueDate: '2026-11-20',
  status: 'open',
  deletedAt: null,
  updatedAt: '2026-10-02T09:00:00.000Z',
  ...over,
});

describe('лента сроков', () => {
  const ics = buildFeedIcs({ section: 'deadlines', deadlines: [deadline()] });

  it('событие в 09:00–09:15 по Москве, как в файле из приложения', () => {
    expect(ics).toContain('DTSTART;TZID=Europe/Moscow:20261115T090000');
    expect(ics).toContain('DTEND;TZID=Europe/Moscow:20261115T091500');
    expect(ics).toContain(`TZID:${CALENDAR_TIMEZONE}`);
  });

  it('название помечено приложением, есть подпись и стабильный UID', () => {
    expect(ics).toContain('SUMMARY:Family Hub · ТО автомобиля');
    expect(ics).toContain('Создано в приложении Family Hub');
    expect(ics).toContain('UID:deadline-dl-1@family-hub.local');
    expect(ics).toContain('SEQUENCE:3');
  });

  it('будильники по ступеням срока: 30 и 7 дней, и в сам день', () => {
    expect(ics).toContain('TRIGGER:-P30D');
    expect(ics).toContain('TRIGGER:-P7D');
    expect(ics).toContain('TRIGGER:PT0S');
    expect(ics.match(/BEGIN:VALARM/gu)).toHaveLength(3);
  });

  it('подсказки календарям о частоте обновления присутствуют', () => {
    // 0.6.9: 15 минут вместо 4 часов — iPhone honour REFRESH-INTERVAL буквально,
    // новое событие иначе висело бы в подписке четыре часа.
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT15M');
    expect(ics).toContain('X-PUBLISHED-TTL:PT15M');
    expect(ics).toContain('X-WR-CALNAME:Family Hub — сроки');
  });

  it('личные и удалённые сроки в ленту не попадают', () => {
    expect(feedableDeadlines([deadline({ visibility: 'private' })])).toHaveLength(0);
    expect(feedableDeadlines([deadline({ deletedAt: '2026-10-03T00:00:00.000Z' })])).toHaveLength(
      0,
    );
    expect(feedableDeadlines([deadline({ dueDate: 'не дата' })])).toHaveLength(0);
  });

  it('личный или удалённый срок НЕ появляется в тексте ленты', () => {
    const built = buildFeedIcs({
      section: 'deadlines',
      deadlines: [
        deadline({ id: 'ok', title: 'Опубликованный' }),
        deadline({ id: 'private', title: 'Секретное', visibility: 'private' }),
        deadline({ id: 'gone', title: 'Удалённое', deletedAt: '2026-10-03T00:00:00.000Z' }),
        deadline({ id: 'bad', title: 'Без даты', dueDate: null }),
      ],
    });
    expect(built).toContain('SUMMARY:Family Hub · Опубликованный');
    expect(built).not.toContain('Секретное');
    expect(built).not.toContain('Удалённое');
    expect(built).not.toContain('Без даты');
  });

  it('пустой раздел — честный пустой календарь (подписка очистится)', () => {
    const empty = buildFeedIcs({ section: 'deadlines', deadlines: [] });
    expect(empty).toContain('BEGIN:VCALENDAR');
    expect(empty).not.toContain('BEGIN:VEVENT');
    expect(empty).toContain('END:VCALENDAR');
  });

  it('ступени: только целые дни 0…3650, без повторов, иначе «в день срока»', () => {
    expect(reminderSteps({ remindersDays: [7, 7, -1, 4000, 0] })).toEqual([7, 0]);
    expect(reminderSteps({ remindersDays: [] })).toEqual([0]);
    expect(alarmTrigger(0)).toBe('TRIGGER:PT0S');
    expect(alarmTrigger(30)).toBe('TRIGGER:-P30D');
  });
});

describe('лента дел', () => {
  const ics = buildFeedIcs({ section: 'tasks', tasks: [task()] });

  it('дело с датой попадает в календарь, без будильников', () => {
    expect(ics).toContain('SUMMARY:Family Hub · Забрать документы');
    expect(ics).toContain('DTSTART;TZID=Europe/Moscow:20261120T090000');
    // Дело будит только исполнителя — звонок всем был бы шумом.
    expect(ics).not.toContain('BEGIN:VALARM');
    expect(ics).toContain('X-WR-CALNAME:Family Hub — дела');
  });

  it('без будильников и в тексте: у дела их нет, у срока есть', () => {
    const tasksIcs = buildFeedIcs({ section: 'tasks', tasks: [task()] });
    const deadlinesIcs = buildFeedIcs({ section: 'deadlines', deadlines: [deadline()] });
    expect(tasksIcs).not.toContain('VALARM');
    expect(deadlinesIcs).toContain('BEGIN:VALARM');
  });

  it('завершённые, удалённые и без даты дела не публикуются', () => {
    expect(feedableTasks([task({ status: 'done' })])).toHaveLength(0);
    expect(feedableTasks([task({ deletedAt: '2026-10-03T00:00:00.000Z' })])).toHaveLength(0);
    expect(feedableTasks([task({ dueDate: null })])).toHaveLength(0);
    expect(feedableTasks([task()])).toHaveLength(1);
  });
});

describe('адрес ленты', () => {
  it('секретная часть — 32 знака, без дефисов, из случайного источника', () => {
    const slug = newFeedSlug(() => '123e4567-e89b-42d3-a456-426614174000');
    expect(slug).toBe('123e4567e89b42d3a456426614174000');
    expect(slug).toMatch(/^[a-f0-9]{32}$/u);
    expect(newFeedSlug()).toMatch(/^[a-f0-9]{32}$/u);
  });

  it('ссылка постоянная и ведёт на отдельную ветку публичного репозитория', () => {
    expect(feedUrl({ owner: 'o', repo: 'r', slug: 'abc' })).toBe(
      'https://raw.githubusercontent.com/o/r/feed/feed/abc.ics',
    );
    expect(feedPath('abc')).toBe('feed/abc.ics');
  });
});

describe('сверка с опубликованным файлом (что владелец видит в приложении)', () => {
  it('читает идентификаторы из UID и переживает перенос строк', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:deadline-abc@family-hub.local',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:task-def@family-hub.local',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect([...parseFeedIds(ics)].sort()).toEqual(['abc', 'def']);
    // RFC 5545 разрешает резать длинные строки: склеенный UID обязан читаться.
    expect([...parseFeedIds('UID:deadline-ab\r\n cd@family-hub.local')]).toEqual(['abcd']);
  });

  it('сроки: объясняет личный, без даты и «ещё не опубликовано»', () => {
    const check = checkFeedSection(
      'deadlines',
      [
        { id: 'one', title: 'Опубликован', dueDate: '2026-10-07', visibility: 'family' },
        { id: 'priv', title: 'Личное', dueDate: '2026-10-08', visibility: 'private' },
        { id: 'nodate', title: 'Без даты', dueDate: '', visibility: 'family' },
        { id: 'fresh', title: 'Только что', dueDate: '2026-10-09', visibility: 'family' },
        {
          id: 'gone',
          title: 'Удалённое',
          dueDate: '2026-10-10',
          visibility: 'family',
          deletedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      new Set(['one']),
    );
    expect(check.published).toBe(1);
    // Удалённое владелец и не ждёт — в «пропажу» не попадает.
    expect(check.missing.map((m) => m.title)).toEqual(['Личное', 'Без даты', 'Только что']);
    expect(check.missing[0]?.reason).toMatch(/личный/u);
    expect(check.missing[1]?.reason).toMatch(/без даты/u);
    expect(check.missing[2]?.reason).toMatch(/подождите/u);
  });

  it('дела: завершённое и без даты объясняются отдельно', () => {
    const check = checkFeedSection(
      'tasks',
      [
        { id: 'done', title: 'Сделано', dueDate: '2026-10-07', status: 'done' },
        { id: 'nd', title: 'Без даты', dueDate: null, status: 'open' },
        { id: 'ok', title: 'Есть', dueDate: '2026-10-07', status: 'open' },
      ],
      new Set(['ok']),
    );
    expect(check.published).toBe(1);
    expect(check.missing[0]?.reason).toMatch(/завершено/u);
    expect(check.missing[1]?.reason).toMatch(/без даты/u);
  });
});

describe('лента публикуется быстро и без зависимостей (0.6.9)', () => {
  it('отдельный скрипт собирает .ics из данных семейного хранилища', () => {
    // Сторож на проводку: мало иметь функции рядом — их нужно вызвать.
    expect(feedPublishSource).toContain('buildFeedIcs(');
    expect(feedPublishSource).toContain("getJson('data/feed.json')");
    expect(feedPublishSource).toContain("getJson('data/deadlines.json')");
    expect(feedPublishSource).toContain("getJson('data/tasks.json')");
    expect(feedPublishSource).toContain('publishedAt');
    expect(feedPublishSource).toContain('previousSlugs');
  });

  it('job ленты идёт в workflow ДО установки зависимостей — секунды, не минута', () => {
    // Суть 0.6.9: ленте web-push не нужен, поэтому npm ci не должен стоять перед ней.
    const feedJob = workflow.indexOf('node scripts/feed-publish.mjs');
    // Именно шаг установки: в комментариях слова «npm ci» тоже встречаются.
    const install = workflow.indexOf('run: npm ci');
    expect(feedJob).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(-1);
    expect(feedJob).toBeLessThan(install);
  });

  it('цикл напоминаний ленту больше не публикует — иначе двойная запись и гонка', () => {
    expect(senderSource).not.toContain('publishFeeds');
    expect(senderSource).not.toContain('buildFeedIcs');
    // Напоминания по-прежнему читают сроки и дела для своих push.
    expect(senderSource).toContain("getJsonFile('data/deadlines.json')");
    expect(senderSource).toContain("getJsonFile('data/tasks.json')");
  });

  it('публикует встроенным токеном в ветку feed, отдельного секрета не требует', () => {
    expect(workflow).toContain('PUBLIC_REPO_TOKEN: ${{ github.token }}');
    // Право записи нужно ОБОИМ job'ам, поэтому оно на уровне workflow.
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: write/u);
    expect(feedPublishSource).toContain('refs/heads/feed');
  });

  it('отметку публикации пишет только после успешной публикации файлов', () => {
    expect(feedPublishSource).toContain('summary.published > 0');
    expect(feedPublishSource).toContain("'feed: лента опубликована'");
  });

  it('расписание просит GitHub как можно чаще (5 минут) — замер 03–05.10.2026', () => {
    expect(workflow).toContain("cron: '*/5 * * * *'");
  });
});
