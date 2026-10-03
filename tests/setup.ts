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

/**
 * jsdom не реализует `Element.prototype.scrollIntoView`, а приложение вызывает его
 * отложенно: когда поле формы покупки получает фокус, поле подъезжает к центру экрана
 * (чтобы клавиатура телефона его не закрыла). Отложенный вызов срабатывает уже после
 * того, как форма закрыта, и без заглушки роняет тот файл тестов, который открывал
 * форму покупки. Заглушка повторяет поведение браузера — просто ничего не делает.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined;
}
