import 'fake-indexeddb/auto';

/**
 * jsdom не реализует `matchMedia`. Приложение защищено от его отсутствия
 * (см. `prefersDark()` в src/app/theme.ts), но в тестах нужен предсказуемый ответ
 * «системная тема = светлая», чтобы проверка запуска не зависела от окружения.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  const stubMediaQueryList = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: stubMediaQueryList,
  });
}
