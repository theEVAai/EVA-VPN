package ai.theeva.vpn.core

/**
 * Правила маршрутизации: что идёт через туннель, что мимо, что режется.
 *
 * На компьютере человек выносит из туннеля программы по имени .exe.
 * На телефоне такого нет — приложения не файлы, а пакеты, и до половины
 * трафика идёт из системных служб. Поэтому здесь два уровня:
 *
 *   1. Готовые наборы (модули) — включаются тумблером, как на компьютере.
 *   2. Свои правила — человек вписывает адрес и выбирает, что с ним делать.
 *
 * Второе и заменяет список .exe. Чтобы это не превратилось в вид правил
 * из Clash, где надо знать разницу между DOMAIN-SUFFIX и DOMAIN-KEYWORD,
 * приложение само распознаёт, что именно введено, и объясняет это словами.
 */

/** Что делать с трафиком. Три действия — больше человеку не нужно. */
enum class RuleAction(val code: String) {
    /** Через VPN. Это поведение по умолчанию для всего остального. */
    PROXY("proxy"),

    /** Мимо VPN, напрямую через оператора. */
    DIRECT("direct"),

    /** Не пускать никуда. */
    REJECT("reject");

    companion object {
        fun from(code: String?): RuleAction =
            entries.firstOrNull { it.code == code } ?: PROXY
    }
}

/** Как понят введённый адрес. */
enum class PatternKind {
    DOMAIN_SUFFIX,
    DOMAIN_KEYWORD,
    IP_CIDR,
    PORT
}

/** Разобранный ввод: вид правила и объяснение обычными словами. */
data class Understood(
    val kind: PatternKind,
    /** Значение, очищенное от лишнего: схемы, пути, звёздочки. */
    val value: String,
    /** Что приложение поняло — показывается человеку под полем ввода. */
    val explanation: String
)

/** Правило, заведённое человеком. */
data class UserRule(
    val pattern: String,
    val action: RuleAction,
    val enabled: Boolean = true
)

object Patterns {

    private val IPV4_CIDR = Regex("""^\d{1,3}(\.\d{1,3}){3}(/\d{1,2})?$""")
    private val IPV6_CIDR = Regex("""^[0-9a-fA-F:]+(/\d{1,3})?$""")
    private val PORT_ONLY = Regex("""^\d{1,5}$""")

    /**
     * Понимает, что человек ввёл, и объясняет это словами.
     *
     * Принимает и полную ссылку, и домен, и адрес, и порт — из ссылки
     * берётся только имя узла: человек копирует из адресной строки браузера
     * вместе с https:// и хвостом, и это нормально.
     */
    /** Похоже на диапазон адресов: тогда «/24» — это маска, а не путь. */
    private fun looksLikeCidr(s: String): Boolean =
        IPV4_CIDR.matches(s) || (s.contains(':') && IPV6_CIDR.matches(s))

    fun understand(raw: String): Understood {
        var s = raw.trim().lowercase()

        // Звёздочку и точку в начале запоминаем: «*.local» — это домен
        // с поддоменами, даже если после очистки точки внутри не осталось.
        val explicitDomain = s.startsWith("*.") || s.startsWith(".")

        if (s.contains("://")) {
            // из ссылки оставляем только узел
            s = s.substringAfter("://").substringBefore('/').substringBefore('?').substringBefore('#')
        } else if (!looksLikeCidr(s)) {
            // у обычного ввода отрезаем путь; у диапазона адресов — нельзя,
            // иначе 10.8.0.0/24 молча превратится в один адрес 10.8.0.0/32
            s = s.substringBefore('/').substringBefore('?').substringBefore('#')
        }

        // хвост вида :443 у домена отрезаем, но только если это не голый порт
        if (s.count { it == ':' } == 1 && !s.startsWith("[")) {
            val maybePort = s.substringAfterLast(':')
            if (PORT_ONLY.matches(maybePort) && s.substringBeforeLast(':').isNotEmpty()) {
                s = s.substringBeforeLast(':')
            }
        }
        s = s.removePrefix("*.").removePrefix(".").trim()

        if (explicitDomain && s.isNotEmpty() && !looksLikeCidr(s)) {
            return Understood(
                PatternKind.DOMAIN_SUFFIX, s,
                "Домен $s и все его поддомены"
            )
        }

        return when {
            s.isEmpty() ->
                Understood(PatternKind.DOMAIN_SUFFIX, "", "Пусто — введите адрес")

            PORT_ONLY.matches(s) && s.toIntOrNull()?.let { it in 1..65535 } == true ->
                Understood(
                    PatternKind.PORT, s,
                    "Всё, что идёт на порт $s, независимо от адреса"
                )

            IPV4_CIDR.matches(s) -> {
                val withMask = if (s.contains('/')) s else "$s/32"
                val human = if (s.contains('/')) "Диапазон адресов $s" else "Один адрес $s"
                Understood(PatternKind.IP_CIDR, withMask, human)
            }

            s.contains(':') && IPV6_CIDR.matches(s) -> {
                val withMask = if (s.contains('/')) s else "$s/128"
                Understood(PatternKind.IP_CIDR, withMask, "Адрес IPv6 $s")
            }

            s.contains('.') ->
                Understood(
                    PatternKind.DOMAIN_SUFFIX, s,
                    "Домен $s и все его поддомены"
                )

            else ->
                Understood(
                    PatternKind.DOMAIN_KEYWORD, s,
                    "Любой адрес, в котором встречается «$s»"
                )
        }
    }

