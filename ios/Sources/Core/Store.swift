import Foundation

/// Настройки и ключи.
///
/// Хранится в UserDefaults общей группы приложений. Общая группа здесь не
/// украшение: расширение туннеля — отдельный процесс, и без неё оно просто
/// не увидит ни ключей, ни правил, которые человек завёл в приложении.
///
/// Идентификатор группы обязан совпадать с тем, что прописан в правах
/// (Resources/*.entitlements) и в project.yml.
final class Store {

    static let appGroup = "group.ai.theeva.vpn"
    static let shared = Store()

    private let defaults: UserDefaults

    private enum Key {
        static let profiles = "profiles"
        static let active = "active"
        static let modules = "modules"
        static let userRules = "userRules"
        static let mtu = "mtu"
        static let connectTimeout = "connectTimeout"
        static let ipv6 = "ipv6"
        static let dnsRemote = "dnsRemote"
        static let dnsDirect = "dnsDirect"
    }

    init(defaults: UserDefaults? = nil) {
        // если группа не настроена, не падаем: работаем со своими настройками
        self.defaults = defaults ?? UserDefaults(suiteName: Store.appGroup) ?? .standard
    }

    /* ------------------------------------------------------------------ */
    /* Ключи                                                               */
    /* ------------------------------------------------------------------ */

    var profiles: [Profile] {
        get {
            guard let data = defaults.data(forKey: Key.profiles) else { return [] }
            return (try? JSONDecoder().decode([Profile].self, from: data)) ?? []
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: Key.profiles)
            }
            if !newValue.contains(where: { $0.id == activeId }) {
                activeId = newValue.first?.id ?? ""
            }
        }
    }

    var activeId: String {
        get { defaults.string(forKey: Key.active) ?? "" }
        set { defaults.set(newValue, forKey: Key.active) }
    }

    var activeProfile: Profile? {
        let list = profiles
        return list.first { $0.id == activeId } ?? list.first
    }

    /// Добавляет ключи, пропуская уже известные. Возвращает число новых.
    @discardableResult
    func addProfiles(_ incoming: [Profile], source: String = "manual") -> Int {
        var current = profiles
        var added = 0
        for var p in incoming {
            if current.contains(where: { $0.link == p.link }) { continue }
            p.source = source
            current.append(p)
            added += 1
        }
        if added > 0 {
            profiles = current
            if activeId.isEmpty { activeId = current.first?.id ?? "" }
        }
        return added
    }

    func removeProfile(id: String) {
        profiles = profiles.filter { $0.id != id }
    }

    @discardableResult
    func replaceSubscription(_ source: String, incoming: [Profile]) -> Int {
        let oldActive = activeProfile
        var remaining = profiles.filter { $0.source == source }
        let others = profiles.filter { $0.source != source }
        let fresh = incoming.map { incoming -> Profile in
            var p = incoming
            let index = remaining.firstIndex { $0.link == p.link }
                ?? remaining.firstIndex { $0.type == p.type && $0.name == p.name && $0.server == p.server && $0.port == p.port }
            if let index {
                let old = remaining.remove(at: index)
                p.id = old.id
                p.color = old.color
            }
            p.source = source
            return p
        }
        profiles = others + fresh
        if let oldActive, profiles.contains(where: { $0.id == oldActive.id }) {
            activeId = oldActive.id
        } else if oldActive == nil || oldActive?.source == source {
            activeId = fresh.first?.id ?? others.first?.id ?? ""
        }
        return fresh.count
    }

    /* ------------------------------------------------------------------ */
    /* Правила                                                             */
    /* ------------------------------------------------------------------ */

    var enabledModules: Set<String> {
        get {
            guard let list = defaults.stringArray(forKey: Key.modules) else {
                return Set(RuleModules.all.filter { $0.defaultOn }.map { $0.id })
            }
            return Set(list)
        }
        set { defaults.set(Array(newValue), forKey: Key.modules) }
    }

    func setModule(_ id: String, enabled: Bool) {
        var set = enabledModules
        if enabled { set.insert(id) } else { set.remove(id) }
        enabledModules = set
    }

    var userRules: [UserRule] {
        get {
            guard let data = defaults.data(forKey: Key.userRules) else { return [] }
            return (try? JSONDecoder().decode([UserRule].self, from: data)) ?? []
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: Key.userRules)
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Прочие настройки                                                    */
    /* ------------------------------------------------------------------ */

    var mtu: Int {
        get { defaults.object(forKey: Key.mtu) as? Int ?? 1400 }
        set { defaults.set(newValue, forKey: Key.mtu) }
    }

    var connectTimeout: Int {
        get { min(120, max(5, defaults.object(forKey: Key.connectTimeout) as? Int ?? 30)) }
        set { defaults.set(min(120, max(5, newValue)), forKey: Key.connectTimeout) }
    }

    var ipv6: Bool {
        get { defaults.object(forKey: Key.ipv6) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Key.ipv6) }
    }

    var dnsRemote: String {
        get { defaults.string(forKey: Key.dnsRemote) ?? "https://1.1.1.1/dns-query" }
        set { defaults.set(newValue, forKey: Key.dnsRemote) }
    }

    var dnsDirect: String {
        get { defaults.string(forKey: Key.dnsDirect) ?? "1.1.1.1" }
        set { defaults.set(newValue, forKey: Key.dnsDirect) }
    }

    /// Всё, что влияет на конфигурацию ядра, одним объектом.
    var configOptions: ConfigBuilder.Options {
        var o = ConfigBuilder.Options()
        o.mtu = mtu
        o.connectTimeout = connectTimeout
        o.ipv6 = ipv6
        o.dnsRemote = dnsRemote
        o.dnsDirect = dnsDirect
        o.enabledModules = enabledModules
        o.userRules = userRules
        return o
    }
}
