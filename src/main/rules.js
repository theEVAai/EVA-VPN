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

/**
 * Реклама и телеметрия YouTube.
 * Честно: сами ролики раздаются с тех же адресов, что и видео, поэтому
 * доменной блокировкой снимаются баннеры, счётчики и часть преролла,
 * но не всё. Полностью режет только расширение в браузере.
 */
const YOUTUBE_ADS = [
  'googleads.g.doubleclick.net', 'pubads.g.doubleclick.net', 'static.doubleclick.net',
  'ad.doubleclick.net', 'stats.g.doubleclick.net',
  'ads.youtube.com', 'ad.youtube.com', 'clients1.google.com',
  'youtube.googleapis.com/youtubei/v1/log_event',
  'yt3.ggpht.com/ads', 's.youtube.com', 'video-stats.l.google.com',
  'googleadapis.l.google.com', 'imasdk.googleapis.com'
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
 * Процессы, которым туннель только мешает.
 *
 * Если сайт живёт на этом же компьютере и отдаётся наружу через туннель
 * (Cloudflare Tunnel, ngrok и подобные), то заворачивать его обратный канал
 * в VPN — значит гонять каждый запрос лишний круг через зарубежный сервер:
 * браузер идёт на Cloudflare, а Cloudflare возвращается на этот же ПК через
 * туннель, который теперь проложен через другую страну. Сайт от этого
 * открывается втрое дольше для всех, включая владельца.
 */
const SELF_HOSTED = [
  'cloudflared.exe',
  'ngrok.exe',
  'frpc.exe',
  'tailscaled.exe'
];

/** Сервисы, которым проксирование ломает работу. */
const TRUSTED = ['appstore.com', 'theeva.ai'];

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
    key: 'blockAds',
    action: 'reject',
    title: 'Реклама',
    hint: 'Общий список рекламных доменов (geosite category-ads-all)',
    ruleSet: 'geosite-category-ads-all'
  },
  {
    key: 'blockYoutubeAds',
    action: 'reject',
    title: 'Реклама в YouTube',
    hint: 'Баннеры и счётчики. Ролики идут с адресов самого видео — их доменом не отрезать',
    domains: YOUTUBE_ADS
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
    key: 'selfHostedDirect',
    action: 'direct',
    title: 'Свой сервер мимо VPN',
    hint: 'Cloudflare Tunnel и подобные: иначе сайт с этого ПК открывается через лишний круг',
    processes: SELF_HOSTED
  },
  {
    key: 'trustedDirect',
    action: 'direct',
    title: 'Свои сервисы мимо VPN',
    hint: 'theeva.ai и App Store: им проксирование только мешает',
    domains: TRUSTED
  }
];

module.exports = { MODULES, TRACKERS, YOUTUBE_ADS, RU_SUFFIX, RU_DIRECT, KODIK, TRUSTED, SELF_HOSTED };
