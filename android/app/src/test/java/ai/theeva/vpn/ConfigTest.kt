package ai.theeva.vpn

import ai.theeva.vpn.core.ConfigBuilder
import ai.theeva.vpn.core.PatternKind
import ai.theeva.vpn.core.Patterns
import ai.theeva.vpn.core.Profile
import ai.theeva.vpn.core.RuleAction
import ai.theeva.vpn.core.Tls
import ai.theeva.vpn.core.UserRule
import org.json.JSONObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Проверки логики, не зависящей от Android.
 *
 * Главная из них — сборка конфигурации: файл кладётся в build/configs,
 * а потом проверяется настоящим ядром командой sing-box check
 * (см. scripts/check-android-config.mjs). Без этого пришлось бы узнавать
 * об ошибке в конфигурации уже на телефоне, по молчащему туннелю.
 */
class ConfigTest {

    private fun sampleVless(): Profile {
        val tls = JSONObject()
            .put("enabled", true)
            .put("server_name", "example.com")
            .put("insecure", false)
            .put("utls", JSONObject().put("enabled", true).put("fingerprint", "chrome"))
            .put(
                "reality",
                JSONObject().put("enabled", true)
                    .put("public_key", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                    .put("short_id", "0123abcd")
            )
        return Profile(
            id = "test",
            type = "vless",
            name = "Тест",
            server = "1.2.3.4",
            port = 443,
            uuid = "00000000-0000-0000-0000-000000000000",
            flow = "xtls-rprx-vision",
            tls = Tls(tls),
            link = "vless://test"
        )
    }

    /** Кладём конфигурации на диск, чтобы их проверило настоящее ядро. */
    private fun dump(name: String, json: String) {
        val dir = File("build/configs")
        dir.mkdirs()
        File(dir, "$name.json").writeText(json)
    }

    @Test
    fun `конфигурация по умолчанию собирается и содержит нужное`() {
        val json = ConfigBuilder.buildJson(sampleVless())
        dump("default", json)

        val config = JSONObject(json)
        val inbound = config.getJSONArray("inbounds").getJSONObject(0)
        assertEquals("tun", inbound.getString("type"))
        // MTU для сотовой сети, а не проводной
        assertEquals(1400, inbound.getInt("mtu"))
        // маршрутами на Android распоряжается система
        assertEquals(false, inbound.getBoolean("strict_route"))

        val outbound = config.getJSONArray("outbounds").getJSONObject(0)
        assertEquals("vless", outbound.getString("type"))
        assertEquals("xtls-rprx-vision", outbound.getString("flow"))
        assertEquals("xudp", outbound.getString("packet_encoding"))

        // IPv6 на телефоне не режем: у операторов бывает сеть только на нём
        val rules = config.getJSONObject("route").getJSONArray("rules")
        var blocksIpv6 = false
        for (i in 0 until rules.length()) {
            val r = rules.getJSONObject(i)
            if (r.optInt("ip_version") == 6 && r.optString("action") == "reject") blocksIpv6 = true
        }
        assertTrue(!blocksIpv6, "IPv6 не должен блокироваться на телефоне")
    }

    @Test
    fun `свои правила превращаются в правила маршрутизации`() {
        val options = ConfigBuilder.Options(
            userRules = listOf(
                UserRule("sber.ru", RuleAction.DIRECT),
                UserRule("ads.example.net", RuleAction.REJECT),
                UserRule("10.8.0.0/24", RuleAction.DIRECT),
                UserRule("8443", RuleAction.PROXY),
                UserRule("tracker", RuleAction.REJECT)
            )
        )
        val json = ConfigBuilder.buildJson(sampleVless(), options)
        dump("user-rules", json)

        val rules = JSONObject(json).getJSONObject("route").getJSONArray("rules")
        val all = (0 until rules.length()).map { rules.getJSONObject(it) }

        assertTrue(all.any { it.optJSONArray("domain_suffix")?.toString()?.contains("sber.ru") == true })
        assertTrue(all.any { it.optJSONArray("ip_cidr")?.toString()?.contains("10.8.0.0/24") == true })
        assertTrue(all.any { it.optJSONArray("port")?.toString()?.contains("8443") == true })
        assertTrue(all.any { it.optJSONArray("domain_keyword")?.toString()?.contains("tracker") == true })
    }

    @Test
    fun `приложение верно понимает, что ввёл человек`() {
        val cases = listOf(
            "example.com" to PatternKind.DOMAIN_SUFFIX,
            "https://vpn.theeva.ai/download?x=1" to PatternKind.DOMAIN_SUFFIX,
            "*.local" to PatternKind.DOMAIN_SUFFIX,
            "1.2.3.4" to PatternKind.IP_CIDR,
            "10.0.0.0/8" to PatternKind.IP_CIDR,
            "443" to PatternKind.PORT,
            "tracker" to PatternKind.DOMAIN_KEYWORD
        )
        for ((input, kind) in cases) {
            val u = Patterns.understand(input)
            assertEquals(kind, u.kind, "не так понят ввод: $input")
            assertTrue(u.explanation.isNotEmpty(), "нет объяснения для: $input")
        }

        // из ссылки берётся только имя узла
        assertEquals("vpn.theeva.ai", Patterns.understand("https://vpn.theeva.ai/download").value)
        // порт у домена отрезается, а голый порт остаётся портом
        assertEquals("example.com", Patterns.understand("example.com:443").value)
        assertEquals(PatternKind.PORT, Patterns.understand("443").kind)
    }

    @Test
    fun `все типы ключей дают корректный выход`() {
        val types = listOf(
            sampleVless(),
            Profile(id = "1", type = "trojan", name = "t", server = "a.com", port = 443, password = "p"),
            Profile(id = "2", type = "shadowsocks", name = "s", server = "a.com", port = 8388, method = "aes-256-gcm", password = "p"),
            Profile(id = "3", type = "hysteria2", name = "h", server = "a.com", port = 443, password = "p"),
            Profile(id = "4", type = "vmess", name = "v", server = "a.com", port = 443, uuid = "u", security = "auto")
        )
        types.forEach { p ->
            val json = ConfigBuilder.buildJson(p)
            dump("type-" + p.type, json)
            val outbound = JSONObject(json).getJSONArray("outbounds").getJSONObject(0)
            assertEquals(p.type, outbound.getString("type"))
        }
    }
}
