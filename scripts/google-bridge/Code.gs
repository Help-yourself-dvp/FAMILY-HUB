/**
 * Family Hub → Google Календарь: «мост» (для телефонов, где подписка по URL не доходит).
 *
 * ЗАЧЕМ. Лента Family Hub публикует файл .ics; Google умеет его «добавить по URL», но
 * такой календарь — чужая подписка: Google обновляет её раз в 12–24 часа, а на Android
 * события из неё часто не скачиваются в память телефона вовсе (проверено владельцем
 * 06.10.2026: в веб-версии события есть, на телефоне — нет, и `syncselect` не помог).
 * Событие, созданное в НАСТОЯЩЕМ Google-календаре (например, кнопкой веб-формы в
 * приложении), на том же телефоне появляется сразу — это и есть рабочий путь.
 *
 * ЧТО ДЕЛАЕТ. Этот скрипт запускается в аккаунте владельца по расписанию Google
 * (бесплатно, без серверов и приложений на телефоне): скачивает файлы ленты из
 * публичной ветки `feed` репозитория FAMILY-HUB и «переносит» события в обычный
 * Google-календарь (по умолчанию — отдельный «Family Hub (мост)»). Для телефона это уже
 * родные события Google, поэтому они синхронизируются как любые другие.
 *
 *  ПОДПИСКА ПО URL И КАЛЕНДАРЬ СКРИПТА — РАЗНОЕ. Подписка («Добавить по URL», раздел
 * «Другие календари») доступна только для чтения: события из неё не попадают в память
 * телефона, и писать в неё нельзя. Скрипт её пропускает и ведёт отдельный свой календарь.
 *
 * ЧЕГО НЕ ДЕЛАЕТ. Не читает семейное хранилище (только публичные файлы ленты), не шлёт
 * уведомлений, не трогает календарь владельца дальше выбранного календаря, никому не
 * передаёт данные. Логи — только счётчики, без названий событий.
 *
 * ГРАНИЦЫ (честно):
 *  - у напоминаний Google предел — 4 недели (40320 минут): ступени сроков длиннее
 *    (например, «за 90 дней») переносятся без будильника, само событие остаётся;
 *    в сводке видно, сколько таких будильников пропущено;
 *  - события удаляются только по тем файлам ленты, которые прочитаны в этом цикле:
 *    если лента не скачалась или список файлов не получен — ничего не удаляется
 *    («лучше старое, чем пусто»);
 *  - событие, удалённое в Family Hub, удаляется и из Google-календаря;
 *  - выключенный в приложении раздел публикуется пустым файлом — значит, его события
 *    из Google-календаря тоже уйдут (так и задумано).
 *
 *  НАСТРОЙКА (подробно — docs/GOOGLE-BRIDGE.md):
 *  1. script.google.com → новый проект → вставить весь этот файл.
 *  2. Выполнить функцию `syncFamilyHub` один раз → разрешить доступ к Календарю.
 *     На экране разрешений — «Выбрать все»: календари, внешний сервис, работа без вас.
 *  3. Триггеры (часы) → добавить → `syncFamilyHub` → «По минутам» → каждые 15 минут.
 *
 * ПРОВЕРКА. После запуска откройте вкладку «Выполнения» (Executions) — там появятся строки
 * вида «Family Hub → Google: календарь «Family Hub (мост)», создано 5, …» и ссылка на
 * календарь. Сам календарь — в списке «Мои календари» в calendar.google.com; подписка
 * по URL («Family Hub» без пометки) — другой пункт, её не трогаем и не удаляем.
 */

/**
 * Пишем в журнал. В современном редакторе `console.log` попадает и на вкладку «Выполнения»
 * (Executions), и в панель «Журнал выполнения». Раньше был только `Logger.log` — на
 * «Выполнениях» владелец видел лишь «started / completed», без сводки. А когда писали в оба
 * журнала сразу, в панели «Журнал выполнения» каждая строка показывалась дважды (она собирает
 * и console, и Logger) — поэтому пишем в console, а Logger оставляем запасным путём для
 * старых окружений, где console нет.
 */
