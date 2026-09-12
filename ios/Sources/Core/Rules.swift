import Foundation

/// Правила маршрутизации: что идёт через туннель, что мимо, что режется.
///
/// Это перенос той же модели, что работает на Android и на компьютере.
/// На телефоне у человека нет списка программ по имени файла, поэтому
/// настройка идёт по адресам. Чтобы не заставлять разбираться в видах
/// правил, как в Clash и Shadowrocket, приложение само определяет,
/// что введено, и объясняет это обычными словами.

/// Что делать с трафиком. Три действия — больше человеку не нужно.
enum RuleAction: String, Codable, CaseIterable {
    /// Через VPN. Так идёт всё остальное по умолчанию.
    case proxy
    /// Мимо VPN, напрямую через оператора.
    case direct
    /// Не пускать никуда.
    case reject

    /// Человеческое название — для списка правил.
    var title: String {
        switch self {
        case .proxy: return "Через VPN"
        case .direct: return "Мимо VPN"
        case .reject: return "Заблокировать"
        }
    }

    /// Пояснение одной строкой, без терминов.
    var hint: String {
        switch self {
        case .proxy: return "Идёт через туннель, как всё остальное"
        case .direct: return "Идёт напрямую через оператора, ваш настоящий адрес"
        case .reject: return "Не открывается вообще: соединение обрывается"
        }
    }
}

/// Как понят введённый адрес.
enum PatternKind {
    case domainSuffix
    case domainKeyword
    case ipCIDR
    case port
}

/// Разобранный ввод: вид правила и объяснение обычными словами.
struct Understood {
    let kind: PatternKind
    /// Значение, очищенное от схемы, пути и звёздочек.
    let value: String
    /// Что приложение поняло — показывается под полем ввода.
    let explanation: String
}

/// Правило, заведённое человеком.
struct UserRule: Codable, Identifiable, Equatable {
    var id: String { pattern }
    var pattern: String
    var action: RuleAction
    var enabled: Bool = true
}

enum Patterns {

    private static let ipv4CIDR = try! NSRegularExpression(
        pattern: "^\\d{1,3}(\\.\\d{1,3}){3}(/\\d{1,2})?$"
    )
    private static let ipv6CIDR = try! NSRegularExpression(
        pattern: "^[0-9a-fA-F:]+(/\\d{1,3})?$"
    )
    private static let portOnly = try! NSRegularExpression(pattern: "^\\d{1,5}$")

    private static func matches(_ regex: NSRegularExpression, _ s: String) -> Bool {
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        return regex.firstMatch(in: s, options: [], range: range) != nil
    }

    /// Похоже на диапазон адресов: тогда «/24» — это маска, а не путь.
    private static func looksLikeCIDR(_ s: String) -> Bool {
        if matches(ipv4CIDR, s) { return true }
        return s.contains(":") && matches(ipv6CIDR, s)
    }

