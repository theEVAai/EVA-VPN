package ai.theeva.vpn.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Сборка конфигурации sing-box для телефона.
 *
 * За основу взят генератор настольного клиента (src/main/config.js), но
 * четыре вещи намеренно сделаны иначе — каждая по измеренной причине:
 *
 * 1. IPv6 НЕ блокируется. На компьютере мы его выключаем как частый канал
 *    утечки настоящего адреса. У сотовых операторов сеть сплошь и рядом
 *    только на IPv6 с NAT64 — там такое правило оставит телефон без
 *    интернета вообще, и человек решит, что сломался VPN.
 *
 * 2. MTU 1400, а не 9000. Девять тысяч имеют смысл на проводной сети;
 *    в сотовой реальный размер пакета около 1400, и всё, что больше,
 *    режется по дороге.
 *
 * 3. Нет правил по имени программы. На Android процессов с путями к .exe
 *    нет; раздельное туннелирование делается списком пакетов, и он
 *    передаётся отдельно, при запуске службы (OverrideOptions).
 *
 * 4. strict_route выключен. На Android маршрутами распоряжается система
 *    через VpnService, а не ядро.
 */
object ConfigBuilder {

    const val TUN_IPV4 = "172.19.0.1/30"
    const val TUN_IPV6 = "fdfe:dcba:9876::1/126"

    /** Настройки, влияющие на конфигурацию. */
    data class Options(
        val mtu: Int = 1400,
        /** Разрешить IPv6 внутри туннеля. Выключать только осознанно. */
        val ipv6: Boolean = true,
        val dnsRemote: String = "https://1.1.1.1/dns-query",
        val dnsDirect: String = "1.1.1.1",
        val logLevel: String = "warn",
        /** Ключи включённых модулей (см. RuleModules). */
        val enabledModules: Set<String> = RuleModules.ALL.filter { it.defaultOn }.map { it.key }.toSet(),
        /** Правила, заведённые человеком. */
        val userRules: List<UserRule> = emptyList(),
        /** Обходить частные адреса локальной сети. */
        val bypassPrivate: Boolean = true
    )

    /* ------------------------------------------------------------------ */
    /* Выход (сервер)                                                      */
    /* ------------------------------------------------------------------ */

    fun buildOutbound(p: Profile, tag: String): JSONObject {
        val out = JSONObject()
        out.put("type", p.type)
        out.put("tag", tag)
        out.put("server", p.server)
        out.put("server_port", p.port)

        when (p.type) {
            "vless" -> {
                out.put("uuid", p.uuid)
                if (p.flow.isNotEmpty()) out.put("flow", p.flow)
                out.put("packet_encoding", "xudp")
            }
            "vmess" -> {
                out.put("uuid", p.uuid)
                out.put("security", p.security.ifEmpty { "auto" })
                out.put("alter_id", p.alterId)
                out.put("packet_encoding", "xudp")
            }
            "trojan" -> out.put("password", p.password)
            "shadowsocks" -> {
                out.put("method", p.method)
                out.put("password", p.password)
            }
            "hysteria2" -> {
                out.put("password", p.password)
                if (p.obfsType.isNotEmpty()) {
                    out.put(
                        "obfs",
                        JSONObject().put("type", p.obfsType).put("password", p.obfsPassword)
                    )
                }
            }
            else -> throw IllegalArgumentException("Неподдерживаемый тип ключа: ${p.type}")
        }

        // hysteria2 без TLS не бывает: ядро отказывается запускаться с
        // «TLS required». Если ключ пришёл без него — подставляем разумное,
        // иначе человек увидит не подсказку, а молчащий туннель.
        val tls = p.tls ?: if (p.type == "hysteria2") {
            Tls(
                JSONObject()
                    .put("enabled", true)
                    .put("server_name", p.server)
                    .put("insecure", false)
                    .put("alpn", JSONArray().put("h3"))
            )
        } else null

        tls?.let { out.put("tls", it.json) }
        p.transport?.let { out.put("transport", it.json) }
        return out
    }

    /* ------------------------------------------------------------------ */
    /* Правила                                                             */
    /* ------------------------------------------------------------------ */