function say_(message) {
  if (typeof console !== 'undefined' && console.log) {
    console.log(message);
    return;
  }
  Logger.log(message);
}

/** Репозиторий и ветка, где лежит лента. Меняются только при смене проекта. */
var FEED_OWNER = 'Help-yourself-dvp';
var FEED_REPO = 'FAMILY-HUB';
var FEED_BRANCH = 'feed';

/**
 * Если нужно указать ссылки вручную (например, после «Сменить ссылку» в приложении и
 * отключённого авто-поиска) — впишите адреса сюда, по одному в списке. Пустой список
 * означает «найти файлы ветки feed самому».
 */
var FEED_URLS = [];

/**
 * Календарь, в который переносим события. Пустая строка — основной календарь аккаунта.
 *
 * Имя нарочно отличается от «Family Hub» у подписки по URL: подписка и календарь скрипта
 * иначе выглядят как два одинаковых пункта в списке, и непонятно, какой из них настоящий.
 */
var CALENDAR_NAME = 'Family Hub (мост)';

/** Имя календаря первой версии скрипта: переносим его, чтобы не осталось двойника. */
var LEGACY_CALENDAR_NAME = 'Family Hub';

/** Где помним список файлов ленты, если GitHub в этот момент не ответил. */
var FEEDS_CACHE_KEY = 'family_hub_feeds_v1';

/** Где храним соответствие «событие ленты → событие Google». */
var STORAGE_KEY = 'family_hub_map_v1';

/**
 * Календари, в которых ищем «такое же событие, созданное раньше» (например, кнопкой
 * «Добавить в календарь» из приложения — она открывает веб-форму Google, и событие ложится
 * в основной календарь). Строка 'primary' — основной календарь владельца, можно указать и
 * имена календарей. Пустой список — сверку не делать.
 *
 * Сравниваем ТОЧНОЕ название и начало: события ленты всегда начинаются с «Family Hub · »,
 * поэтому случайное совпадение с чужим событием практически исключено.
 */
var DEDUPE_CALENDARS = ['primary'];

/** Предел напоминаний Google: 4 недели. Дольше — переносим событие без будильника. */
var MAX_REMINDER_MINUTES = 40320;

/** Часовые пояса для дат из ленты (в ленте всегда Europe/Moscow). */
var TZ_OFFSETS = { 'Europe/Moscow': 'GMT+03:00' };

/* ------------------------------------------------------------------ */
/* Основной цикл                                                       */
/* ------------------------------------------------------------------ */

