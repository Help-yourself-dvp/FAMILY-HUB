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
import { seedDemoData } from '../features/home/demoData';
import { wipeLocalData } from '../data/remote/authStrategy';
import { kvDel, KV_KEYS } from '../data/db';

export interface StartResult {
  config: AppConfig;
  theme: ThemeMode;
  /** Демо-данные были посажены в этом запуске (первый запуск на устройстве). */
  seededDemo: boolean;
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

  // 4. Service Worker — улучшение, а не условие запуска.
  await registerServiceWorker();

  return { config, theme, seededDemo };
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
