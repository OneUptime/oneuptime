package com.oneuptime.androidagent.config

import java.util.Locale

/**
 * The keys of the agent's managed configuration, as res/xml/app_restrictions.xml
 * declares them for device managers (Esper, Intune, Workspace ONE, SOTI, any
 * EMM that speaks Android managed configurations).
 */
object ManagedConfigKeys {
    const val ONEUPTIME_URL: String = "oneuptime_url"
    const val ONEUPTIME_TOKEN: String = "oneuptime_token"
    const val DEVICE_NAME: String = "device_name"
    const val DEVICE_SERIAL: String = "device_serial"
    const val DEVICE_TYPE: String = "device_type"
    const val DEVICE_LOCATION: String = "device_location"
    const val LABELS: String = "labels"
    const val COLLECTION_INTERVAL_SECONDS: String = "collection_interval_seconds"
    const val LOGCAT_ENABLED: String = "logcat_enabled"
    const val LOGCAT_MIN_LEVEL: String = "logcat_min_level"
    const val INSTALLED_APPS_ENABLED: String = "installed_apps_enabled"

    val ALL: List<String> =
        listOf(
            ONEUPTIME_URL,
            ONEUPTIME_TOKEN,
            DEVICE_NAME,
            DEVICE_SERIAL,
            DEVICE_TYPE,
            DEVICE_LOCATION,
            LABELS,
            COLLECTION_INTERVAL_SECONDS,
            LOGCAT_ENABLED,
            LOGCAT_MIN_LEVEL,
            INSTALLED_APPS_ENABLED,
        )
}

/** The lowest Logcat priority the agent sends. */
enum class LogcatLevel(val letter: Char) {
    VERBOSE('V'),
    DEBUG('D'),
    INFO('I'),
    WARN('W'),
    ERROR('E'),
    FATAL('F'),
    ;

    companion object {
        fun parse(text: String?): LogcatLevel? =
            when (text?.trim()?.lowercase(Locale.ROOT)) {
                "v", "verbose" -> VERBOSE
                "d", "debug" -> DEBUG
                "i", "info" -> INFO
                "w", "warn", "warning" -> WARN
                "e", "error" -> ERROR
                "f", "fatal", "a", "assert" -> FATAL
                else -> null
            }
    }
}

/** Something wrong with a setting, kept so the setup screen can say what. */
data class ConfigProblem(val key: String, val kind: Kind, val detail: String = "") {
    enum class Kind {
        // A device manager sent "${esper.deviceName}" as it is: its agent did not fill it in.
        UNRESOLVED_PLACEHOLDER,

        // The value cannot be used, and the setting falls back to its default.
        INVALID,
    }
}

/**
 * What the device manager set, every field null when it set nothing for it.
 * `presentKeys` are the settings it set, so the setup screen can show them
 * as set by the organization.
 */
data class ManagedSettings(
    val oneUptimeUrl: String? = null,
    val token: String? = null,
    val deviceName: String? = null,
    val deviceSerial: String? = null,
    val deviceType: String? = null,
    val deviceLocation: String? = null,
    val labels: Map<String, String>? = null,
    val collectionIntervalSeconds: Int? = null,
    val logcatEnabled: Boolean? = null,
    val logcatMinLevel: LogcatLevel? = null,
    val installedAppsEnabled: Boolean? = null,
    val presentKeys: Set<String> = emptySet(),
    val problems: List<ConfigProblem> = emptyList(),
) {
    companion object {
        val NONE: ManagedSettings = ManagedSettings()
    }
}

/**
 * Reads a managed configuration bundle, given as a map so it is read the same
 * way in a unit test as on a device.
 *
 * Device managers differ in how they send a value: an integer may arrive as
 * an Int or as the text "60", a switch as a Boolean or "true". Each is read
 * either way. A value that cannot be used is left out (its setting falls
 * back) and reported in `problems`.
 */
object ManagedConfigParser {
    const val MIN_INTERVAL_SECONDS: Int = 30
    const val MAX_INTERVAL_SECONDS: Int = 600