/** Запускается по триггеру. Возвращает строку-сводку (её видно в журнале). */
function syncFamilyHub() {
  var calendar = targetCalendar_();
  var props = PropertiesService.getScriptProperties();
  var map = readMap_(props);
  var stats = {
    created: 0,
    updated: 0,
    removed: 0,
    untouched: 0,
    skipped: 0,
    feeds: 0,
    failed: 0,
    alarmsSkipped: 0,
    /** Своё событие нашли без карты (например, карту потеряли) — подхватили, не дублируем. */
    claimed: 0,
    /** Такое событие уже есть в другом календаре (создано вручную) — второй раз не создаём. */
    already: 0,
  };
  var seen = {};
  /** Файлы ленты, прочитанные в этом цикле. Удаляем события только по ним. */
  var readFeeds = {};

  var feeds = feeds_();
  stats.feeds = feeds.length;

  feeds.forEach(function (feed) {
    var text = null;
    try {
      text = UrlFetchApp.fetch(feed.url, { muteHttpExceptions: true }).getContentText();
    } catch (error) {
      stats.failed += 1;
      say_('Лента «' + feed.name + '»: не скачалась, её события не трогаем');
      return;
    }
    if (!text || text.indexOf('BEGIN:VCALENDAR') < 0) {
      stats.failed += 1;
      say_('Лента «' + feed.name + '»: файл без календаря, её события не трогаем');
      return;
    }
    readFeeds[feed.key] = true;

    parseEvents_(text).forEach(function (item) {
      var start = toDate_(item.start);
      if (!item.uid || !item.summary || !start) {
        stats.skipped += 1;
        return;
      }
      var key = feed.key + '|' + item.uid;
      seen[key] = true;
      var alarms = reminderMinutes_(item.alarms);
      stats.alarmsSkipped += item.alarms.length - alarms.length;

      var existing = map[key] ? calendar.getEventById(map[key]) : null;
      if (!existing) {
        // Карта могла пропасть (проект пересоздали, память очистили), а событие в календаре
        // осталось: находим его и записываем в карту, чтобы не создать вторую копию.
        existing = findTwin_(calendar, item.summary, start, item.allDay);
        if (existing) {
          map[key] = existing.getId();
          stats.claimed += 1;
        }
      }
      if (existing) {
        var changed = false;
        if (existing.getTitle() !== item.summary) {
          existing.setTitle(item.summary);
          changed = true;
        }
        var wantedEnd = item.end ? toDate_(item.end) : null;
        if (wantedEnd && existing.getEndTime().getTime() !== wantedEnd.getTime()) {
          existing.setTime(start, wantedEnd);
          changed = true;
        }
        if (applyReminders_(existing, alarms)) changed = true;
        if (changed) stats.updated += 1;
        else stats.untouched += 1;
        return;
      }

      // Такое же событие уже есть в другом календаре (обычно в основном — его создал сам
      // владелец кнопкой календаря, пока лента не работала). Второй раз не создаём:
      // иначе на одно время в календаре телефона будет две записи.
      if (findDuplicateElsewhere_(item.summary, start, item.allDay, calendar)) {
        stats.already += 1;
        return;
      }

      var event;
      if (item.allDay) {
        event = calendar.createAllDayEvent(item.summary, start, item.end ? toDate_(item.end) : null);
      } else {
        var end = item.end ? toDate_(item.end) : new Date(start.getTime() + 15 * 60 * 1000);
        event = calendar.createEvent(item.summary, start, end);
      }
      if (item.description) event.setDescription(item.description);
      applyReminders_(event, alarms);
      map[key] = event.getId();
      stats.created += 1;
    });
  });

  // Убираем события, которых больше нет в ленте. Только по файлам, которые в ЭТОМ цикле
  // прочитаны: если лента не скачалась или список файлов не получен, ничего не удаляем —
  // «лучше старое, чем пусто».
  Object.keys(map).forEach(function (key) {
    var separator = key.indexOf('|');
    var feedKey = separator < 0 ? '' : key.slice(0, separator);
    if (!readFeeds[feedKey]) return;
    if (seen[key]) return;
    var event = calendar.getEventById(map[key]);
    if (event) event.deleteEvent();
    delete map[key];
    stats.removed += 1;
  });

  writeMap_(props, map);

  var summary =
    'Family Hub → Google: календарь «' +
    calendar.getName() +
    '», создано ' +
    stats.created +
    ', обновлено ' +
    stats.updated +
    ', без изменений ' +
    stats.untouched +
    ', удалено ' +
    stats.removed +
    ', пропущено ' +
    stats.skipped +
    ', лент ' +
    stats.feeds +
    ' (не прочитано: ' +
    stats.failed +
    ')' +
    (stats.claimed > 0 ? ', подхвачено уже существующих: ' + stats.claimed : '') +
    (stats.already > 0 ? ', уже есть в другом календаре (не дублируем): ' + stats.already : '') +
    (stats.alarmsSkipped > 0 ? ', будильников длиннее 4 недель перенесено без звонка: ' + stats.alarmsSkipped : '');
  say_(summary);
  if (stats.already > 0) {
    say_(
      'Найдены события, созданные ранее вне календаря «' +
        CALENDAR_NAME +
        '» (' +
        stats.already +
        '): второй раз их не создаём. Чтобы мост управлял ими как своими, удалите старые записи — тогда события появятся в «' +
        CALENDAR_NAME +
        '» при следующем запуске.',
    );
  }
  say_('Найти календарь: ' + calendarLink_(calendar));
  return summary;
}

/* ------------------------------------------------------------------ */
/* Где взять ленту и куда писать                                       */
/* ------------------------------------------------------------------ */