    private fun arr(items: List<String>): JSONArray {
        val a = JSONArray()
        items.forEach { a.put(it) }
        return a
    }

    /** Одно правило маршрутизации из набора адресов. */
    private fun routeRule(
        action: RuleAction,
        suffixes: List<String> = emptyList(),
        keywords: List<String> = emptyList(),
        cidrs: List<String> = emptyList(),
        ports: List<Int> = emptyList(),
        protocols: List<String> = emptyList()
    ): JSONObject? {
        if (suffixes.isEmpty() && keywords.isEmpty() && cidrs.isEmpty() &&
            ports.isEmpty() && protocols.isEmpty()
        ) return null

        val r = JSONObject()
        if (suffixes.isNotEmpty()) r.put("domain_suffix", arr(suffixes))
        if (keywords.isNotEmpty()) r.put("domain_keyword", arr(keywords))
        if (cidrs.isNotEmpty()) r.put("ip_cidr", arr(cidrs))
        if (ports.isNotEmpty()) {
            val a = JSONArray()
            ports.forEach { a.put(it) }
            r.put("port", a)
        }
        if (protocols.isNotEmpty()) r.put("protocol", arr(protocols))

        when (action) {
            RuleAction.REJECT -> r.put("action", "reject")
            RuleAction.DIRECT -> r.put("action", "route").put("outbound", "direct")
            RuleAction.PROXY -> r.put("action", "route").put("outbound", "proxy")
        }
        return r
    }

    /** Правило для DNS: у адреса, идущего мимо туннеля, и имя должно решаться мимо. */
    private fun dnsRule(
        action: RuleAction,
        suffixes: List<String> = emptyList(),
        keywords: List<String> = emptyList()
    ): JSONObject? {
        if (suffixes.isEmpty() && keywords.isEmpty()) return null
        val r = JSONObject()
        if (suffixes.isNotEmpty()) r.put("domain_suffix", arr(suffixes))
        if (keywords.isNotEmpty()) r.put("domain_keyword", arr(keywords))
        when (action) {
            RuleAction.REJECT -> r.put("action", "predefined").put("rcode", "NXDOMAIN")
            RuleAction.DIRECT -> r.put("action", "route").put("server", "dns-direct")
            RuleAction.PROXY -> r.put("action", "route").put("server", "dns-remote")
        }
        return r
    }

    /* ------------------------------------------------------------------ */
    /* Конфигурация целиком                                                */
    /* ------------------------------------------------------------------ */

