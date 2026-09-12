package ai.theeva.vpn.core

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Настройки и ключи.
 *
 * Хранится всё в обычных SharedPreferences: объём крошечный, а лишняя
 * база данных — лишняя причина для отказа при обновлении приложения.
 * Ключи доступа лежат здесь же; на Android песочница приложения уже
 * закрыта от других программ.
 */
class Store(context: Context) {

    companion object {
        private const val FILE = "eva"

        private const val KEY_PROFILES = "profiles"
        private const val KEY_ACTIVE = "active"
        private const val KEY_MODULES = "modules"
        private const val KEY_USER_RULES = "userRules"
        private const val KEY_SPLIT_MODE = "splitMode"
        private const val KEY_SPLIT_APPS = "splitApps"
        private const val KEY_MTU = "mtu"
        private const val KEY_IPV6 = "ipv6"
        private const val KEY_DNS_REMOTE = "dnsRemote"
        private const val KEY_DNS_DIRECT = "dnsDirect"
        private const val KEY_LANG = "lang"

        const val SPLIT_OFF = "off"
        const val SPLIT_INCLUDE = "include"
        const val SPLIT_EXCLUDE = "exclude"
    }

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /* ------------------------------------------------------------------ */
    /* Ключи                                                               */
    /* ------------------------------------------------------------------ */