function targetCalendar_() {
  if (!CALENDAR_NAME) return CalendarApp.getDefaultCalendar();

  var existing = calendarsByName_(CALENDAR_NAME);
  if (existing.length > 0) return existing[0];

  // Календарь первой версии скрипта назывался «Family Hub». Если он есть — переименовываем
  // (события и соответствия остаются на месте) вместо создания второго календаря.
  var legacy = calendarsByName_(LEGACY_CALENDAR_NAME);
  if (legacy.length > 0) {
    try {
      legacy[0].setName(CALENDAR_NAME);
      say_('Календарь «' + LEGACY_CALENDAR_NAME + '» переименован в «' + CALENDAR_NAME + '».');
    } catch (error) {
      say_('Календарь «' + LEGACY_CALENDAR_NAME + '» оставлен как есть: переименовать не удалось.');
    }
    return legacy[0];
  }

  var created = CalendarApp.createCalendar(CALENDAR_NAME);
  try {
    created.setDescription(
      'События из ленты Family Hub. Заполняется скриптом — сроки правьте в приложении Family Hub.',
    );
  } catch (error) {
    // Описание — украшение: не дали — работаем без него.
  }
  say_('Создан календарь «' + CALENDAR_NAME + '».');
  return created;
}

/**
 * Календари с таким именем, которыми владелец распоряжается сам. Подписка «Добавить по URL»
 * тоже может называться «Family Hub», но она только для чтения: писать в неё нельзя, и
 * раньше скрипт мог принять её за свой календарь (события не появлялись). Такие пропускаем.
 */
function calendarsByName_(name) {
  if (!name) return [];
  return CalendarApp.getCalendarsByName(name).filter(function (calendar) {
    try {
      return calendar.isOwnedByMe();
    } catch (error) {
      return true;
    }
  });
}

/**
 * Ищем в календаре событие с тем же названием и началом. Для событий на весь день сравниваем
 * календарный день, для остальных — время начала (с запасом в минуту на округления).
 */
function findTwin_(calendar, title, start, allDay) {
  var day = 24 * 60 * 60 * 1000;
  var events;
  try {
    events = calendar.getEvents(new Date(start.getTime() - day), new Date(start.getTime() + day));
  } catch (error) {
    return null;
  }
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (event.getTitle() !== title) continue;
    if (sameStart_(event, start, allDay)) return event;
  }
  return null;
}

function sameStart_(event, start, allDay) {
  if (allDay || (event.isAllDayEvent && event.isAllDayEvent())) {
    return dayKey_(event.getStartTime()) === dayKey_(start);
  }
  return Math.abs(event.getStartTime().getTime() - start.getTime()) < 60 * 1000;
}