    fun build(profile: Profile, o: Options = Options()): JSONObject {
        val routeRules = JSONArray()
        val dnsRules = JSONArray()

        /* --- разбор и перехват DNS --- */
        // Разбор нужен целиком, включая UDP: без него правило protocol=dns
        // не срабатывает, имена перестают решаться и не открывается ничего.
        // Проверено на настольной версии — там это стоило дня разбирательств.
        routeRules.put(JSONObject().put("action", "sniff"))
        routeRules.put(JSONObject().put("port", JSONArray().put(53)).put("action", "hijack-dns"))
        routeRules.put(JSONObject().put("protocol", "dns").put("action", "hijack-dns"))

        /* --- локальная сеть мимо туннеля --- */
        if (o.bypassPrivate) {
            routeRules.put(
                JSONObject().put("ip_is_private", true).put("action", "route").put("outbound", "direct")
            )
        }

        /* --- свои правила человека: они важнее готовых наборов --- */
        for (rule in o.userRules) {
            if (!rule.enabled) continue
            val u = Patterns.understand(rule.pattern)
            if (u.value.isEmpty()) continue
            val r = when (u.kind) {
                PatternKind.DOMAIN_SUFFIX -> routeRule(rule.action, suffixes = listOf(u.value))
                PatternKind.DOMAIN_KEYWORD -> routeRule(rule.action, keywords = listOf(u.value))
                PatternKind.IP_CIDR -> routeRule(rule.action, cidrs = listOf(u.value))
                PatternKind.PORT -> routeRule(rule.action, ports = listOfNotNull(u.value.toIntOrNull()))
            }
            r?.let { routeRules.put(it) }

            val d = when (u.kind) {
                PatternKind.DOMAIN_SUFFIX -> dnsRule(rule.action, suffixes = listOf(u.value))
                PatternKind.DOMAIN_KEYWORD -> dnsRule(rule.action, keywords = listOf(u.value))
                else -> null
            }
            d?.let { dnsRules.put(it) }
        }

        /* --- готовые наборы: сперва обходы, потом блокировки --- */
        val enabled = RuleModules.ALL.filter { o.enabledModules.contains(it.key) }

        for (m in enabled.filter { it.action == RuleAction.DIRECT }) {
            routeRule(
                m.action,
                suffixes = m.suffixes + m.domains,
                protocols = m.protocols
            )?.let { routeRules.put(it) }
            dnsRule(m.action, suffixes = m.suffixes + m.domains)?.let { dnsRules.put(it) }
        }

        for (m in enabled.filter { it.action == RuleAction.REJECT }) {
            routeRule(m.action, suffixes = m.suffixes + m.domains)?.let { routeRules.put(it) }
            dnsRule(m.action, suffixes = m.suffixes + m.domains)?.let { dnsRules.put(it) }
        }

        /* --- DNS --- */
        val dnsServers = JSONArray()
        val remote = o.dnsRemote.trim()
        if (remote.startsWith("https://")) {
            val withoutScheme = remote.removePrefix("https://")
            val hostPart = withoutScheme.substringBefore('/')
            val pathPart = withoutScheme.substringAfter('/', "")
            val s = JSONObject()
                .put("type", "https")
                .put("tag", "dns-remote")
                .put("server", hostPart)
                .put("detour", "proxy")
                .put("domain_resolver", "dns-direct")
            if (pathPart.isNotEmpty()) s.put("path", "/$pathPart")
            dnsServers.put(s)
        } else {
            dnsServers.put(
                JSONObject().put("type", "udp").put("tag", "dns-remote")
                    .put("server", remote.ifEmpty { "1.1.1.1" }).put("detour", "proxy")
            )
        }
        dnsServers.put(
            JSONObject().put("type", "udp").put("tag", "dns-direct").put("server", o.dnsDirect)
        )
        dnsServers.put(JSONObject().put("type", "hosts").put("tag", "dns-hosts"))

        val dns = JSONObject()
            .put("servers", dnsServers)
            .put("rules", dnsRules)
            .put("final", "dns-remote")
            // На телефоне запрещать IPv6 нельзя: у операторов бывает сеть
            // только на нём. Просим предпочитать IPv4, но не отрезать IPv6.
            .put("strategy", if (o.ipv6) "prefer_ipv4" else "ipv4_only")
            .put("independent_cache", true)

        /* --- вход: туннель --- */
        val tunAddress = JSONArray().put(TUN_IPV4)
        if (o.ipv6) tunAddress.put(TUN_IPV6)

        val tun = JSONObject()
            .put("type", "tun")
            .put("tag", "tun-in")
            .put("address", tunAddress)
            .put("mtu", o.mtu)
            .put("auto_route", true)
            // Маршрутами на Android распоряжается система через VpnService
            .put("strict_route", false)
            .put("stack", "gvisor")

        val inbounds = JSONArray().put(tun)

        val outbounds = JSONArray()
            .put(buildOutbound(profile, "proxy"))
            .put(JSONObject().put("type", "direct").put("tag", "direct"))

        val route = JSONObject()
            .put("rules", routeRules)
            .put("final", "proxy")
            .put("auto_detect_interface", true)
            .put("default_domain_resolver", JSONObject().put("server", "dns-direct"))

        return JSONObject()
            .put("log", JSONObject().put("level", o.logLevel).put("timestamp", true))
            .put("dns", dns)
            .put("inbounds", inbounds)
            .put("outbounds", outbounds)
            .put("route", route)
    }

    /** Готовая строка конфигурации для передачи в ядро. */
    fun buildJson(profile: Profile, o: Options = Options()): String =
        build(profile, o).toString(2)
}
