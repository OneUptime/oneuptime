package com.oneuptime.androidagent.logsession

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.config.OtlpEndpoint
import com.oneuptime.androidagent.transport.JsonTransport
import com.oneuptime.androidagent.transport.TransportResult
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/** What one exchange with OneUptime came to. */
sealed interface LogSessionExchange {
    data class Answered(val sessions: List<LogSessionRequest>) : LogSessionExchange

    // This OneUptime has no log sessions (an older version): ask again much later.
    data object NotSupported : LogSessionExchange

    data class Failed(val reason: String) : LogSessionExchange
}

/** What the device says about itself in each exchange. */
data class LogSessionDevice(
    val hostName: String,
    val apiLevel: Int,
    val agentVersion: String,
    // READ_LOGS granted and Logcat on: whether a session could run here.
    val canSendLogs: Boolean,
)

/**
 * Asks OneUptime for the log sessions waiting for this device, and tells it
 * what became of the ones it has: one small JSON POST, with the device's
 * Server ingestion key, to `/telemetry/android-agent/v1/log-sessions` on the
 * same OneUptime the telemetry goes to. OneUptime finds the device's host by
 * its name (host.name) in the key's project.
 */
class LogSessionClient(
    private val transport: JsonTransport,
    private val clock: Clock,
) {
    private var notSupportedUntilElapsed: Long? = null

    /** Whether to skip this cycle's exchange: OneUptime said it has no log sessions, not long ago. */
    @Synchronized
    fun isPaused(): Boolean {
        val until: Long = notSupportedUntilElapsed ?: return false
        if (clock.elapsedRealtimeMillis() >= until) {
            notSupportedUntilElapsed = null
            return false
        }
        return true
    }

    fun exchange(
        endpoint: OtlpEndpoint,
        token: String,
        device: LogSessionDevice,
        reports: List<LogSessionReport>,
    ): LogSessionExchange {
        val url: String = urlFor(endpoint)
        val body: String = requestJson(device, reports).toString()
        return when (val result: TransportResult = transport.postJson(url, token, body)) {
            is TransportResult.Unreachable -> LogSessionExchange.Failed(result.reason)
            is TransportResult.Answered ->
                when {
                    result.status in 200..299 -> LogSessionExchange.Answered(parseSessions(result.body))
                    // An OneUptime from before log sessions answers 404: ask again in an hour, not every minute.
                    result.status == 404 || result.status == 405 -> {
                        synchronized(this) { notSupportedUntilElapsed = clock.elapsedRealtimeMillis() + NOT_SUPPORTED_PAUSE_MILLIS }
                        LogSessionExchange.NotSupported
                    }
                    else -> LogSessionExchange.Failed("HTTP ${result.status}")
                }
        }
    }

    companion object {
        const val PATH: String = "/telemetry/android-agent/v1/log-sessions"
        const val NOT_SUPPORTED_PAUSE_MILLIS: Long = 60 * 60_000

        /** The endpoint beside OTLP's: `https://oneuptime.com/otlp` is `https://oneuptime.com/telemetry/...`. */
        fun urlFor(endpoint: OtlpEndpoint): String = endpoint.base.removeSuffix("/otlp") + PATH

        fun requestJson(device: LogSessionDevice, reports: List<LogSessionReport>): JsonObject =
            buildJsonObject {
                put("hostName", device.hostName)
                put("androidApiLevel", device.apiLevel)
                put("agentVersion", device.agentVersion)
                put("canSendLogs", device.canSendLogs)
                put(
                    "sessions",
                    buildJsonArray {
                        reports.forEach { report ->
                            add(
                                buildJsonObject {
                                    put("id", report.id)
                                    put("status", report.status.wire)
                                    report.message?.let { put("statusMessage", it) }
                                    report.startedAtMillis?.let { put("startedAt", IsoTime.format(it)) }
                                    report.endsAtMillis?.let { put("endsAt", IsoTime.format(it)) }
                                },
                            )
                        }
                    },
                )
            }

        /** The sessions in OneUptime's answer; one that cannot be read is left out. */
        fun parseSessions(body: String): List<LogSessionRequest> {
            val root: JsonObject =
                try {
                    Json.parseToJsonElement(body) as? JsonObject ?: return emptyList()
                } catch (_: SerializationException) {
                    return emptyList()
                } catch (_: IllegalArgumentException) {
                    return emptyList()
                }
            val sessions: JsonArray = (root["sessions"] as? JsonArray) ?: return emptyList()
            return sessions.mapNotNull { element -> parseSession(element) }
        }

        private fun parseSession(element: JsonElement): LogSessionRequest? {
            val item: JsonObject = element as? JsonObject ?: return null
            val id: String = item.text("id")?.takeIf { it.isNotBlank() && it.length <= 64 } ?: return null
            val status: LogSessionStatus = LogSessionStatus.parse(item.text("status")) ?: return null
            val duration: Int = (item["durationMinutes"] as? JsonPrimitive)?.intOrNull ?: return null
            // A session reads Info and above at the least: quieter than that, nothing shows whether Android allowed it.
            val level: LogcatLevel =
                when (LogcatLevel.parse(item.text("minimumLevel"))) {
                    LogcatLevel.VERBOSE -> LogcatLevel.VERBOSE
                    LogcatLevel.DEBUG -> LogcatLevel.DEBUG
                    else -> LogcatLevel.INFO
                }
            return LogSessionRequest(
                id = id,
                status = status,
                durationMinutes = duration.coerceIn(1, LogSessionManager.MAX_DURATION_MINUTES),
                minimumLevel = level,
                requestedAtMillis = item.time("requestedAt"),
                requestedBy = item.text("requestedByName")?.trim()?.take(120)?.takeIf { it.isNotEmpty() },
                expiresAtMillis = item.time("expiresAt"),
                // Why they ask (#9966): read as anything from the network is, and shown only as one line.
                note = LogSessionNote.clean(item.text("note")),
            )
        }

        private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

        private fun JsonObject.time(key: String): Long? = IsoTime.parse(text(key))
    }
}