function dayKey_(date) {
  try {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (error) {
    return String(date.getFullYear()) + '-' + date.getMonth() + '-' + date.getDate();
  }
}

/** То же событие, но в другом календаре владельца (его создали вручную). */
function findDuplicateElsewhere_(title, start, allDay, targetCalendar) {
  var targetId = '';
  try {
    targetId = targetCalendar.getId();
  } catch (error) {
    targetId = '';
  }
  for (var i = 0; i < DEDUPE_CALENDARS.length; i++) {
    var name = DEDUPE_CALENDARS[i];
    var calendars = name === 'primary' ? [CalendarApp.getDefaultCalendar()] : calendarsByName_(name);
    for (var j = 0; j < calendars.length; j++) {
      var calendar = calendars[j];
      if (!calendar) continue;
      try {
        if (targetId && calendar.getId() === targetId) continue;
      } catch (error) {
        continue;
      }
      if (findTwin_(calendar, title, start, allDay)) return true;
    }
  }
  return false;
}

/** Ссылка, по которой владелец откроет календарь в браузере (для журнала). */
function calendarLink_(calendar) {
  try {
    return 'https://calendar.google.com/calendar/u/0/r?cid=' + encodeURIComponent(calendar.getId());
  } catch (error) {
    return '(ссылка недоступна)';
  }
}

/**
 * Файлы ленты. Если адреса не вписаны руками — просим список у GitHub (публичный
 * репозиторий, без токена): имена файлов стабильны и меняются только при «Сменить
 * ссылку» в приложении, поэтому они же служат ключами соответствия событий.
 */
function feeds_() {
  if (FEED_URLS.length > 0) {
    return FEED_URLS.map(function (url) {
      var parts = String(url).split('/');
      return { key: parts[parts.length - 1] || String(url), name: parts[parts.length - 1] || 'ссылка', url: url };
    });
  }

  var props = PropertiesService.getScriptProperties();
  var cached = readFeedsCache_(props);
  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://api.github.com/repos/' +
        FEED_OWNER +
        '/' +
        FEED_REPO +
        '/contents/feed?ref=' +
        FEED_BRANCH,
      { muteHttpExceptions: true, headers: { Accept: 'application/vnd.github+json' } },
    );
  } catch (error) {
    say_(
      'Список файлов ленты не получен (сеть).' +
        (cached.length > 0 ? ' Беру сохранённый список: файлов ' + cached.length + '.' : ''),
    );
    return cached;
  }
  if (response.getResponseCode() !== 200) {
    say_(
      'Список файлов ленты: HTTP ' +
        response.getResponseCode() +
        (cached.length > 0 ? ' — беру сохранённый список: файлов ' + cached.length + '.' : '.'),
    );
    return cached;
  }

  var files = [];
  try {
    files = JSON.parse(response.getContentText());
  } catch (error) {
    files = [];
  }
  if (!files || !files.length) {
    say_('В ветке ' + FEED_BRANCH + ' нет файлов ленты.' + (cached.length > 0 ? ' Беру сохранённый список.' : ''));
    return cached;
  }

  var feeds = [];
  files.forEach(function (file) {
    if (!file || !file.name || file.name.indexOf('.ics') < 0) return;
    feeds.push({
      key: file.name,
      name: file.name,
      url:
        file.download_url ||
        'https://raw.githubusercontent.com/' +
          FEED_OWNER +
          '/' +
          FEED_REPO +
          '/' +
          FEED_BRANCH +
          '/' +
          file.name,
    });
  });
  if (feeds.length === 0) {
    say_('Файлов .ics в ветке ' + FEED_BRANCH + ' нет.' + (cached.length > 0 ? ' Беру сохранённый список.' : ''));
    return cached;
  }
  say_('Файлов ленты: ' + feeds.length + '.');
  writeFeedsCache_(props, feeds);
  return feeds;
}

/**
 * Список файлов ленты из памяти скрипта. Нужен на случай, когда api.github.com не ответил
 * (у него есть предел запросов на общий адрес Google): тогда работаем по прошлому списку,
 * а не остаёмся с нулём лент. Файлы всё равно скачиваются заново — данные не устаревают.
 */
