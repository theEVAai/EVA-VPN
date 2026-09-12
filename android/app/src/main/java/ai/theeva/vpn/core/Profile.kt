package ai.theeva.vpn.core

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder
import kotlin.random.Random

/**
 * Разбор ключей доступа.
 *
 * Перенесено один в один с настольного клиента (src/main/parse.js): тот же
 * набор протоколов, те же запасные значения, те же имена полей. Расхождение
 * здесь означало бы, что ключ работает на компьютере и молча не поднимается
 * на телефоне — а это самый неприятный вид поломки.
 *
 * Поддерживается: vless, vmess, trojan, shadowsocks, hysteria2, а также
 * подписка — список ссылок, при необходимости завёрнутый в base64.
 */

/** Транспорт sing-box: ws, grpc, http, httpupgrade или ничего для обычного tcp. */
data class Transport(val json: JSONObject)

/** Настройки TLS, включая reality и подделку отпечатка. */
data class Tls(val json: JSONObject)

data class Profile(
    val id: String,
    val type: String,
    val name: String,
    val server: String,
    val port: Int,
    val uuid: String = "",
    val password: String = "",
    val method: String = "",
    val flow: String = "",
    val alterId: Int = 0,
    val security: String = "",
    val tls: Tls? = null,
    val transport: Transport? = null,
    val obfsType: String = "",
    val obfsPassword: String = "",
    val link: String = "",
    /** Цвет метки ключа, как на компьютере: страна узнаётся не читая названия. */
    val color: String = "",
    /** Откуда пришёл: "manual" или идентификатор подписки. */
    val source: String = "manual"
) {
    /** Строка, по которой ключ отличают в списке: у vless это uuid, у прочих — пароль. */
    val keyId: String get() = uuid.ifEmpty { password.ifEmpty { server } }
}

/** Ошибка разбора одной строки: показывается человеку как есть. */
class ParseError(message: String) : Exception(message)

object Keys {

    /* ------------------------------------------------------------------ */
    /* Вспомогательное                                                     */
    /* ------------------------------------------------------------------ */

    private fun newId(): String {
        val bytes = ByteArray(8)
        Random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun num(v: String?, def: Int): Int = v?.trim()?.toIntOrNull() ?: def

    /** base64 в обеих раскладках и без дополнения — так его пишут в ссылках. */
    fun b64decode(raw: String): String {
        val s = raw.trim().replace('-', '+').replace('_', '/')
        val padded = when (s.length % 4) {
            2 -> "$s=="
            3 -> "$s="
            else -> s
        }
        return try {
            String(Base64.decode(padded, Base64.DEFAULT), Charsets.UTF_8)
        } catch (e: Exception) {
            ""
        }
    }

    private fun looksBase64(s: String): Boolean =
        s.isNotEmpty() && !s.contains("://") && Regex("^[A-Za-z0-9+/=_\\-\\s]+$").matches(s)

    private fun dec(s: String?): String =
        if (s.isNullOrEmpty()) "" else try {
            URLDecoder.decode(s, "UTF-8")
        } catch (e: Exception) {
            s
        }

    /** Параметры запроса из ссылки. Значения уже раскодированы. */
    private fun query(uri: URI): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        val raw = uri.rawQuery ?: return out
        for (part in raw.split('&')) {
            if (part.isEmpty()) continue
            val i = part.indexOf('=')
            if (i < 0) out[part] = "" else out[part.substring(0, i)] = dec(part.substring(i + 1))
        }
        return out
    }

    private fun host(uri: URI): String =
        (uri.host ?: "").removePrefix("[").removeSuffix("]")

    /* ------------------------------------------------------------------ */
    /* Транспорт и TLS                                                     */
    /* ------------------------------------------------------------------ */

    private fun buildTransport(net: String?, q: Map<String, String>): Transport? {
        val type = (net ?: "tcp").lowercase()
        val path = q["path"] ?: ""
        val h = q["host"] ?: ""
        return when (type) {
            "", "tcp", "raw" -> null

            "ws" -> {
                val t = JSONObject()
                t.put("type", "ws")
                t.put("path", path.ifEmpty { "/" })
                if (h.isNotEmpty()) t.put("headers", JSONObject().put("Host", h))
                val ed = num(q["ed"], 0)
                if (ed != 0) {
                    t.put("max_early_data", ed)
                    t.put("early_data_header_name", q["eh"] ?: "Sec-WebSocket-Protocol")
                }
                Transport(t)
            }

            "httpupgrade" -> {
                val t = JSONObject()
                t.put("type", "httpupgrade")
                t.put("path", path.ifEmpty { "/" })
                if (h.isNotEmpty()) t.put("host", h)
                Transport(t)
            }

            "grpc" -> {
                val t = JSONObject()
                t.put("type", "grpc")
                t.put("service_name", q["serviceName"] ?: q["servicename"] ?: path)
                Transport(t)
            }

            "http", "h2" -> {
                val t = JSONObject()
                t.put("type", "http")
                t.put("path", path.ifEmpty { "/" })
                if (h.isNotEmpty()) {
                    val arr = JSONArray()
                    h.split(',').map { it.trim() }.filter { it.isNotEmpty() }.forEach { arr.put(it) }
                    t.put("host", arr)
                }
                Transport(t)
            }

            else -> null
        }
    }

