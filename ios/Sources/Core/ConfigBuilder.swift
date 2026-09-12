import Foundation

/// Сборка конфигурации sing-box для iPhone.
///
/// Зеркало Android-версии (android/.../core/ConfigBuilder.kt), которая, в
/// свою очередь, повторяет настольный генератор. Отличия от компьютера те же
/// и по тем же причинам:
///
/// 1. IPv6 не блокируется: у сотовых операторов сеть бывает только на нём,
///    и запрет оставил бы телефон без интернета.
/// 2. MTU 1400, а не 9000: в сотовой сети пакеты больше этого режутся.
/// 3. Нет правил по имени программы.
///
/// Третий пункт на iOS особенно важен. Apple не позволяет обычному
/// приложению делить туннель по программам — такое доступно только
/// управлению корпоративными устройствами. Поэтому список правил по
/// адресам здесь не дополнение к разделению по программам, как на
/// Android, а единственная его замена.
enum ConfigBuilder {

    static let tunIPv4 = "172.19.0.1/30"
    static let tunIPv6 = "fdfe:dcba:9876::1/126"

    struct Options {
        var mtu: Int = 1400
        /// Разрешить IPv6 внутри туннеля. Выключать только осознанно.
        var ipv6: Bool = true
        var dnsRemote: String = "https://1.1.1.1/dns-query"
        var dnsDirect: String = "1.1.1.1"
        var logLevel: String = "warn"
        var enabledModules: Set<String> = Set(
            RuleModules.all.filter { $0.defaultOn }.map { $0.id }
        )
        var userRules: [UserRule] = []
        var bypassPrivate: Bool = true

        init() {}
    }

    /* ------------------------------------------------------------------ */
    /* Выход (сервер)                                                      */
    /* ------------------------------------------------------------------ */

    static func buildOutbound(_ p: Profile, tag: String) throws -> JSONValue {
        var out: [String: JSONValue] = [
            "type": .string(p.type),
            "tag": .string(tag),
            "server": .string(p.server),
            "server_port": .int(p.port)
        ]

        switch p.type {
        case "vless":
            out["uuid"] = .string(p.uuid)
            if !p.flow.isEmpty { out["flow"] = .string(p.flow) }
            out["packet_encoding"] = .string("xudp")

        case "vmess":
            out["uuid"] = .string(p.uuid)
            out["security"] = .string(p.security.isEmpty ? "auto" : p.security)
            out["alter_id"] = .int(p.alterId)
            out["packet_encoding"] = .string("xudp")

        case "trojan":
            out["password"] = .string(p.password)

        case "shadowsocks":
            out["method"] = .string(p.method)
            out["password"] = .string(p.password)

        case "hysteria2":
            out["password"] = .string(p.password)
            if !p.obfsType.isEmpty {
                out["obfs"] = .object([
                    "type": .string(p.obfsType),
                    "password": .string(p.obfsPassword)
                ])
            }

        default:
            throw ParseError(message: "Неподдерживаемый тип ключа: \(p.type)")
        }

        // hysteria2 без TLS не бывает: ядро откажется запускаться с
        // «TLS required». Подставляем разумное, иначе человек увидит
        // не подсказку, а молчащий туннель.
        var tls = p.tls
        if tls == nil, p.type == "hysteria2" {
            tls = .object([
                "enabled": .bool(true),
                "server_name": .string(p.server),
                "insecure": .bool(false),
                "alpn": .array([.string("h3")])
            ])
        }
        if let tls = tls { out["tls"] = tls }
        if let transport = p.transport { out["transport"] = transport }

        return .object(out)
    }

    /* ------------------------------------------------------------------ */
    /* Правила                                                             */
    /* ------------------------------------------------------------------ */

    private static func routeRule(
        action: RuleAction,
        suffixes: [String] = [],
        keywords: [String] = [],
        cidrs: [String] = [],
        ports: [Int] = [],
        protocols: [String] = []
    ) -> JSONValue? {
        if suffixes.isEmpty && keywords.isEmpty && cidrs.isEmpty
            && ports.isEmpty && protocols.isEmpty { return nil }

        var r: [String: JSONValue] = [:]
        if !suffixes.isEmpty { r["domain_suffix"] = .array(suffixes.map { .string($0) }) }
        if !keywords.isEmpty { r["domain_keyword"] = .array(keywords.map { .string($0) }) }
        if !cidrs.isEmpty { r["ip_cidr"] = .array(cidrs.map { .string($0) }) }
        if !ports.isEmpty { r["port"] = .array(ports.map { .int($0) }) }
        if !protocols.isEmpty { r["protocol"] = .array(protocols.map { .string($0) }) }

        switch action {
        case .reject:
            r["action"] = .string("reject")
        case .direct:
            r["action"] = .string("route")
            r["outbound"] = .string("direct")
        case .proxy:
            r["action"] = .string("route")
            r["outbound"] = .string("proxy")
        }
        return .object(r)
    }

    private static func dnsRule(
        action: RuleAction,
        suffixes: [String] = [],
        keywords: [String] = []
    ) -> JSONValue? {
        if suffixes.isEmpty && keywords.isEmpty { return nil }

        var r: [String: JSONValue] = [:]
        if !suffixes.isEmpty { r["domain_suffix"] = .array(suffixes.map { .string($0) }) }
        if !keywords.isEmpty { r["domain_keyword"] = .array(keywords.map { .string($0) }) }

        switch action {
        case .reject:
            r["action"] = .string("predefined")
            r["rcode"] = .string("NXDOMAIN")
        case .direct:
            r["action"] = .string("route")
            r["server"] = .string("dns-direct")
        case .proxy:
            r["action"] = .string("route")
            r["server"] = .string("dns-remote")
        }
        return .object(r)
    }