    /** Человеческое название действия — для списка правил. */
    fun actionTitle(action: RuleAction): String = when (action) {
        RuleAction.PROXY -> "Через VPN"
        RuleAction.DIRECT -> "Мимо VPN"
        RuleAction.REJECT -> "Заблокировать"
    }

    /** Пояснение к действию — одной строкой, без терминов. */
    fun actionHint(action: RuleAction): String = when (action) {
        RuleAction.PROXY -> "Идёт через туннель, как всё остальное"
        RuleAction.DIRECT -> "Идёт напрямую через оператора, ваш настоящий адрес"
        RuleAction.REJECT -> "Не открывается вообще: соединение обрывается"
    }
}

/** Готовый набор правил, включаемый тумблером. */
data class RuleModule(
    val key: String,
    val title: String,
    val hint: String,
    val action: RuleAction,
    val suffixes: List<String> = emptyList(),
    val domains: List<String> = emptyList(),
    /** Распознавание по содержимому пакетов: сейчас только bittorrent. */
    val protocols: List<String> = emptyList(),
    val defaultOn: Boolean,
    /** Пометка вроде «обязательно включить». */
    val badge: String? = null
)

object RuleModules {

    val ALL: List<RuleModule> = listOf(
        RuleModule(
            key = "blockTrackers",
            title = "Трекеры и метрики",
            hint = "Яндекс.Метрика, Google Analytics, Meta Pixel и ещё три десятка счётчиков",
            action = RuleAction.REJECT,
            domains = RuleLists.TRACKERS,
            defaultOn = true
        ),
        RuleModule(
            key = "ruDirect",
            title = "Российские сайты мимо VPN",
            hint = ".ru, .su, .рф, банки, госуслуги, маркетплейсы — быстрее и без блокировок за иностранный адрес",
            action = RuleAction.DIRECT,
            suffixes = RuleLists.RU_SUFFIX,
            domains = RuleLists.RU_DIRECT,
            defaultOn = true
        ),
        RuleModule(
            key = "kodikDirect",
            title = "Починить Kodik",
            hint = "Плеер аниме и фильмов не отдаёт видео через прокси — пускаем напрямую",
            action = RuleAction.DIRECT,
            domains = RuleLists.KODIK,
            defaultOn = true
        ),
        RuleModule(
            key = "torrentDirect",
            title = "Торренты мимо VPN",
            hint = "Раздача и закачка идут напрямую. Разгружает туннель, но ваш настоящий адрес виден участникам раздачи",
            action = RuleAction.DIRECT,
            protocols = listOf("bittorrent"),
            defaultOn = false
        ),
        RuleModule(
            key = "appleDirect",
            title = "App Store мимо VPN",
            hint = "Apple обрывает загрузки через прокси: магазин виснет на «Ожидание», обновления не докачиваются",
            action = RuleAction.DIRECT,
            domains = RuleLists.APPLE,
            defaultOn = true,
            badge = "обязательно включить"
        )
    )

    fun byKey(key: String): RuleModule? = ALL.firstOrNull { it.key == key }
}
