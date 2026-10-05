/**
 * Только собственные, уже утверждённые владельцем ресурсы. URL строится от
 * scope SW, поэтому работает на GitHub Pages /FAMILY-HUB/ и локально под /.
 * Ключи/подписки не меняем; подпись браузера и приватность lock screen — выбор ОС.
 * Такие же пути у plain-JS SW: совпадение проверяется поведенческими тестами.
 */
export function notificationAppearance(scope: string) {
  return {
    icon: new URL('icons/icon-192.png', scope).href,
    badge: new URL('icons/notification-badge-96.png', scope).href,
    lang: 'ru',
    dir: 'ltr' as const,
  };
}
