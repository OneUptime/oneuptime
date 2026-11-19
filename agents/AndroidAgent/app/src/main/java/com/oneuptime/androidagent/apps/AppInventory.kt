package com.oneuptime.androidagent.apps

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.config.KeyValueStore
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.otlp.attributes
import com.oneuptime.androidagent.otlp.millisToNanos
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/** One installed package, as PackageManager describes it. */
data class InstalledApp(
    val packageName: String,
    val versionName: String?,
    val versionCode: Long,
    // Part of the device's system image.
    val system: Boolean,
    // A system app that has been updated since: Chrome, WebView, Play services.
    val updatedSystem: Boolean,
    val enabled: Boolean,
    // The app that installed it: "com.android.vending" for Google Play, a device manager's package for its installs.
    val installer: String?,
    val firstInstallTimeMillis: Long,
    val lastUpdateTimeMillis: Long,
) {
    /**
     * Whether it is reported: every app installed on the device, and every
     * system app that has been updated. A system app that never changed is
     * part of the OS version the device already reports.
     */
    val isReported: Boolean get() = !system || updatedSystem

    val version: KnownVersion get() = KnownVersion(versionName, versionCode)
}

data class KnownVersion(val versionName: String?, val versionCode: Long) {
    override fun toString(): String = if (versionName.isNullOrBlank()) "($versionCode)" else "$versionName ($versionCode)"
}

sealed interface AppChange {
    data class Installed(val app: InstalledApp) : AppChange

    data class Updated(val app: InstalledApp, val before: KnownVersion?) : AppChange

    data class Removed(val packageName: String, val before: KnownVersion) : AppChange
}

/**
 * Reports what is installed on the device: each reported app once a day,
 * and each install, update and removal as it is noticed.
 *
 * Every app is its own log record, so the Logs page finds every device
 * still on an old version of an app with one filter:
 * `@event.name:android.package.inventory @android.package.name:com.example.kiosk`.
 */
class AppInventoryTracker(private val store: KeyValueStore, private val clock: Clock) {
    @Synchronized
    fun check(installed: List<InstalledApp>): List<LogRecord> {
        val now: Long = clock.nowMillis()
        val reported: List<InstalledApp> = installed.filter { it.isReported }.sortedBy { it.packageName }
        val known: Map<String, KnownVersion>? = store.getString(KEY_KNOWN)?.let { decode(it) }
        val lastSnapshot: Long? = store.getLong(KEY_LAST_SNAPSHOT_AT)

        val records: MutableList<LogRecord> = mutableListOf()
        if (known != null) {
            diff(known, reported).forEach { records.add(changeRecord(it, now)) }
        }
        val snapshotDue: Boolean = known == null || lastSnapshot == null || now - lastSnapshot >= SNAPSHOT_INTERVAL_MILLIS || now < lastSnapshot
        if (snapshotDue) {
            reported.forEach { records.add(inventoryRecord(it, now)) }
        }

        store.edit {
            putString(KEY_KNOWN, encode(reported.associate { it.packageName to it.version }))
            if (snapshotDue) {
                putLong(KEY_LAST_SNAPSHOT_AT, now)
            }
        }
        return records
    }

