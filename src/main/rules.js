'use strict';
/**
 * Наборы правил маршрутизации. Списки перенесены из модулей Surge
 * (PRIVACY / DIRECT) и разложены по тумблерам, чтобы человек включал
 * ровно то, что ему нужно, а не весь файл целиком.
 *
 * REJECT — домен режется на уровне маршрутизации и DNS.
 * DIRECT — домен идёт мимо VPN, напрямую через провайдера.
 */

/** Аналитика, метрики и фингерпринт-сервисы. */
const TRACKERS = [
  // Яндекс
  'metrika.yandex.ru', 'mc.yandex.ru', 'webvisor.yandex.ru', 'webvisor.com',
  'clck.yandex.ru', 'an.yandex.ru', 'adfox.yandex.ru', 'yandexmetrica.com',
  // Mail.ru
  'top.mail.ru', 'stat.mail.ru',
  // Google
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
  'gtm.google.com', 'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
  // Meta
  'connect.facebook.net', 'graph.facebook.com', 'facebook.net', 'fbcdn.net',
  // Прочие
  'scorecardresearch.com', 'quantserve.com', 'bat.bing.com', 'analytics.microsoft.com',
  'hotjar.com', 'mixpanel.com', 'segment.com', 'amplitude.com', 'appcues.com',
  'fullstory.com', 'heap.io', 'intercom.io',
  'branch.io', 'appsflyer.com', 'adjust.com', 'kochava.com', 'onesignal.com',
  'sentry.io', 'bugsnag.com', 'newrelic.com', 'crashlytics.com'
];

/** Российские зоны и сервисы, которым VPN только мешает. */
const RU_SUFFIX = ['.ru', '.su', '.рф', '.xn--p1ai', '.moscow', '.tatar'];

const RU_DIRECT = [
  'yandex.com', 'yandex.net', 'yastatic.net', 'ya.ru',
  'vk.com', 'vk.ru', 'vkuser.net', 'userapi.com', 'ok.ru',
  'mail.ru', 'sber.ru', 'sberbank.com', 'tbank.ru', 'tinkoff.ru',
  'gosuslugi.ru', 'mos.ru', 'emias.ru', 'emias.info',
  'avito.ru', 'ozon.ru', 'wildberries.ru', 'wb.ru',
  'kinopoisk.ru', 'rutube.ru', 'dzen.ru', 'rambler.ru',
  'rbc.ru', 'ria.ru', 'tass.ru', 'hh.ru', 'cian.ru', 'dns-shop.ru',
  'centraluniversity.ru', 'cu.ru', 'kondrashov-lab.ru'
];

/** Плеер Kodik: через прокси видео не отдаётся. */
const KODIK = [
  'aniqit.com', 'kodik.cc', 'kodik.biz', 'kodik.info',
  'kodikplayer.com', 'kodikres.com', 'kodikapi.com',
  'kodik-storage.com', 'kodik-cdn.com'
];

/**
 * App Store и обновления Apple.
 *
 * Apple раздаёт загрузки собственной сетью и на прокси отвечает обрывами:
 * магазин виснет на «Ожидание», обновления не докачиваются. Единственный
 * домен, которому обход действительно нужен.
 */
const APPLE = [
  'appstore.com',
  'apps.apple.com',
  'itunes.apple.com',
  'mzstatic.com'
];

/**
 * Торрент-клиенты.
 *
 * Ловим двумя способами сразу. По имени процесса — берём и раздачу, и DHT,
 * и обращения к трекерам, ещё до того, как по трафику что-то понятно.
 * По распознанному протоколу — всё остальное: переименованный клиент,
 * портативную сборку, встроенную качалку. Проверено живым рукопожатием:
 * ядро отличает торрент от обычного HTTP по первым байтам.
 */
const TORRENT_APPS = [
  'qbittorrent.exe', 'qbittorrent-nox.exe',
  'utorrent.exe', 'utorrentie.exe', 'bittorrent.exe',
  'transmission-qt.exe', 'transmission-gtk.exe', 'transmission-daemon.exe',
  'deluge.exe', 'deluged.exe', 'deluge-gtk.exe', 'deluge-console.exe',
  'bitcomet.exe', 'tixati.exe', 'picotorrent.exe',
  'vuze.exe', 'azureus.exe', 'frostwire.exe',
  'aria2c.exe', 'motrix.exe', 'mediaget.exe', 'zona.exe'
];

/** Описание тумблеров для интерфейса и для сборки конфига. */
const MODULES = [
  {
    key: 'blockTrackers',
    action: 'reject',
    title: 'Трекеры и метрики',
    hint: 'Яндекс.Метрика, Google Analytics, Meta Pixel и ещё 30 счётчиков',
    domains: TRACKERS
  },
  {
    key: 'ruDirect',
    action: 'direct',
    title: 'Российские сайты мимо VPN',
    hint: '.ru, .su, .рф, банки, госуслуги, маркетплейсы — быстрее и без блокировок за иностранный адрес',
    suffixes: RU_SUFFIX,
    domains: RU_DIRECT
  },
  {
    key: 'kodikDirect',
    action: 'direct',
    title: 'Починить Kodik',
    hint: 'Плеер аниме и фильмов не отдаёт видео через прокси — пускаем напрямую',
    domains: KODIK
  },
  {
    key: 'torrentDirect',
    action: 'direct',
    title: 'Торренты мимо VPN',
    hint: 'Раздача и закачка идут напрямую через провайдера. Разгружает туннель, но ваш настоящий адрес виден каждому участнику раздачи',
    processes: TORRENT_APPS,
    protocols: ['bittorrent']
  },
  {
    key: 'trustedDirect',
    action: 'direct',
    title: 'App Store мимо VPN',
    hint: 'Apple обрывает загрузки через прокси: магазин виснет на «Ожидание», обновления не докачиваются',
    badge: 'обязательно включить',
    domains: APPLE
  }
];

module.exports = { MODULES, TRACKERS, RU_SUFFIX, RU_DIRECT, KODIK, APPLE, TORRENT_APPS };
