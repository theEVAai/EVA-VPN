import Foundation

/// Разбор ключей доступа.
///
/// Перенесено с настольного клиента (src/main/parse.js) и с Android
/// (core/Profile.kt): те же протоколы, те же запасные значения, те же имена
/// полей. Расхождение означало бы, что ключ работает на компьютере и молча
/// не поднимается на телефоне — самый неприятный вид поломки.

struct Profile: Codable, Identifiable, Equatable {
    var id: String
    var type: String
    var name: String
    var server: String
    var port: Int
    var uuid: String = ""
    var password: String = ""
    var method: String = ""
    var flow: String = ""
    var alterId: Int = 0
    var security: String = ""
    /// TLS и транспорт хранятся как готовые куски конфигурации.
    var tls: JSONValue? = nil
    var transport: JSONValue? = nil
    var obfsType: String = ""
    var obfsPassword: String = ""
    var link: String = ""
    /// Цвет метки ключа: страна узнаётся не читая названия.
    var color: String = ""
    /// "manual" или идентификатор подписки.
    var source: String = "manual"

    /// Строка, по которой ключ отличают в списке.
    var keyId: String {
        if !uuid.isEmpty { return uuid }
        if !password.isEmpty { return password }
        return server
    }
}

/// Ошибка разбора: показывается человеку как есть.
struct ParseError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum Keys {

    /* ------------------------------------------------------------------ */
    /* Вспомогательное                                                     */
    /* ------------------------------------------------------------------ */