    fun profiles(): List<Profile> {
        val raw = prefs.getString(KEY_PROFILES, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { fromJson(arr.getJSONObject(it)) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun saveProfiles(list: List<Profile>) {
        val arr = JSONArray()
        list.forEach { arr.put(toJson(it)) }
        prefs.edit().putString(KEY_PROFILES, arr.toString()).apply()
        // активный ключ мог исчезнуть вместе с подпиской
        if (list.none { it.id == activeId() }) {
            setActiveId(list.firstOrNull()?.id ?: "")
        }
    }

    /** Добавляет ключи, пропуская те, что уже есть. Возвращает число новых. */
    fun addProfiles(incoming: List<Profile>, source: String = "manual"): Int {
        val current = profiles().toMutableList()
        var added = 0
        for (p in incoming) {
            if (current.any { it.link == p.link }) continue
            current.add(p.copy(source = source))
            added++
        }
        if (added > 0) {
            saveProfiles(current)
            if (activeId().isEmpty()) setActiveId(current.first().id)
        }
        return added
    }

    fun removeProfile(id: String) {
        saveProfiles(profiles().filterNot { it.id == id })
    }

    fun activeId(): String = prefs.getString(KEY_ACTIVE, "") ?: ""

    fun setActiveId(id: String) {
        prefs.edit().putString(KEY_ACTIVE, id).apply()
    }

    fun activeProfile(): Profile? {
        val list = profiles()
        return list.firstOrNull { it.id == activeId() } ?: list.firstOrNull()
    }

    fun setProfileColor(id: String, color: String) {
        saveProfiles(profiles().map { if (it.id == id) it.copy(color = color) else it })
    }

    /* ------------------------------------------------------------------ */
    /* Правила                                                             */
    /* ------------------------------------------------------------------ */

    fun enabledModules(): Set<String> {
        val raw = prefs.getString(KEY_MODULES, null)
            ?: return RuleModules.ALL.filter { it.defaultOn }.map { it.key }.toSet()
        return raw.split(',').filter { it.isNotEmpty() }.toSet()
    }

    fun setModuleEnabled(key: String, on: Boolean) {
        val set = enabledModules().toMutableSet()
        if (on) set.add(key) else set.remove(key)
        prefs.edit().putString(KEY_MODULES, set.joinToString(",")).apply()
    }

    fun userRules(): List<UserRule> {
        val raw = prefs.getString(KEY_USER_RULES, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                UserRule(
                    pattern = o.optString("pattern"),
                    action = RuleAction.from(o.optString("action")),
                    enabled = o.optBoolean("enabled", true)
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun saveUserRules(list: List<UserRule>) {
        val arr = JSONArray()
        list.forEach {
            arr.put(
                JSONObject()
                    .put("pattern", it.pattern)
                    .put("action", it.action.code)
                    .put("enabled", it.enabled)
            )
        }
        prefs.edit().putString(KEY_USER_RULES, arr.toString()).apply()
    }

    /* ------------------------------------------------------------------ */
    /* Раздельное туннелирование                                           */
    /* ------------------------------------------------------------------ */

    fun splitMode(): String = prefs.getString(KEY_SPLIT_MODE, SPLIT_OFF) ?: SPLIT_OFF

    fun setSplitMode(mode: String) {
        prefs.edit().putString(KEY_SPLIT_MODE, mode).apply()
    }

    fun splitApps(): List<String> =
        prefs.getStringSet(KEY_SPLIT_APPS, emptySet())?.toList() ?: emptyList()

    fun setSplitApps(packages: Collection<String>) {
        prefs.edit().putStringSet(KEY_SPLIT_APPS, packages.toSet()).apply()
    }

    /* ------------------------------------------------------------------ */
    /* Прочие настройки                                                    */
    /* ------------------------------------------------------------------ */

    fun mtu(): Int = prefs.getInt(KEY_MTU, 1400)
    fun setMtu(value: Int) = prefs.edit().putInt(KEY_MTU, value).apply()

    fun ipv6(): Boolean = prefs.getBoolean(KEY_IPV6, true)
    fun setIpv6(value: Boolean) = prefs.edit().putBoolean(KEY_IPV6, value).apply()

    fun dnsRemote(): String = prefs.getString(KEY_DNS_REMOTE, "https://1.1.1.1/dns-query")!!
    fun setDnsRemote(value: String) = prefs.edit().putString(KEY_DNS_REMOTE, value).apply()

    fun dnsDirect(): String = prefs.getString(KEY_DNS_DIRECT, "1.1.1.1")!!
    fun setDnsDirect(value: String) = prefs.edit().putString(KEY_DNS_DIRECT, value).apply()

    /** "auto" | "ru" | "en" */
    fun language(): String = prefs.getString(KEY_LANG, "auto") ?: "auto"
    fun setLanguage(value: String) = prefs.edit().putString(KEY_LANG, value).apply()

    /** Всё, что влияет на конфигурацию ядра, одним объектом. */
    fun configOptions(): ConfigBuilder.Options = ConfigBuilder.Options(
        mtu = mtu(),
        ipv6 = ipv6(),
        dnsRemote = dnsRemote(),
        dnsDirect = dnsDirect(),
        enabledModules = enabledModules(),
        userRules = userRules()
    )

    /* ------------------------------------------------------------------ */
    /* Преобразование профиля                                              */
    /* ------------------------------------------------------------------ */

    private fun toJson(p: Profile): JSONObject {
        val o = JSONObject()
        o.put("id", p.id)
        o.put("type", p.type)
        o.put("name", p.name)
        o.put("server", p.server)
        o.put("port", p.port)
        o.put("uuid", p.uuid)
        o.put("password", p.password)
        o.put("method", p.method)
        o.put("flow", p.flow)
        o.put("alterId", p.alterId)
        o.put("security", p.security)
        o.put("obfsType", p.obfsType)
        o.put("obfsPassword", p.obfsPassword)
        o.put("link", p.link)
        o.put("color", p.color)
        o.put("source", p.source)
        p.tls?.let { o.put("tls", it.json) }
        p.transport?.let { o.put("transport", it.json) }
        return o
    }

    private fun fromJson(o: JSONObject): Profile? {
        val server = o.optString("server")
        if (server.isEmpty()) return null
        return Profile(
            id = o.optString("id"),
            type = o.optString("type"),
            name = o.optString("name"),
            server = server,
            port = o.optInt("port", 443),
            uuid = o.optString("uuid"),
            password = o.optString("password"),
            method = o.optString("method"),
            flow = o.optString("flow"),
            alterId = o.optInt("alterId", 0),
            security = o.optString("security"),
            tls = o.optJSONObject("tls")?.let { Tls(it) },
            transport = o.optJSONObject("transport")?.let { Transport(it) },
            obfsType = o.optString("obfsType"),
            obfsPassword = o.optString("obfsPassword"),
            link = o.optString("link"),
            color = o.optString("color"),
            source = o.optString("source", "manual")
        )
    }
}