    private val PLACEHOLDER: Regex = Regex("""\$\{[^}]*}""")

    fun parse(values: Map<String, Any?>): ManagedSettings {
        val problems: MutableList<ConfigProblem> = mutableListOf()
        val present: MutableSet<String> = mutableSetOf()

        fun text(key: String): String? {
            val raw: Any = values[key] ?: return null
            val value: String = raw.toString().trim()
            if (value.isEmpty()) {
                return null
            }
            if (PLACEHOLDER.containsMatchIn(value)) {
                problems.add(ConfigProblem(key, ConfigProblem.Kind.UNRESOLVED_PLACEHOLDER, value))
                return null
            }
            present.add(key)
            return value
        }

        fun bool(key: String): Boolean? {
            val raw: Any = values[key] ?: return null
            val value: Boolean? =
                when (raw) {
                    is Boolean -> raw
                    is String ->
                        when (raw.trim().lowercase(Locale.ROOT)) {
                            "true", "1", "yes", "on" -> true
                            "false", "0", "no", "off" -> false
                            "" -> return null
                            else -> null
                        }
                    is Number -> raw.toInt() != 0
                    else -> null
                }
            if (value == null) {
                problems.add(ConfigProblem(key, ConfigProblem.Kind.INVALID, raw.toString()))
            } else {
                present.add(key)
            }
            return value
        }

        val interval: Int? =
            values[ManagedConfigKeys.COLLECTION_INTERVAL_SECONDS]?.let { raw ->
                val number: Int? =
                    when (raw) {
                        is Number -> raw.toInt()
                        is String -> raw.trim().takeIf { it.isNotEmpty() }?.toIntOrNull()
                        else -> null
                    }
                when {
                    raw is String && raw.isBlank() -> null
                    number == null || number <= 0 -> {
                        problems.add(
                            ConfigProblem(ManagedConfigKeys.COLLECTION_INTERVAL_SECONDS, ConfigProblem.Kind.INVALID, raw.toString()),
                        )
                        null
                    }
                    else -> {
                        present.add(ManagedConfigKeys.COLLECTION_INTERVAL_SECONDS)
                        number.coerceIn(MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS)
                    }
                }
            }

        val level: LogcatLevel? =
            text(ManagedConfigKeys.LOGCAT_MIN_LEVEL)?.let { raw ->
                LogcatLevel.parse(raw).also {
                    if (it == null) {
                        present.remove(ManagedConfigKeys.LOGCAT_MIN_LEVEL)
                        problems.add(ConfigProblem(ManagedConfigKeys.LOGCAT_MIN_LEVEL, ConfigProblem.Kind.INVALID, raw))
                    }
                }
            }

        val labels: Map<String, String>? =
            text(ManagedConfigKeys.LABELS)?.let { raw ->
                val result: LabelParser.Result = LabelParser.parse(raw)
                result.rejected.forEach { pair ->
                    problems.add(ConfigProblem(ManagedConfigKeys.LABELS, ConfigProblem.Kind.INVALID, pair))
                }
                result.labels
            }

        return ManagedSettings(
            oneUptimeUrl = text(ManagedConfigKeys.ONEUPTIME_URL),
            token = text(ManagedConfigKeys.ONEUPTIME_TOKEN),
            deviceName = text(ManagedConfigKeys.DEVICE_NAME),
            deviceSerial = text(ManagedConfigKeys.DEVICE_SERIAL),
            deviceType = text(ManagedConfigKeys.DEVICE_TYPE),
            deviceLocation = text(ManagedConfigKeys.DEVICE_LOCATION),
            labels = labels,
            collectionIntervalSeconds = interval,
            logcatEnabled = bool(ManagedConfigKeys.LOGCAT_ENABLED),
            logcatMinLevel = level,
            installedAppsEnabled = bool(ManagedConfigKeys.INSTALLED_APPS_ENABLED),
            presentKeys = present,
            problems = problems,
        )
    }
}