    private fun buildTls(q: Map<String, String>, defaultSni: String, forceTls: Boolean): Tls? {
        val security = (q["security"] ?: if (forceTls) "tls" else "none").lowercase()
        if (security == "none" || security.isEmpty()) return null

        val sni = q["sni"] ?: q["peer"] ?: defaultSni
        val fp = q["fp"] ?: "chrome"

        val tls = JSONObject()
        tls.put("enabled", true)
        tls.put("insecure", q["allowInsecure"] == "1" || q["insecure"] == "1")
        tls.put("utls", JSONObject().put("enabled", true).put("fingerprint", fp))
        if (sni.isNotEmpty()) tls.put("server_name", sni)

        val alpnRaw = q["alpn"] ?: ""
        if (alpnRaw.isNotEmpty()) {
            val arr = JSONArray()
            alpnRaw.split(',').map { it.trim() }.filter { it.isNotEmpty() }.forEach { arr.put(it) }
            tls.put("alpn", arr)
        }

        if (security == "reality") {
            tls.put(
                "reality",
                JSONObject()
                    .put("enabled", true)
                    .put("public_key", q["pbk"] ?: "")
                    .put("short_id", q["sid"] ?: "")
            )
        }
        return Tls(tls)
    }

    /* ------------------------------------------------------------------ */
    /* Протоколы                                                           */
    /* ------------------------------------------------------------------ */

    private fun parseVless(url: String): Profile {
        val u = URI(url)
        val q = query(u)
        val server = host(u)
        val uuid = dec(u.userInfo ?: "")
        if (uuid.isEmpty() || server.isEmpty()) throw ParseError("vless: не хватает UUID или адреса")
        return Profile(
            id = newId(),
            type = "vless",
            name = dec(u.rawFragment).ifEmpty { server },
            server = server,
            port = if (u.port > 0) u.port else 443,
            uuid = uuid,
            flow = q["flow"] ?: "",
            tls = buildTls(q, server, false),
            transport = buildTransport(q["type"] ?: "tcp", q),
            link = url
        )
    }

    private fun parseVmess(url: String): Profile {
        val body = url.removePrefix("vmess://")
        val j = try {
            JSONObject(b64decode(body))
        } catch (e: Exception) {
            throw ParseError("vmess: не удалось разобрать ссылку")
        }
        val q = HashMap<String, String>()
        q["type"] = j.optString("net", "tcp")
        j.optString("path").takeIf { it.isNotEmpty() }?.let { q["path"] = it }
        j.optString("host").takeIf { it.isNotEmpty() }?.let { q["host"] = it }
        j.optString("sni").takeIf { it.isNotEmpty() }?.let { q["sni"] = it }
        j.optString("alpn").takeIf { it.isNotEmpty() }?.let { q["alpn"] = it }
        j.optString("fp").takeIf { it.isNotEmpty() }?.let { q["fp"] = it }
        val tlsField = j.optString("tls")
        if (tlsField.isNotEmpty()) q["security"] = tlsField

        val secured = tlsField == "tls" || tlsField == "reality"
        val add = j.optString("add")
        val defaultSni = listOf(j.optString("sni"), j.optString("host"), add).firstOrNull { it.isNotEmpty() } ?: ""

        return Profile(
            id = newId(),
            type = "vmess",
            name = j.optString("ps").ifEmpty { add },
            server = add,
            port = num(j.optString("port"), 443),
            uuid = j.optString("id"),
            alterId = num(j.optString("aid"), 0),
            security = j.optString("scy").ifEmpty { "auto" },
            tls = if (secured) buildTls(q, defaultSni, true) else null,
            transport = buildTransport(j.optString("net", "tcp"), q),
            link = url
        )
    }

    private fun parseTrojan(url: String): Profile {
        val u = URI(url)
        val q = query(u)
        val server = host(u)
        return Profile(
            id = newId(),
            type = "trojan",
            name = dec(u.rawFragment).ifEmpty { server },
            server = server,
            port = if (u.port > 0) u.port else 443,
            password = dec(u.userInfo ?: ""),
            tls = buildTls(q, server, true),
            transport = buildTransport(q["type"] ?: "tcp", q),
            link = url
        )
    }