    /// Понимает, что человек ввёл, и объясняет это словами.
    ///
    /// Принимает и полную ссылку, и домен, и адрес, и порт: человек копирует
    /// из адресной строки вместе с https:// и хвостом, и это нормально.
    static func understand(_ raw: String) -> Understood {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        // Звёздочку и точку в начале запоминаем: «*.local» — это домен
        // с поддоменами, даже если точки внутри не осталось.
        let explicitDomain = s.hasPrefix("*.") || s.hasPrefix(".")

        if let range = s.range(of: "://") {
            s = String(s[range.upperBound...])
            s = String(s.prefix(while: { $0 != "/" && $0 != "?" && $0 != "#" }))
        } else if !looksLikeCIDR(s) {
            // у обычного ввода отрезаем путь; у диапазона адресов нельзя,
            // иначе 10.8.0.0/24 молча превратится в один адрес
            s = String(s.prefix(while: { $0 != "/" && $0 != "?" && $0 != "#" }))
        }

        // хвост вида :443 у домена отрезаем, но только если это не голый порт
        if s.filter({ $0 == ":" }).count == 1, !s.hasPrefix("[") {
            let parts = s.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            if parts.count == 2, !parts[0].isEmpty, matches(portOnly, String(parts[1])) {
                s = String(parts[0])
            }
        }

        if s.hasPrefix("*.") { s.removeFirst(2) }
        if s.hasPrefix(".") { s.removeFirst() }
        s = s.trimmingCharacters(in: .whitespaces)

        if explicitDomain, !s.isEmpty, !looksLikeCIDR(s) {
            return Understood(kind: .domainSuffix, value: s,
                              explanation: "Домен \(s) и все его поддомены")
        }

        if s.isEmpty {
            return Understood(kind: .domainSuffix, value: "", explanation: "Пусто — введите адрес")
        }

        if matches(portOnly, s), let port = Int(s), (1...65535).contains(port) {
            return Understood(kind: .port, value: s,
                              explanation: "Всё, что идёт на порт \(s), независимо от адреса")
        }

        if matches(ipv4CIDR, s) {
            let withMask = s.contains("/") ? s : s + "/32"
            let human = s.contains("/") ? "Диапазон адресов \(s)" : "Один адрес \(s)"
            return Understood(kind: .ipCIDR, value: withMask, explanation: human)
        }

        if s.contains(":"), matches(ipv6CIDR, s) {
            let withMask = s.contains("/") ? s : s + "/128"
            return Understood(kind: .ipCIDR, value: withMask, explanation: "Адрес IPv6 \(s)")
        }

        if s.contains(".") {
            return Understood(kind: .domainSuffix, value: s,
                              explanation: "Домен \(s) и все его поддомены")
        }

        return Understood(kind: .domainKeyword, value: s,
                          explanation: "Любой адрес, в котором встречается «\(s)»")
    }
}

/// Готовый набор правил, включаемый тумблером.
struct RuleModule: Identifiable {
    let id: String
    let title: String
    let hint: String
    let action: RuleAction
    var suffixes: [String] = []
    var domains: [String] = []
    /// Распознавание по содержимому пакетов: сейчас только bittorrent.
    var protocols: [String] = []
    let defaultOn: Bool
    var badge: String? = nil
}

enum RuleModules {

    static let all: [RuleModule] = [
        RuleModule(
            id: "blockTrackers",
            title: "Трекеры и метрики",
            hint: "Яндекс.Метрика, Google Analytics, Meta Pixel и ещё три десятка счётчиков",
            action: .reject,
            domains: RuleLists.trackers,
            defaultOn: true
        ),
        RuleModule(
            id: "ruDirect",
            title: "Российские сайты мимо VPN",
            hint: ".ru, .su, .рф, банки, госуслуги, маркетплейсы — быстрее и без блокировок за иностранный адрес",
            action: .direct,
            suffixes: RuleLists.ruSuffix,
            domains: RuleLists.ruDirect,
            defaultOn: true
        ),
        RuleModule(
            id: "kodikDirect",
            title: "Починить Kodik",
            hint: "Плеер аниме и фильмов не отдаёт видео через прокси — пускаем напрямую",
            action: .direct,
            domains: RuleLists.kodik,
            defaultOn: true
        ),
        RuleModule(
            id: "torrentDirect",
            title: "Торренты мимо VPN",
            hint: "Раздача и закачка идут напрямую. Разгружает туннель, но ваш настоящий адрес виден участникам раздачи",
            action: .direct,
            protocols: ["bittorrent"],
            defaultOn: false
        ),
        RuleModule(
            id: "appleDirect",
            title: "App Store мимо VPN",
            hint: "Apple обрывает загрузки через прокси: магазин виснет на «Ожидание», обновления не докачиваются",
            action: .direct,
            domains: RuleLists.apple,
            defaultOn: true,
            badge: "обязательно включить"
        )
    ]

    static func byId(_ id: String) -> RuleModule? {
        all.first { $0.id == id }
    }
}
