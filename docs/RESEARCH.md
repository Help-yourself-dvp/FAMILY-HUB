# RESEARCH — ПРОВЕРЕННЫЕ ФАКТЫ И ИХ ИСТОЧНИКИ

> **Зачем этот файл.** `UNIVERSAL AI GUIDE` §1 требует: только реальные данные, никаких
> выдумок, маркировка уровня уверенности, датировка и указание источников.
> Здесь собраны факты, на которых держится архитектура Family Hub.
>
> **Дата проверки всех фактов: 2026-10-01.** Сетевая ситуация в России меняется
> по неделям — факты F5 и F13 требуют перепроверки перед ЭТАПОМ 2 и ЭТАПОМ 3.
>
> Уровни уверенности: **подтверждено** · **вероятно** · **предположение, требуется
> проверка** · **нет данных**.

---

## A. ЛИМИТЫ И ВОЗМОЖНОСТИ GITHUB

### F1. GitHub Pages для приватного репозитория — платная функция · **подтверждено**
На тарифе GitHub Free Pages публикуется **только из публичных репозиториев**.
Для приватного репо нужен GitHub Pro / Team / Enterprise.
- Источник: [GitHub Community — «GitHub Pages with Free Account: Private Repos…», 24.07.2025](https://github.com/orgs/community/discussions/167331)
- Источник: [runxbuild — «GitHub set repository to private», 23.09.2026](https://www.runxbuild.com/blog/github-set-repository-to-private/)
- Источник: [vpsranking — «GitHub Pages Pricing (2026)»](https://vpsranking.com/serverless/github-pages/)
- **Следствие для проекта:** репозиторий кода обязан быть публичным (`PROJECT.md` §2.1).
  Лимиты Pages: 1 ГБ на сайт, мягкие 100 ГБ/мес трафика и 10 сборок/час.

### F2. Scheduled workflow (cron) в GitHub Actions ненадёжен по документации · **подтверждено**
| Свойство | Значение |
|---|---|
| Минимальный интервал | 5 минут |
| Гарантия времени запуска | **отсутствует**; задержки 10–30 минут обычны, свыше часа — случаются |
| Пропуск запусков | под высокой нагрузкой запуск может быть **молча пропущен без retry** |
| Ветка | только **default branch**; schedule в feature-ветке не сработает никогда |
| Автоотключение | в **публичных** репо — после 60 дней без активности (для приватных это правило не документировано) |
| Таймзона | UTC (опциональное поле `timezone` с марта 2026) |
- Источники: [cronuru — GitHub Actions Scheduled Workflows, 09.09.2026](https://cronuru.com/guides/github-actions-scheduled-workflows) · [steadycron — cron schedule not running, 15.09.2026](https://steadycron.com/guides/github-actions-schedule-not-running/) · [crongenerator.dev](https://crongenerator.dev/cron-github-actions/)
- **Следствие:** cron нельзя использовать как единственный механизм. Отсюда event-driven
  `push`-триггер + идемпотентный state-driven sender (`PROJECT.md` §2.4).

### F3. Лимиты минут GitHub Actions и округление биллинга · **подтверждено**
- Публичные репозитории: стандартные GitHub-hosted runners **бесплатны и без лимита минут**.
- Приватные репозитории на GitHub Free: **2000 Linux-минут в месяц** + 500 МБ хранилища.
- Сверх: $0.006 за минуту (или платный план). Квота сбрасывается ежемесячно и не переносится.
- **Биллинг округляется до целой минуты вверх** → job длительностью 15 секунд стоит 1 минуту.
- Источники: [cicdcalculator — GitHub Actions free tier, 25.08.2026](https://cicdcalculator.com/github-actions-free-tier) · [latchkey.dev — Are GitHub Actions Free, 20.09.2026](https://latchkey.dev/learn/cost/is-github-actions-free)
- **Расчёт для нашего проекта** (`PROJECT.md` §2.4): cron каждые 15 минут в приватном репо
  = 96 запусков/сутки ≈ **2880 мин/мес > 2000** → не проходит.
  Event-driven (~40–60 push-запусков/сутки) + 1 cron/сутки ≈ **1250–1850 мин/мес** → проходит впритык.

### F4. `api.github.com` поддерживает CORS и лимит 5000 запросов/час · **подтверждено фактическим запросом**
Проверено 2026-10-01 из среды разработки:
```
GET https://api.github.com/rate_limit   (с заголовком Origin: https://example.github.io)
→ HTTP/2 200
→ access-control-allow-origin: *
→ access-control-expose-headers: ETag, Link, Location, Retry-After, X-RateLimit-Limit, …
→ x-ratelimit-limit: 5000
```
- **Следствие:** прямые вызовы GitHub REST API из браузера работают, **server-side прокси
  не нужен**. Лимита 5000/час для семьи из 2–4 человек хватает с большим запасом.
- **Не проверено:** расходует ли ответ `304 Not Modified` (условный запрос с ETag) лимит.
  По документации GitHub — не расходует. Проверим эмпирически в ЭТАПЕ 2 (вопрос Q2 в `HANDOFF.md`).
- **Не проверено:** secondary/abuse-лимиты при частых коммитах. Отсюда обязательный
  дебаунс записи (не чаще 1 коммита в 30–60 с на устройство).

### F5. Доступность GitHub из России деградирует · **подтверждено несколькими независимыми источниками, ситуация меняется**
- С 5 мая 2026 OONI фиксирует рост доли аномальных/неудачных подключений к GitHub из РФ
  с фоновых ≤4% до **10% (5 мая) и 16% (6–7 мая)**, с удержанием на этом уровне.
  В других странах (США, Великобритания, Германия) такой тенденции нет.
- Затронуты в том числе `raw.githubusercontent.com` и `release-assets.githubusercontent.com`.
  Гипотеза экспертов: ограничения задели подсети CDN **Fastly**, через который раздаются
  файлы GitHub (по этой же причине пострадал PyPI).
- Заблокировано более 130 отдельных страниц GitHub; только за первые месяцы 2026 года — 61.
- **Роскомнадзор официально отрицает ограничения** и заявляет (20.05.2026), что
  «API сервиса работает без сбоев, регистрация пользователей и создание проектов —
  в штатном режиме».
- GitHub связывал майские инциденты с работами по увеличению мощности платформы.
- Источники: [Meduza, 08.05.2026](https://meduza.io/news/2026-05-08/github-stal-ploho-otkryvatsya-v-rossii-roskomnadzor-utverzhdaet-chto-ne-blokiruet-ego) · [te-st.org — разбор #8, 02.06.2026](https://te-st.org/2026-06-01/pypigithubout/) · [The Moscow Times, 08.05.2026](https://ru.themoscowtimes.com/2026-05-08/v-rossii-nachali-blokirovat-odnu-iz-krupneishih-platform-dlya-programmistov-a194903) · [HashTelegraph, 09.05.2026](https://hashtelegraph.com/hroniki-cheburneta-github-v-rossii-oficialno-otkryt-tehnicheski-ogranichen/) · [Хабр / позиция РКН, 21.05.2026](https://habr.com/ru/news/1037468/) · [securitylab.ru, 09.05.2026](https://www.securitylab.ru/blog/personal/xiaomite-journal/360694.php)
- **Следствие (риск R1):** GitHub не может считаться единственной опорой. Обязательны
  offline-first, агрессивный кэш app shell, абстракция хранилища, export/import и
  задокументированный Plan B по хостингу (`PROJECT.md` §2.1).

### F6. Fine-grained PAT: истечение обязательно, максимум 1 год · **подтверждено**
Fine-grained personal access token имеет **обязательный срок действия, максимум 1 год**;
25 типов per-repository прав (read-only / read-write / no access); доступ только к
выбранным репозиториям. GitHub присылает напоминание до истечения.
- Источники: [DevClass — GitHub introduces fine-grained PATs, 19.10.2022](https://www.devclass.com/development/2022-10-19/github-fixes-over-broad-token-permissions-with-fine-grained-personal-access-tokens-and-controversial-enforced-expiration/1626486) · [PAT Guide](https://git-zen.com/personal-access-token-guide.html) · [Hacker News обсуждение](https://news.ycombinator.com/item?id=33248988)
- **Следствие (риск R7):** раз в год каждый член семьи обязан перевыпустить токен.
  Обязательны: счётчик дней, напоминание за 14 дней, graceful degradation в локальный
  режим, пошаговая инструкция перевыпуска.

### F9. GitHub App: refresh токена БЕЗ `client_secret`, если токен получен через device flow · **подтверждено документацией**
- User access token GitHub App по умолчанию истекает через **8 часов**; refresh token —
  через **6 месяцев без использования**.
- В документации GitHub прямо указано: `client_secret` — «**Required unless the user access
  token was generated using the device flow**».
- GitHub Apps **не поддерживают scopes**; права задаются установкой приложения на
  конкретные репозитории → токен ограничен только репо данных.
- Источники: [GitHub Docs — Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) · [GitHub Docs — Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- **Следствие:** теоретически это идеальное решение — подключение в 3 тапа,
  автообновление в фоне каждые 8 часов, права строго на один репозиторий, ноль секретов.
  **НО см. F10 — работает ли это из браузера, не подтверждено.**

### F10. CORS на эндпоинтах device flow из браузера — НЕ подтверждён · **предположение, требуется проверка**
Проверено 2026-10-01 фактическими запросами из среды разработки:
```
OPTIONS https://github.com/login/device/code        → HTTP/2 404, заголовков access-control-* нет
POST    https://github.com/login/device/code        → HTTP/2 404, {"error":"Not Found"}, access-control-* нет
OPTIONS https://github.com/login/oauth/access_token → HTTP/2 404, заголовков access-control-* нет
POST    https://github.com/login/oauth/access_token → HTTP/2 404, {"error":"Not Found"}, access-control-* нет
(контроль: https://github.com → 200, https://github.com/login/device → 302, api.github.com → 200 с CORS)
```
`404` вероятнее всего означает «неизвестный `client_id`» (проверяли с заведомо
невалидными), но **отсутствие каких-либо `access-control-allow-origin` в ответах** —
главный сигнал: браузерный обмен токена может быть заблокирован CORS.
- Косвенное подтверждение: устройство device flow описывается как решение **для CLI и
  input-constrained устройств**, а не для SPA. Библиотека `@octokit/auth-oauth-device`
  подчёркивает: «does not require the OAuth client secret, which means there is no
  user-owned server component required» — но про CORS не говорит ничего.
- Источники: [octokit/auth-oauth-device.js](https://github.com/octokit/auth-oauth-device.js/) · [GitHub Docs — Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) · практический разбор device flow без секрета: [Issue #4, PullRequestPilot, 27.09.2026](https://github.com/JulianMaurin/PullRequestPilot/issues/4)
- **Следствие:** не строим архитектуру на неподтверждённом. Спайк в реальном браузере —
  ЭТАП 2, вопрос Q1 в `HANDOFF.md`. Auth-слой проектируем как стратегию, чтобы
  переключение стоило одной настройки.

### F11. SPA-поддержка GitHub Apps — отдельная preview-функция; OAuth Apps для SPA не поддерживаются · **подтверждено**
- [github/roadmap #1153 — «Single page app support for GitHub Apps [Preview]»](https://github.com/github/roadmap/issues/1153):
  «SPAs are a specific client type for GitHub Apps — **OAuth apps do not support refresh
  tokens and therefore will not support SPAs**. Clients must use PKCE; must not use a
  client secret; **CORS will be enabled on the `/access_token` endpoint if the
  authorization code was requested for a redirect URI marked as a SPA client**».
- **Следствие:** CORS на token-эндпоинте — новая и условная capability, привязанная к
  специально помеченному redirect URI, а не общее свойство device flow. Это усиливает
  вывод F10: без реального эксперимента рассчитывать нельзя.
- Также: OAuth App + device flow даёт scope `repo` = доступ **ко всем** репозиториям
  пользователя, что существенно шире fine-grained PAT на один репо. Это отдельная причина
  не делать OAuth App базовым путём.

---

## B. PWA, iOS, WEB PUSH

### F7. Web Push на iOS: только Home Screen, iOS 16.4+, только явный жест, silent push запрещён · **подтверждено**
- Push работает **только для PWA, добавленных на Home Screen**. В обычной вкладке Safari —
  нет; `Notification.permission` из вкладки сразу возвращает `denied`.
- Запрос разрешения должен инициироваться **явным действием пользователя**.
- **Silent push не поддерживается**: каждое сообщение обязано быть видимым, иначе iOS
  отзывает подписку.
- APNs-сертификат разработчику **не нужен** — используется стандартный Web Push с VAPID.
- Ограничения: нет background sync, нет автоматического install-prompt, SW-push-слушатели
  «могут срабатывать ненадёжно после перезагрузки устройства», возможны неожиданные
  отписки. Установка — вручную: Share → «На экран Домой».
- Badge API поддерживается с iOS 16.4 (требует разрешения на уведомления).
- iOS 26: любой сайт, добавленный на Home Screen, по умолчанию открывается как web-приложение.
- Источники: [WebKit Features in Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) · [MobiLoud — Do PWAs Work on iOS? 2026, 13.02.2026](https://www.mobiloud.com/blog/progressive-web-apps-ios/) · [instantpwa.com — Can a PWA send push notifications on iOS, 07.07.2026](https://instantpwa.com/answers/can-pwa-send-push-notifications-ios)
- **Следствие:** iPhone 16 владельца подходит (iOS 18/26 ≥ 16.4). Все требования раздела 10
  исходного ТЗ выполнимы. Агрегация уведомлений обязательна ещё и потому, что iOS
  наказывает за невидимые push.

### F8. Declarative Web Push — Safari 18.4+ (iOS/iPadOS), только для приложений с Home Screen · **подтверждено**
Новый механизм: push-сообщение показывает уведомление **без пробуждения Service Worker**.
Браузер распознаёт в JSON-payload ключ `"web_push": 8030` и отображает уведомление
самостояственно; свойство `navigate` задаёт URL, открываемый по тапу.
- Источник (первоисточник): [WebKit Features in Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)
- Поддержка: Safari 18.4 на iOS/iPadOS. **Chromium и Firefox не поддерживают**
  ([whatpwacando.today](https://whatpwacando.today/declarative-web-push/) · [Pushpad](https://pushpad.xyz/blog/declarative-web-push)).
- Практический приём: отправлять **один** payload с обеими формами — декларативной для
  Safari и обычной для остальных; каждый браузер берёт своё
  ([пример реализации, PR #806](https://github.com/Alex-Bancila/osubb-app/pull/806)).
- Ограничение: суммарный размер push-сообщения — **4096 байт**; текст надо обрезать по
  code point, чтобы не разорвать символ.
- **Следствие:** заметно повышает надёжность на iOS, где SW-слушатели ненадёжны (F7).
  Принимаем в `PROJECT.md` §2.4.

### F12. Manifest `shortcuts` не реализован в Safari · **подтверждено**
Долгое нажатие на иконку установленного PWA с меню быстрых действий работает на Android
(Chrome), Windows (Chrome/Edge) и macOS (Chrome), но **не в iOS**: Safari не реализует
`shortcuts`, долгое нажатие на web-приложение показывает только «Удалить» и
«Изменить экран Домой». Максимум 4 shortcut'а, у каждого свой URL в scope приложения.
- Источники: [Progressier — PWA App Shortcuts, 01.09.2026](https://progressier.com/pwa-capabilities/app-shortcuts) · [реальный случай ложного обещания iOS-поддержки, PR #718, 21.09.2026](https://github.com/mishaf1988-lgtm/tfugen-safety/pull/718)
- **Следствие:** в семье с iPhone фича выглядела бы как баг → сознательно не делаем
  (`PROJECT.md` §3).

### R8-основа. Safari ITP: 7-дневная очистка script-writable storage, НО установленные PWA исключены · **подтверждено**
Начиная с iOS/iPadOS 13.4 и Safari 13.1 действует семидневный лимит на всё
script-writable хранилище (IndexedDB, localStorage, Cache API, регистрации Service Worker):
Safari удаляет данные сайта после 7 дней использования браузера **без взаимодействия
с этим сайтом**. Правило **не применяется к установленным на Home Screen web-приложениям** —
у них собственный счётчик использования, который сбрасывается каждым запуском.
- Источники: [Stack Overflow — Is IndexedDB on Safari guaranteed to be persistent (цитата политики WebKit)](https://stackoverflow.com/questions/50795409/is-indexeddb-on-safari-guaranteed-to-be-persistent) · [WebKit — Full Third-Party Cookie Blocking and More (первоисточник политики)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) · [подтверждение разработчиками на реальных устройствах, 10.03.2026](https://www.reddit.com/r/webdev/comments/1rpp4oh/safari_silently_deleted_our_users_saved_data/)
- `navigator.storage.persist()` реально работает только с Safari 17.0+; на более ранних
  версиях возвращает недостоверное значение.
- **Следствие:** у нас только установленные PWA → риск низкий. Но данные всё равно могут
  погибнуть (очистка данных сайта, переустановка iOS, нехватка места). Поэтому
  **GitHub — источник истины, IndexedDB — кэш**: потеря локальных данных восстанавливается
  одной загрузкой.

---

## C. ДОСТАВКА УВЕДОМЛЕНИЙ В РОССИИ

### F13. Android: push идёт через FCM как обязательное промежуточное звено · **подтверждено архитектурно**
«На устройствах с Android приложение зависит от облачной платформы Google Firebase Cloud
Messaging (FCM), на iOS — от Apple Push Notification Service (APNs). Сервер отправляет
короткий сигнал не пользователю, а на сервер Google или Apple, и только потом ОС будит
приложение и показывает уведомление». Как только телефон заблокирован и приложение
выгружено из памяти, **единственным каналом остаётся FCM/APNs**.
- Требуемые исходящие порты для FCM: TCP 5228, 5229, 5230.
- Источники: [mentoday.ru, 19.06.2026](https://www.mentoday.ru/technics/news/19-06-2026/telegram-okonchatelno-vse-u-rossiyan-bez-vpn-perestali-prihodit-push-uvedomleniya-ot-messendjera/) · [Газета.Ru, 18.06.2026](https://www.gazeta.press/tech/news/2026-06-18/28715821.shtml) · [Lenta.ru, 19.06.2026](https://lenta.ru/news/2026-06-19/rossiyane-pozhalovalis-na-blokirovku-odnoy-funktsii-v-telegram/) · [OneSignal — troubleshooting web push](https://documentation.onesignal.com/docs/en/notifications-not-shown-web-push)
- Отдельный известный фактор: китайские OEM (Xiaomi, OPPO, vivo) агрессивно убивают
  фоновые процессы и рвут соединение с FCM ради экономии батареи
  ([CleverTap, 24.04.2025](https://clevertap.com/blog/why-push-notifications-go-undelivered-and-what-to-do-about-it/)).
  **Honor относится к той же группе риска** → в чек-лист ЭТАПА 3 обязательно включаем
  отключение оптимизации батареи для браузера.

### F14. APNs в России работает; массовые жалобы июня 2026 касались серверов Telegram · **вероятно**
По состоянию на июль 2026: «пуши от почты и банков сейчас приходят нормально — курьер
Apple работает как часы». Причина массовых жалоб на Telegram — замедление Роскомнадзором
**серверов самого мессенджера** (с февраля 2026; к концу марта доля неудачных запросов к
доменам Telegram достигала 80–90% в зависимости от региона), а не блокировка канала Apple.
- Источник: [AppleInsider.ru — Не приходят уведомления Telegram на iPhone, 22.07.2026](https://appleinsider.ru/tips-tricks/ne-prihodyat-uvedomleniya-telegram-na-iphone-chto-delat.html)
- **Следствие (риск R3):** для iPhone 16 доставка Web Push через APNs **вероятно** работает.
  Подтверждаем на реальном устройстве в ЭТАПЕ 3.

### F15. Статус FCM в России в 2026 году · **НЕТ ДАННЫХ**
У меня **нет подтверждённых данных** о том, заблокирован или замедлен ли FCM
(`fcm.googleapis.com`, порты 5228–5230) на сетях российских операторов в 2026 году.
- Известно: IP-адреса облачных push-сервисов «находятся под длительными и последовательными
  ограничениями на сетях российских операторов» — но в цитируемых материалах речь идёт о
  связке «сервер Telegram → FCM/APNs», и основной удар пришёлся по серверам Telegram.
- Известно: исторически FCM в России уже ломался как побочный эффект блокировок
  (апрель 2018, Роскомнадзор заблокировал ~20 млн IP-адресов Google, включая
  обслуживающие push-уведомления — [AndroidInsider, 23.04.2018](https://androidinsider.ru/os/roskomnadzor-slomal-push-uvedomleniya-na-android.html) · [4PDA](https://4pda.to/2018-04-23/450924/)).
- Известно: в июне 2026 обсуждались «белые списки» и неработающий push даже у
  российского мессенджера MAX ([Новая газета Европа, 28.03.2026](https://novayagazeta.eu/articles/2026-03-28/push-ne-proidet)).
- **Вывод, который я НЕ делаю:** не утверждаю ни «FCM в РФ работает», ни «не работает».
  **Это риск R2, и он закрывается только экспериментом на реальном Honor Magic 8 Pro
  в ЭТАПЕ 3.** Именно поэтому ЭТАП 3 — жёсткий гейт, а уровни уведомлений 0 и 1
  (локальные + ICS в нативный календарь) спроектированы так, чтобы работать **без FCM
  вообще** и закрывать бóльшую часть потребности семьи.

### F16. UnifiedPush / ntfy как замена FCM · **проверено, не подходит**
Реальный опыт 2026 года: в регионе, где FCM недоступен, связка «UnifiedPush + ntfy из
Play + публичный ntfy.sh» **не работает по умолчанию** — 4 из 5 попыток разбудить
устройство заканчивались отказом (351×`507 Insufficient Storage`, 69×`429`, 19×`400`),
причём с первого дня, а на постоянно подключённых тестовых телефонах это было незаметно.
Рабочее решение потребовало собственного push-сервера и foreground-службы с постоянным
уведомлением в шторке.
- Источник: [Хабр — «Уведомления на Android без Google», 03.08.2026](https://habr.com/ru/articles/1065510/)
- **Следствие:** «бесплатной замены FCM без своего 24/7 сервера» не существует.
  Собственный сервер нарушает требование нулевой стоимости и запрета на постоянно
  включённый компьютер. Поэтому Plan B для Android — **не альтернативный push-транспорт,
  а ICS в нативный календарь + локальные уведомления** (уровни 0 и 1).
- **Отдельный урок из этого источника, который мы применяем к себе:** «замерьте, сколько
  пушей у вас реально доходит» — не «работает ли на телефоне разработчика», а доля
  успешных доставок. Поэтому у нас единый `NotificationLog` и экран «Диагностика»
  показывают, что реально дошло (`PROJECT.md` §2.4).

---

## D. НОРМАЛИЗАЦИЯ РУССКОГО ТЕКСТА

### F17. Стеммер Портера/Snowball не объединяет слова с чередованием согласных · **подтверждено логикой алгоритма**
Snowball Russian stemmer снимает окончания по набору правил, но **не нормализует
чередования в корне**. Практическое следствие для нашего словаря:
- «молоко» → `молок`
- «молочка» → `молочк` (чередование к/ч стеммером не обрабатывается)
- «хлеб» → `хлеб`, «хлеба» → `хлеб` ✓ (здесь стеммер помогает)
- **Следствие:** стемминг — вспомогательный механизм. **Алиасы остаются обязательными.**
  Не обещать владельцу, что стеммер «поймёт всё сам» (`PROJECT.md` §6.4).
- Требование исходного ТЗ по размеру (~5–10 КБ) реалистично: собственная реализация
  русского стеммера Портера укладывается в ~3–5 КБ после минификации. Библиотеки
  `natural`, `compromise-ru` и подобные не подключаем (прямое указание владельца).

---

## E. СРЕДА РАЗРАБОТКИ (проверено фактически 2026-10-01)

### F18. Что доступно и что недоступно из среды разработки
| Проверка | Результат |
|---|---|
| `api.github.com` | ✅ доступен, 200, CORS `*`, `x-ratelimit-limit: 5000` |
| `github.com` | ✅ доступен, 200 |
| `github.com/login/device` | ✅ 302 (страница существует) |
| `github.com/login/device/code`, `/login/oauth/access_token` | ⚠️ 404, **CORS-заголовков нет** (см. F10) |
| `*.github.io` (GitHub Pages) | ❌ **недоступен из среды** (SSL_ERROR_SYSCALL при DNS-резолве и IPv4, и IPv6) |
| Реальные iPhone 16 / Honor Magic 8 Pro | ❌ недоступны |
| Приватный репозиторий семейных данных | ❌ недоступен по требованию приватности |
| `git`, `gh` | ✅ настроены, ветка `arena/01a0f5ef-family-hub` |
- **Следствие (`PROJECT.md` §9.3):** живой Pages-URL проверить из среды нельзя →
  проверяем локальную сборку и `vite preview`; установку PWA и доставку push проверяет
  владелец на реальных устройствах по чек-листам. ИИ эти проверки **не имитирует**.

---

## F. ЧТО ПЕРЕПРОВЕРИТЬ ПЕРЕД СЛЕДУЮЩИМИ ЭТАПАМИ

| Факт | Когда перепроверить | Почему |
|---|---|---|
| F5 (доступность GitHub в РФ) | перед ЭТАПОМ 2 и далее ежемесячно | ситуация меняется по неделям |
| F15 / R2 (FCM в РФ) | **ЭТАП 3** | данных нет; закрывается только экспериментом |
| F2, F3 (лимиты Actions) | перед ЭТАПОМ 3 | GitHub менял тарифы в январе 2026 |
| F7, F8 (iOS Web Push / Declarative) | ЭТАП 3 | Apple меняет поведение web-приложений ежегодно |
| Q2 (304 и rate limit) | ЭТАП 2 | не проверено эмпирически |
| Q1/Q10 (device flow CORS) | ЭТАП 2 | не подтверждено |