    /* ------------------------------------------------------------------ */
    /* Конфигурация целиком                                                */
    /* ------------------------------------------------------------------ */

    static func build(profile: Profile, options o: Options = Options()) throws -> JSONValue {
        var routeRules: [JSONValue] = []
        var dnsRules: [JSONValue] = []

        // Разбор нужен целиком, включая UDP: без него правило protocol=dns
        // не срабатывает, имена перестают решаться и не открывается ничего.
        routeRules.append(.object(["action": .string("sniff")]))
        routeRules.append(.object([
            "port": .array([.int(53)]),
            "action": .string("hijack-dns")
        ]))
        routeRules.append(.object([
            "protocol": .string("dns"),
            "action": .string("hijack-dns")
        ]))

        if o.bypassPrivate {
            routeRules.append(.object([
                "ip_is_private": .bool(true),
                "action": .string("route"),
                "outbound": .string("direct")
            ]))
        }

        // свои правила важнее готовых наборов
        for rule in o.userRules where rule.enabled {
            let u = Patterns.understand(rule.pattern)
            if u.value.isEmpty { continue }

            let route: JSONValue?
            let dns: JSONValue?
            switch u.kind {
            case .domainSuffix:
                route = routeRule(action: rule.action, suffixes: [u.value])
                dns = dnsRule(action: rule.action, suffixes: [u.value])
            case .domainKeyword:
                route = routeRule(action: rule.action, keywords: [u.value])
                dns = dnsRule(action: rule.action, keywords: [u.value])
            case .ipCIDR:
                route = routeRule(action: rule.action, cidrs: [u.value])
                dns = nil
            case .port:
                route = routeRule(action: rule.action, ports: Int(u.value).map { [$0] } ?? [])
                dns = nil
            }
            if let route = route { routeRules.append(route) }
            if let dns = dns { dnsRules.append(dns) }
        }

        let enabled = RuleModules.all.filter { o.enabledModules.contains($0.id) }

        for m in enabled where m.action == .direct {
            if let r = routeRule(action: m.action,
                                 suffixes: m.suffixes + m.domains,
                                 protocols: m.protocols) {
                routeRules.append(r)
            }
            if let d = dnsRule(action: m.action, suffixes: m.suffixes + m.domains) {
                dnsRules.append(d)
            }
        }

        for m in enabled where m.action == .reject {
            if let r = routeRule(action: m.action, suffixes: m.suffixes + m.domains) {
                routeRules.append(r)
            }
            if let d = dnsRule(action: m.action, suffixes: m.suffixes + m.domains) {
                dnsRules.append(d)
            }
        }

        /* --- DNS --- */
        var dnsServers: [JSONValue] = []
        let remote = o.dnsRemote.trimmingCharacters(in: .whitespaces)
        if remote.hasPrefix("https://") {
            let withoutScheme = String(remote.dropFirst("https://".count))
            let hostPart = String(withoutScheme.prefix(while: { $0 != "/" }))
            let pathPart = withoutScheme.dropFirst(hostPart.count)

            var s: [String: JSONValue] = [
                "type": .string("https"),
                "tag": .string("dns-remote"),
                "server": .string(hostPart),
                "detour": .string("proxy"),
                "domain_resolver": .string("dns-direct")
            ]
            if !pathPart.isEmpty { s["path"] = .string(String(pathPart)) }
            dnsServers.append(.object(s))
        } else {
            dnsServers.append(.object([
                "type": .string("udp"),
                "tag": .string("dns-remote"),
                "server": .string(remote.isEmpty ? "1.1.1.1" : remote),
                "detour": .string("proxy")
            ]))
        }
        dnsServers.append(.object([
            "type": .string("udp"),
            "tag": .string("dns-direct"),
            "server": .string(o.dnsDirect)
        ]))
        dnsServers.append(.object(["type": .string("hosts"), "tag": .string("dns-hosts")]))

        let dns: JSONValue = .object([
            "servers": .array(dnsServers),
            "rules": .array(dnsRules),
            "final": .string("dns-remote"),
            "strategy": .string(o.ipv6 ? "prefer_ipv4" : "ipv4_only"),
            "independent_cache": .bool(true)
        ])

        /* --- вход: туннель --- */
        var addresses: [JSONValue] = [.string(tunIPv4)]
        if o.ipv6 { addresses.append(.string(tunIPv6)) }

        let tun: JSONValue = .object([
            "type": .string("tun"),
            "tag": .string("tun-in"),
            "address": .array(addresses),
            "mtu": .int(o.mtu),
            "auto_route": .bool(true),
            // маршрутами на iOS распоряжается система через NetworkExtension
            "strict_route": .bool(false),
            "stack": .string("gvisor")
        ])

        let outbounds: [JSONValue] = [
            try buildOutbound(profile, tag: "proxy"),
            .object(["type": .string("direct"), "tag": .string("direct")])
        ]

        let route: JSONValue = .object([
            "rules": .array(routeRules),
            "final": .string("proxy"),
            "auto_detect_interface": .bool(true),
            "default_domain_resolver": .object(["server": .string("dns-direct")])
        ])

        return .object([
            "log": .object(["level": .string(o.logLevel), "timestamp": .bool(true)]),
            "dns": dns,
            "inbounds": .array([tun]),
            "outbounds": .array(outbounds),
            "route": route
        ])
    }

    /// Готовая строка конфигурации для передачи в ядро.
    static func buildJSON(profile: Profile, options: Options = Options()) throws -> String {
        try build(profile: profile, options: options).jsonString()
    }
}
