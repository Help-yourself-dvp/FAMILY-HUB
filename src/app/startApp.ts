/**
 * Точка запуска приложения — ЕДИНСТВЕННОЕ место, где определён порядок инициализации.
 *
 * Зачем этот модуль вынесен из `main.tsx` (дефект, найденный 2026-10-01 на реальном
 * Honor Magic 8 Pro): порядок «сначала демо-данные, потом bootstrap()» приводил к
 * падению при ПЕРВОМ запуске. `seedDemoData()` обращается к `session()`, а сессия
 * загружается внутри `bootstrap()` — то есть всегда после. Приложение показывало
 * экран «Не удалось запустить приложение: Сессия не инициализирована: сначала
 * loadSession()» и не давало ничего сделать, кроме перезагрузки, которая падала так же.
 *
 * Юнит-тесты этого не поймали: они проверяли доменную логику, а не порядок запуска.
 * Теперь порядок задан здесь и покрыт тестом `tests/boot.test.ts`, который падает,
 * если кто-то снова вызовет запись в репозиторий до `loadSession()`.
 *
 * Инвариант: **сначала сессия, потом любая запись в данные.**
 */
import { db } from '../data/db';
import { loadSession } from '../data/session';
import { initTheme, type ThemeMode } from './theme';
import { bootstrap, registerServiceWorker, type AppConfig } from './bootstrap';
import { startHealthWatch } from '../notifications/healthWatch';
import { seedDemoData } from '../features/home/demoData';
import { wipeLocalData } from '../data/remote/authStrategy';
import { kvDel, kvGet, kvSet, KV_KEYS } from '../data/db';

export interface StartResult {
  config: AppConfig;
  theme: ThemeMode;
  /** Демо-данные были посажены в этом запуске (первый запуск на устройстве). */
  seededDemo: boolean;
  /**
   * Версия, с которой приложение обновилось, или null.
   *
   * Зачем: при закрытом приложении ожидающий Service Worker активируется без
   * плашки согласия (старых клиентов нет), и новая версия применяется «молча» между
   * запусками — владелец на приёмке 0.1.3 спросил, почему обновлений не видно.
   * Молчаливое применение оставляем (это стандартное поведение PWA и желание владельца
   * «всё подтягивается само»), но добавляем видимую пометку post factum.
   */
  updatedFrom: string | null;
}

/**
 * Полный запуск: тема → сессия → демо-данные (только первый раз) → bootstrap → SW.
 *
 * Service Worker регистрируется последним и свою ошибку не пробрасывает: отсутствие SW
 * означает лишь «нет офлайн-кэша», но приложение обязано работать (§6.1).
 */
export async function startApp(): Promise<StartResult> {
  const theme = await initTheme();

  // 1. Сессия — ДО любой записи в данные. Без неё репозитории не могут проставить
  //    updatedBy, и любое обращение к session() бросает исключение.
  await loadSession();

  // 2. Демо-данные — только если локальная база пуста и они ещё не сажались.
  //    Они обязаны быть очевидно демонстрационными (ТЗ §35 E), а не притворяться
  //    данными бэкенда.
  let seededDemo = false;
  const count = await db.shopping.count();
  if (count === 0) {
    await seedDemoData();
    seededDemo = true;
  }

  // 3. Основное состояние: хранилище, порты синхронизации, удалённый репозиторий.
  const config = await bootstrap();

  // 3.5. Разовая чистка ленты от служебных строк 0.1.8 (заголовки dev-…):
  //      события профилей случайно писались в ленту с id вместо названия.
  if (!(await kvGet<boolean>('cleanup.devTitles.done'))) {
    await db.activity
      .filter((a) => /^dev-[0-9a-f]{6,}$/u.test(a.title))
      .delete()
      .catch(() => 0);
    await kvSet('cleanup.devTitles.done', true);
  }

  // 4. Service Worker — улучшение, а не условие запуска.
  await registerServiceWorker();

  // 4.5. Наблюдатель здоровья: уведомляем только об ошибках, требующих действия
  //      (решение владельца 2026-10-01: потерю сети не уведомляем).
  startHealthWatch();

  // 5. Пометка «обновлено с версии X» — если прошлый запуск был другой версией.
  //    'unknown' = локальные данные уже есть (значит, не первая установка), но номер
  //    версии не записывался: так выглядит устройство, обновившееся с 0.1.3 и ниже,
  //    которые kv ещё не вели. Плашку показать нужно, а прежнюю версию мы не знаем.
  const prevVersion = (await kvGet<string>(KV_KEYS.lastSeenVersion)) ?? null;
  const updatedFrom = prevVersion
    ? prevVersion !== __APP_VERSION__
      ? prevVersion
      : null
    : seededDemo
      ? null
      : 'unknown';
  await kvSet(KV_KEYS.lastSeenVersion, __APP_VERSION__);

  return { config, theme, seededDemo, updatedFrom };
}

/**
 * Аварийный сброс: удалить локальные данные и идентичность устройства, чтобы приложение
 * могло стартовать заново. Используется ТОЛЬКО с экрана «Не удалось запустить», когда
 * приложение в принципе не открылось — терять при этом нечего.
 *
 * В обычном режиме очистка данных делается из Настроек и не трогает `deviceId`.
 */
export async function resetLocalAndReload(): Promise<void> {
  await wipeLocalData();
  await kvDel(KV_KEYS.deviceId);
  await kvDel('demo.seeded');
  window.location.reload();
}
