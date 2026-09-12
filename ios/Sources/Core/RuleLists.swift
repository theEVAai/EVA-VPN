import Foundation

/// Списки адресов для наборов правил.
///
/// ВНИМАНИЕ: файл порождён из настольного src/main/rules.js.
/// Правьте списки там и пересоздавайте — иначе телефон и компьютер
/// начнут вести себя по-разному, а разницу никто не заметит месяцами.
enum RuleLists {

    /// Аналитика, метрики и фингерпринт-сервисы.
    static let trackers: [String] = [
        "metrika.yandex.ru",
        "mc.yandex.ru",
        "webvisor.yandex.ru",
        "webvisor.com",
        "clck.yandex.ru",
        "an.yandex.ru",
        "adfox.yandex.ru",
        "yandexmetrica.com",
        "top.mail.ru",
        "stat.mail.ru",
        "google-analytics.com",
        "analytics.google.com",
        "googletagmanager.com",
        "gtm.google.com",
        "doubleclick.net",
        "googleadservices.com",
        "googlesyndication.com",
        "connect.facebook.net",
        "graph.facebook.com",
        "facebook.net",
        "fbcdn.net",
        "scorecardresearch.com",
        "quantserve.com",
        "bat.bing.com",
        "analytics.microsoft.com",
        "hotjar.com",
        "mixpanel.com",
        "segment.com",
        "amplitude.com",
        "appcues.com",
        "fullstory.com",
        "heap.io",
        "intercom.io",
        "branch.io",
        "appsflyer.com",
        "adjust.com",
        "kochava.com",
        "onesignal.com",
        "sentry.io",
        "bugsnag.com",
        "newrelic.com",
        "crashlytics.com"
    ]

    /// Российские зоны: домен целиком уходит мимо туннеля.
    static let ruSuffix: [String] = [
        ".ru",
        ".su",
        ".рф",
        ".xn--p1ai",
        ".moscow",
        ".tatar"
    ]

    /// Российские сервисы, которым VPN только мешает.
    static let ruDirect: [String] = [
        "yandex.com",
        "yandex.net",
        "yastatic.net",
        "ya.ru",
        "vk.com",
        "vk.ru",
        "vkuser.net",
        "userapi.com",
        "ok.ru",
        "mail.ru",
        "sber.ru",
        "sberbank.com",
        "tbank.ru",
        "tinkoff.ru",
        "gosuslugi.ru",
        "mos.ru",
        "emias.ru",
        "emias.info",
        "avito.ru",
        "ozon.ru",
        "wildberries.ru",
        "wb.ru",
        "kinopoisk.ru",
        "rutube.ru",
        "dzen.ru",
        "rambler.ru",
        "rbc.ru",
        "ria.ru",
        "tass.ru",
        "hh.ru",
        "cian.ru",
        "dns-shop.ru",
        "centraluniversity.ru",
        "cu.ru",
        "kondrashov-lab.ru"
    ]

    /// Плеер Kodik: через прокси видео не отдаётся.
    static let kodik: [String] = [
        "aniqit.com",
        "kodik.cc",
        "kodik.biz",
        "kodik.info",
        "kodikplayer.com",
        "kodikres.com",
        "kodikapi.com",
        "kodik-storage.com",
        "kodik-cdn.com"
    ]

    /// App Store и обновления Apple.
    static let apple: [String] = [
        "appstore.com",
        "apps.apple.com",
        "itunes.apple.com",
        "mzstatic.com"
    ]
}