    private static func newId() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16).description
    }

    private static func num(_ v: String?, _ def: Int) -> Int {
        guard let v = v, let n = Int(v.trimmingCharacters(in: .whitespaces)) else { return def }
        return n
    }

    /// base64 в обеих раскладках и без дополнения — так его пишут в ссылках.
    static func b64decode(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = s.count % 4
        if remainder == 2 { s += "==" } else if remainder == 3 { s += "=" }
        guard let data = Data(base64Encoded: s, options: [.ignoreUnknownCharacters]) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    private static func looksBase64(_ s: String) -> Bool {
        guard !s.isEmpty, !s.contains("://") else { return false }
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_- \n\r\t")
        return s.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func dec(_ s: String?) -> String {
        guard let s = s, !s.isEmpty else { return "" }
        return s.removingPercentEncoding ?? s
    }

    private static func host(_ c: URLComponents) -> String {
        (c.host ?? "")
            .replacingOccurrences(of: "[", with: "")
            .replacingOccurrences(of: "]", with: "")
    }

    /// Параметры запроса. Значения уже раскодированы.
    private static func query(_ c: URLComponents) -> [String: String] {
        var out: [String: String] = [:]
        for item in c.queryItems ?? [] {
            out[item.name] = item.value ?? ""
        }
        return out
    }

    /* ------------------------------------------------------------------ */
    /* Транспорт и TLS                                                     */
    /* ------------------------------------------------------------------ */

    private static func buildTransport(_ net: String?, _ q: [String: String]) throws -> JSONValue? {
        let type = (net ?? "tcp").lowercased()
        let path = q["path"] ?? ""
        let h = q["host"] ?? ""

        switch type {
        case "", "tcp", "raw":
            if let header = q["headerType"], !header.isEmpty, header != "none" {
                throw ParseError(message: "Маскировка TCP не поддерживается. Нужен ключ TCP/Reality без headerType.")
            }
            return nil

        case "ws":
            var t: [String: JSONValue] = [
                "type": .string("ws"),
                "path": .string(path.isEmpty ? "/" : path)
            ]
            if !h.isEmpty { t["headers"] = .object(["Host": .string(h)]) }
            let ed = num(q["ed"], 0)
            if ed != 0 {
                t["max_early_data"] = .int(ed)
                t["early_data_header_name"] = .string(q["eh"] ?? "Sec-WebSocket-Protocol")
            }
            return .object(t)

        case "httpupgrade":
            var t: [String: JSONValue] = [
                "type": .string("httpupgrade"),
                "path": .string(path.isEmpty ? "/" : path)
            ]
            if !h.isEmpty { t["host"] = .string(h) }
            return .object(t)

        case "grpc":
            let name = q["serviceName"] ?? q["servicename"] ?? path
            return .object(["type": .string("grpc"), "service_name": .string(name)])

        case "http", "h2":
            var t: [String: JSONValue] = [
                "type": .string("http"),
                "path": .string(path.isEmpty ? "/" : path)
            ]
            if !h.isEmpty {
                let hosts = h.split(separator: ",").map {
                    JSONValue.string($0.trimmingCharacters(in: .whitespaces))
                }
                t["host"] = .array(hosts)
            }
            return .object(t)

        default:
            throw ParseError(message: "Транспорт ключа не поддерживается ядром EVA (TCP, WS, gRPC, HTTP, HTTPUpgrade). XHTTP требует другого ядра.")
        }
    }

    private static func buildTLS(_ q: [String: String], defaultSNI: String, forceTLS: Bool) throws -> JSONValue? {
        let security = (q["security"] ?? (forceTLS ? "tls" : "none")).lowercased()
        if security == "none" || security.isEmpty { return nil }
        guard ["tls", "reality"].contains(security) else {
            throw ParseError(message: "Неподдерживаемая защита соединения в ключе.")
        }

        let sni = q["sni"] ?? q["peer"] ?? defaultSNI
        let fp = q["fp"] ?? "chrome"

        var tls: [String: JSONValue] = [
            "enabled": .bool(true),
            "insecure": .bool(q["allowInsecure"] == "1" || q["insecure"] == "1"),
            "utls": .object(["enabled": .bool(true), "fingerprint": .string(fp)])
        ]
        if !sni.isEmpty { tls["server_name"] = .string(sni) }

        if let alpnRaw = q["alpn"], !alpnRaw.isEmpty {
            let alpn = alpnRaw.split(separator: ",").map {
                JSONValue.string($0.trimmingCharacters(in: .whitespaces))
            }
            tls["alpn"] = .array(alpn)
        }

        if security == "reality" {
            tls["reality"] = .object([
                "enabled": .bool(true),
                "public_key": .string(q["pbk"] ?? ""),
                "short_id": .string(q["sid"] ?? "")
            ])
        }
        return .object(tls)
    }

    /* ------------------------------------------------------------------ */
    /* Протоколы                                                           */
    /* ------------------------------------------------------------------ */

    private static func parseVless(_ url: String) throws -> Profile {
        guard let c = URLComponents(string: url) else { throw ParseError(message: "vless: не разобрать ссылку") }
        let q = query(c)
        if let encryption = q["encryption"], !encryption.isEmpty, encryption != "none" {
            throw ParseError(message: "VLESS Encryption не поддерживается ядром EVA. Нужен ключ с encryption=none.")
        }
        let server = host(c)
        let uuid = dec(c.percentEncodedUser)
        if uuid.isEmpty || server.isEmpty {
            throw ParseError(message: "vless: не хватает UUID или адреса")
        }
        return Profile(
            id: newId(),
            type: "vless",
            name: dec(c.percentEncodedFragment).isEmpty ? server : dec(c.percentEncodedFragment),
            server: server,
            port: c.port ?? 443,
            uuid: uuid,
            flow: q["flow"] ?? "",
            tls: try buildTLS(q, defaultSNI: server, forceTLS: false),
            transport: try buildTransport(q["type"] ?? "tcp", q),
            link: url
        )
    }

    private static func parseVmess(_ url: String) throws -> Profile {
        let body = String(url.dropFirst("vmess://".count))
        guard let data = b64decode(body).data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ParseError(message: "vmess: не удалось разобрать ссылку")
        }

        func str(_ key: String) -> String {
            if let s = raw[key] as? String { return s }
            if let n = raw[key] as? NSNumber { return n.stringValue }
            return ""
        }

        var q: [String: String] = ["type": str("net").isEmpty ? "tcp" : str("net")]
        for key in ["path", "host", "sni", "alpn", "fp"] where !str(key).isEmpty {
            q[key] = str(key)
        }
        let tlsField = str("tls")
        if !tlsField.isEmpty { q["security"] = tlsField }

        let secured = tlsField == "tls" || tlsField == "reality"
        let add = str("add")
        let defaultSNI = [str("sni"), str("host"), add].first { !$0.isEmpty } ?? ""

        return Profile(
            id: newId(),
            type: "vmess",
            name: str("ps").isEmpty ? add : str("ps"),
            server: add,
            port: num(str("port"), 443),
            uuid: str("id"),
            alterId: num(str("aid"), 0),
            security: str("scy").isEmpty ? "auto" : str("scy"),
            tls: secured ? (try buildTLS(q, defaultSNI: defaultSNI, forceTLS: true)) : nil,
            transport: try buildTransport(str("net").isEmpty ? "tcp" : str("net"), q),
            link: url
        )
    }

    private static func parseTrojan(_ url: String) throws -> Profile {
        guard let c = URLComponents(string: url) else { throw ParseError(message: "trojan: не разобрать ссылку") }
        let q = query(c)
        let server = host(c)
        return Profile(
            id: newId(),
            type: "trojan",
            name: dec(c.percentEncodedFragment).isEmpty ? server : dec(c.percentEncodedFragment),
            server: server,
            port: c.port ?? 443,
            password: dec(c.percentEncodedUser),
            tls: try buildTLS(q, defaultSNI: server, forceTLS: true),
            transport: try buildTransport(q["type"] ?? "tcp", q),
            link: url
        )
    }

    private static func parseShadowsocks(_ url: String) throws -> Profile {
        var rest = String(url.dropFirst("ss://".count))
        var name = ""

        if let hash = rest.firstIndex(of: "#") {
            name = dec(String(rest[rest.index(after: hash)...]))
            rest = String(rest[..<hash])
        }
        if let q = rest.firstIndex(of: "?") {
            rest = String(rest[..<q])
        }

        var method = ""
        var password = ""
        var server = ""
        var port = 443

        func split(creds: String, hostPart: String) throws {
            guard let colon = creds.firstIndex(of: ":") else {
                throw ParseError(message: "ss: не удалось разобрать ссылку")
            }
            method = String(creds[..<colon])
            password = String(creds[creds.index(after: colon)...])

            guard let hi = hostPart.lastIndex(of: ":") else {
                throw ParseError(message: "ss: не удалось разобрать ссылку")
            }
            server = String(hostPart[..<hi])
                .replacingOccurrences(of: "[", with: "")
                .replacingOccurrences(of: "]", with: "")
            port = num(String(hostPart[hostPart.index(after: hi)...]), 443)
        }

        if let at = rest.lastIndex(of: "@") {
            let userPart = String(rest[..<at])
            let hostPart = String(rest[rest.index(after: at)...])
            let creds = userPart.contains(":") ? dec(userPart) : b64decode(userPart)
            try split(creds: creds, hostPart: hostPart)
        } else {
            let decoded = b64decode(rest)
            guard let at = decoded.lastIndex(of: "@") else {
                throw ParseError(message: "ss: не удалось разобрать ссылку")
            }
            try split(creds: String(decoded[..<at]),
                      hostPart: String(decoded[decoded.index(after: at)...]))
        }

        if server.isEmpty { throw ParseError(message: "ss: не удалось разобрать ссылку") }
        return Profile(
            id: newId(),
            type: "shadowsocks",
            name: name.isEmpty ? server : name,
            server: server,
            port: port,
            method: method,
            password: password,
            link: url
        )
    }

    private static func parseHysteria2(_ url: String) throws -> Profile {
        let normalized = url.hasPrefix("hy2://")
            ? "hysteria2://" + String(url.dropFirst("hy2://".count))
            : url
        guard let c = URLComponents(string: normalized) else {
            throw ParseError(message: "hysteria2: не разобрать ссылку")
        }
        let q = query(c)
        let server = host(c)

        var alpn: [JSONValue] = []
        for part in (q["alpn"] ?? "h3").split(separator: ",") {
            let value = part.trimmingCharacters(in: .whitespaces)
            if !value.isEmpty { alpn.append(.string(value)) }
        }

        let tls: JSONValue = .object([
            "enabled": .bool(true),
            "server_name": .string(q["sni"] ?? server),
            "insecure": .bool(q["insecure"] == "1"),
            "alpn": .array(alpn)
        ])

        let password = dec(c.percentEncodedUser).isEmpty ? (q["password"] ?? "") : dec(c.percentEncodedUser)

        return Profile(
            id: newId(),
            type: "hysteria2",
            name: dec(c.percentEncodedFragment).isEmpty ? server : dec(c.percentEncodedFragment),
            server: server,
            port: c.port ?? 443,
            password: password,
            tls: tls,
            obfsType: q["obfs"] ?? "",
            obfsPassword: q["obfs-password"] ?? "",
            link: normalized
        )
    }

    /* ------------------------------------------------------------------ */
    /* Точки входа                                                         */
    /* ------------------------------------------------------------------ */

    /// Одна ссылка -> профиль.
    static func parseLink(_ raw: String) throws -> Profile? {
        let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if line.isEmpty { return nil }

        if line.hasPrefix("vless://") { return try parseVless(line) }
        if line.hasPrefix("vmess://") { return try parseVmess(line) }
        if line.hasPrefix("trojan://") { return try parseTrojan(line) }
        if line.hasPrefix("ss://") { return try parseShadowsocks(line) }
        if line.hasPrefix("hysteria2://") || line.hasPrefix("hy2://") { return try parseHysteria2(line) }
        return nil
    }

    /// Текст -> список профилей. Принимает одну ссылку, много строк
    /// и содержимое подписки, завёрнутое в base64.
    static func parseMany(_ text: String) throws -> [Profile] {
        var body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty { return [] }

        if looksBase64(body) {
            let decoded = b64decode(body)
            if decoded.contains("://") { body = decoded }
        }

        var out: [Profile] = []
        var firstError: Error?
        for line in body.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            let s = line.trimmingCharacters(in: .whitespaces)
            if s.isEmpty { continue }
            // одна битая строка не должна ронять всю подписку
            do {
                if let profile = try parseLink(s) { out.append(profile) }
            } catch {
                if firstError == nil { firstError = error }
            }
        }
        if out.isEmpty, let firstError { throw firstError }
        return out
    }
}