function readFeedsCache_(props) {
  try {
    var parsed = JSON.parse(props.getProperty(FEEDS_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeFeedsCache_(props, feeds) {
  try {
    props.setProperty(FEEDS_CACHE_KEY, JSON.stringify(feeds));
  } catch (error) {
    // Память — подстраховка: не сохранилось, значит в следующий раз попробуем снова.
  }
}

/* ------------------------------------------------------------------ */
/* Разбор .ics                                                         */
/* ------------------------------------------------------------------ */

/**
 * Разворачивает «сложенные» строки (RFC 5545 разрезает длинные строки пробелом в начале)
 * и собирает события. Возвращает объекты с полями uid/summary/description/start/end/alarms.
 */
function parseEvents_(ics) {
  var lines = String(ics).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  var events = [];
  var event = null;
  var alarm = null;

  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') {
      event = { alarms: [] };
      return;
    }
    if (line === 'END:VEVENT') {
      if (event) events.push(event);
      event = null;
      return;
    }
    if (!event) return;

    if (line === 'BEGIN:VALARM') {
      alarm = { trigger: null };
      return;
    }
    if (line === 'END:VALARM') {
      if (alarm && alarm.trigger) event.alarms.push(alarm.trigger);
      alarm = null;
      return;
    }

    var colon = line.indexOf(':');
    if (colon < 0) return;
    var head = line.slice(0, colon);
    var value = line.slice(colon + 1);
    var parts = head.split(';');
    var field = parts[0].toUpperCase();
    var params = parts.slice(1);

    if (alarm) {
      if (field === 'TRIGGER') alarm.trigger = value.trim();
      return;
    }
    if (field === 'UID') event.uid = value.trim();
    else if (field === 'SUMMARY') event.summary = unescapeText_(value);
    else if (field === 'DESCRIPTION') event.description = unescapeText_(value);
    else if (field === 'DTSTART') {
      event.start = { value: value.trim(), tzid: param_(params, 'TZID') };
      event.allDay = param_(params, 'VALUE') === 'DATE' || /^\d{8}$/.test(value.trim());
    } else if (field === 'DTEND') {
      event.end = { value: value.trim(), tzid: param_(params, 'TZID') };
    }
  });

  return events;
}

function param_(params, name) {
  for (var i = 0; i < params.length; i += 1) {
    var pair = params[i].split('=');
    if (pair[0].toUpperCase() === name) return pair.slice(1).join('=').replace(/^"|"$/g, '');
  }
  return '';
}

/** Разэкранирование TEXT по RFC 5545 (обратная операция к тому, что делает приложение). */
function unescapeText_(value) {
  return String(value)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Дата из ленты → объект Date. Поддерживаются UTC (…Z), локальное время с TZID и дата без времени. */
function toDate_(cell) {
  if (!cell || !cell.value) return null;
  var value = cell.value;
  var tzid = (cell.tzid || '').replace(/^"|"$/g, '');
  var offset = TZ_OFFSETS[tzid] || Session.getScriptTimeZone() || 'GMT+03:00';

  if (/^\d{8}T\d{6}Z$/.test(value)) return Utilities.parseDate(value, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  if (/^\d{8}T\d{6}$/.test(value)) return Utilities.parseDate(value, offset, "yyyyMMdd'T'HHmmss");
  if (/^\d{8}$/.test(value)) return Utilities.parseDate(value, offset, 'yyyyMMdd');
  return null;
}

/** Ступени напоминаний из VALARM → минуты до события (только «до», не «после» и не «повторять»). */
function reminderMinutes_(triggers) {
  var minutes = [];
  (triggers || []).forEach(function (trigger) {
    var parsed = parseTrigger_(trigger);
    if (parsed === null) return;
    if (parsed < 0 || parsed > MAX_REMINDER_MINUTES) return;
    if (minutes.indexOf(parsed) < 0) minutes.push(parsed);
  });
  return minutes.sort(function (a, b) {
    return a - b;
  });
}

/**
 * TRIGGER вида "-P1D", "-P30D", "-PT30M", "PT0S" → минуты до события.
 * Плюсовые (после события) и абсолютные даты не поддерживаем: в ленте их нет.
 */
function parseTrigger_(trigger) {
  var match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    String(trigger || '').trim(),
  );
  if (!match) return null;
  if (match[1] === '+') return -1; // «после события» — не наш случай
  var weeks = Number(match[2] || 0);
  var days = Number(match[3] || 0);
  var hours = Number(match[4] || 0);
  var mins = Number(match[5] || 0);
  var seconds = Number(match[6] || 0);
  return weeks * 7 * 24 * 60 + days * 24 * 60 + hours * 60 + mins + Math.round(seconds / 60);
}

/** Приводит напоминания события Google к списку из ленты. true — что-то изменилось. */
function applyReminders_(event, wanted) {
  var current = event.getPopupReminders().slice().sort(function (a, b) {
    return a - b;
  });
  if (current.join(',') === wanted.join(',')) return false;
  event.removeAllReminders();
  wanted.forEach(function (minutes) {
    event.addPopupReminder(minutes);
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Память соответствий (Script Properties)                             */
/* ------------------------------------------------------------------ */

function readMap_(props) {
  try {
    var parsed = JSON.parse(props.getProperty(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeMap_(props, map) {
  props.setProperty(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Установка триггера «каждые 15 минут» — запускается из редактора один раз,
 * если владельцу удобнее не настраивать триггер мышью (Триггеры → добавить).
 * Повторный запуск создаёт ещё один триггер: лишний нужно удалить в списке триггеров.
 */
function installTrigger() {
  var created = ScriptApp.newTrigger('syncFamilyHub').timeBased().everyMinutes(15).create();
  say_('Триггер «каждые 15 минут» создан: ' + created.getUniqueId());
}