    companion object {
        const val SNAPSHOT_INTERVAL_MILLIS: Long = 24 * 60 * 60_000L
        private const val KEY_KNOWN: String = "apps.known"
        private const val KEY_LAST_SNAPSHOT_AT: String = "apps.last_snapshot_at"

        fun diff(known: Map<String, KnownVersion>, current: List<InstalledApp>): List<AppChange> {
            val changes: MutableList<AppChange> = mutableListOf()
            val currentNames: Set<String> = current.map { it.packageName }.toSet()
            current.forEach { app ->
                val before: KnownVersion? = known[app.packageName]
                when {
                    // A system app reported for the first time has just been updated, not installed.
                    before == null && app.updatedSystem -> changes.add(AppChange.Updated(app, null))
                    before == null -> changes.add(AppChange.Installed(app))
                    before.versionCode != app.versionCode || before.versionName != app.versionName ->
                        changes.add(AppChange.Updated(app, before))
                }
            }
            known.filterKeys { it !in currentNames }.toSortedMap().forEach { (name, before) ->
                changes.add(AppChange.Removed(name, before))
            }
            return changes
        }

        fun inventoryRecord(app: InstalledApp, nowMillis: Long): LogRecord =
            LogRecord(
                timeUnixNano = millisToNanos(nowMillis),
                observedTimeUnixNano = millisToNanos(nowMillis),
                severity = Severity.INFO,
                body = "${app.packageName} ${app.version}",
                attributes = appAttributes("android.package.inventory", app),
            )

        fun changeRecord(change: AppChange, nowMillis: Long): LogRecord {
            val (body: String, attrs) =
                when (change) {
                    is AppChange.Installed ->
                        Pair(
                            "Installed ${change.app.packageName} ${change.app.version}",
                            appAttributes("android.package.installed", change.app),
                        )
                    is AppChange.Updated ->
                        Pair(
                            change.before?.let { "Updated ${change.app.packageName} from $it to ${change.app.version}" }
                                ?: "Updated ${change.app.packageName} to ${change.app.version}",
                            appAttributes("android.package.updated", change.app) +
                                attributes {
                                    text("android.package.previous_version_name", change.before?.versionName)
                                    int("android.package.previous_version_code", change.before?.versionCode)
                                },
                        )
                    is AppChange.Removed ->
                        Pair(
                            "Removed ${change.packageName} ${change.before}",
                            attributes {
                                text("event.name", "android.package.removed")
                                text("android.package.name", change.packageName)
                                text("android.package.version_name", change.before.versionName)
                                int("android.package.version_code", change.before.versionCode)
                            },
                        )
                }
            return LogRecord(
                timeUnixNano = millisToNanos(nowMillis),
                observedTimeUnixNano = millisToNanos(nowMillis),
                severity = Severity.INFO,
                body = body,
                attributes = attrs,
            )
        }

        private fun appAttributes(eventName: String, app: InstalledApp) =
            attributes {
                text("event.name", eventName)
                text("android.package.name", app.packageName)
                text("android.package.version_name", app.versionName)
                int("android.package.version_code", app.versionCode)
                text("android.package.installer", app.installer)
                bool("android.package.system", app.system)
                bool("android.package.enabled", app.enabled)
                text("android.package.first_install_time", isoTime(app.firstInstallTimeMillis))
                text("android.package.last_update_time", isoTime(app.lastUpdateTimeMillis))
            }

        fun isoTime(millis: Long): String? {
            if (millis <= 0) {
                return null
            }
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT)
            format.timeZone = TimeZone.getTimeZone("UTC")
            return format.format(Date(millis))
        }

        fun encode(known: Map<String, KnownVersion>): String =
            buildJsonObject {
                known.toSortedMap().forEach { (name, version) ->
                    put(
                        name,
                        buildJsonArray {
                            add(JsonPrimitive(version.versionName))
                            add(JsonPrimitive(version.versionCode))
                        },
                    )
                }
            }.toString()

        /** The known versions, or an empty map when what was stored cannot be read. */
        fun decode(text: String): Map<String, KnownVersion> =
            try {
                val json: JsonObject = Json.parseToJsonElement(text).jsonObject
                json.mapNotNull { (name, value) ->
                    val pair: JsonArray = value.jsonArray
                    val versionName: String? = pair.getOrNull(0)?.jsonPrimitive?.takeIf { it.isString }?.content
                    val versionCode: Long = pair.getOrNull(1)?.jsonPrimitive?.longOrNull ?: return@mapNotNull null
                    name to KnownVersion(versionName, versionCode)
                }.toMap()
            } catch (_: Exception) {
                emptyMap()
            }
    }
}