    private fun parseShadowsocks(url: String): Profile {
        var rest = url.removePrefix("ss://")
        var name = ""

        val hashIdx = rest.indexOf('#')
        if (hashIdx >= 0) {
            name = dec(rest.substring(hashIdx + 1))
            rest = rest.substring(0, hashIdx)
        }
        val qIdx = rest.indexOf('?')
        if (qIdx >= 0) rest = rest.substring(0, qIdx)

        val method: String
        val password: String
        val server: String
        val port: Int

        if (rest.contains('@')) {
            val at = rest.lastIndexOf('@')
            val userPart = rest.substring(0, at)
            val hostPart = rest.substring(at + 1)
            val creds = if (userPart.contains(':')) dec(userPart) else b64decode(userPart)
            val ci = creds.indexOf(':')
            if (ci < 0) throw ParseError("ss: не удалось разобрать ссылку")
            method = creds.substring(0, ci)
            password = creds.substring(ci + 1)
            val hi = hostPart.lastIndexOf(':')
            if (hi < 0) throw ParseError("ss: не удалось разобрать ссылку")
            server = hostPart.substring(0, hi).removePrefix("[").removeSuffix("]")
            port = num(hostPart.substring(hi + 1), 443)
        } else {
            val decoded = b64decode(rest)
            val at = decoded.lastIndexOf('@')
            if (at < 0) throw ParseError("ss: не удалось разобрать ссылку")
            val creds = decoded.substring(0, at)
            val hostPart = decoded.substring(at + 1)
            val ci = creds.indexOf(':')
            if (ci < 0) throw ParseError("ss: не удалось разобрать ссылку")
            method = creds.substring(0, ci)
            password = creds.substring(ci + 1)
            val hi = hostPart.lastIndexOf(':')
            if (hi < 0) throw ParseError("ss: не удалось разобрать ссылку")
            server = hostPart.substring(0, hi).removePrefix("[").removeSuffix("]")
            port = num(hostPart.substring(hi + 1), 443)
        }

        if (server.isEmpty()) throw ParseError("ss: не удалось разобрать ссылку")
        return Profile(
            id = newId(),
            type = "shadowsocks",
            name = name.ifEmpty { server },
            server = server,
            port = port,
            method = method,
            password = password,
            link = url
        )
    }

    private fun parseHysteria2(url: String): Profile {
        val normalized = url.replaceFirst(Regex("^hy2://"), "hysteria2://")
        val u = URI(normalized)
        val q = query(u)
        val server = host(u)

        val tls = JSONObject()
        tls.put("enabled", true)
        tls.put("server_name", q["sni"] ?: server)
        tls.put("insecure", q["insecure"] == "1")
        val alpn = JSONArray()
        (q["alpn"] ?: "h3").split(',').map { it.trim() }.filter { it.isNotEmpty() }.forEach { alpn.put(it) }
        tls.put("alpn", alpn)

        return Profile(
            id = newId(),
            type = "hysteria2",
            name = dec(u.rawFragment).ifEmpty { server },
            server = server,
            port = if (u.port > 0) u.port else 443,
            password = dec(u.userInfo ?: "").ifEmpty { q["password"] ?: "" },
            tls = Tls(tls),
            obfsType = q["obfs"] ?: "",
            obfsPassword = q["obfs-password"] ?: "",
            link = normalized
        )
    }

    /* ------------------------------------------------------------------ */
    /* Точки входа                                                         */
    /* ------------------------------------------------------------------ */

    /** Одна ссылка -> профиль. Бросает ParseError с человеческим текстом. */
    fun parseLink(raw: String): Profile? {
        val line = raw.trim()
        if (line.isEmpty()) return null
        return when {
            line.startsWith("vless://") -> parseVless(line)
            line.startsWith("vmess://") -> parseVmess(line)
            line.startsWith("trojan://") -> parseTrojan(line)
            line.startsWith("ss://") -> parseShadowsocks(line)
            line.startsWith("hysteria2://") || line.startsWith("hy2://") -> parseHysteria2(line)
            else -> null
        }
    }

    /**
     * Текст -> список профилей. Принимает и одну ссылку, и много строк,
     * и содержимое подписки, завёрнутое в base64.
     */
    fun parseMany(text: String): List<Profile> {
        var body = text.trim()
        if (body.isEmpty()) return emptyList()

        if (looksBase64(body)) {
            val decoded = b64decode(body)
            if (decoded.contains("://")) body = decoded
        }

        val out = ArrayList<Profile>()
        for (line in body.split('\n', '\r')) {
            val s = line.trim()
            if (s.isEmpty()) continue
            try {
                parseLink(s)?.let { out.add(it) }
            } catch (e: Exception) {
                // одна битая строка не должна ронять всю подписку
            }
        }
        return out
    }
}
