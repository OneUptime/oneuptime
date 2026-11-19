package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.collect.CpuSource
import com.oneuptime.androidagent.collect.CpuUnavailable
import com.oneuptime.androidagent.config.ConfigSource
import com.oneuptime.androidagent.dropbox.DropBoxState
import com.oneuptime.androidagent.logs.LogcatCollector
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.logsession.LogSessionStatus
import com.oneuptime.androidagent.logsession.LogSessionView
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.otlp.attributes
import com.oneuptime.androidagent.otlp.millisToNanos

/**
 * The records the agent sends about itself, so a device's Logs say what the
 * agent can and cannot see. They are telemetry, read in OneUptime by whoever
 * looks after the fleet, so they stay in English whatever the device's
 * language, as every other log line does (the agent's screen and
 * notification follow the device's language instead).
 */
object AgentEvents {
    const val GRANT_COMMAND: String = "adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS"

    // DropBox on Android 15 and later, where it asks for this instead of READ_LOGS.
    const val GRANT_DROPBOX_COMMAND: String = "adb shell pm grant com.oneuptime.androidagent android.permission.READ_DROPBOX_DATA"

    // Usage access, which DropBox asks for as well; the person at the device can also allow it in Settings.
    const val USAGE_ACCESS_COMMAND: String = "adb shell appops set com.oneuptime.androidagent GET_USAGE_STATS allow"

    // On a device no other device manager owns: what gives the agent the device's CPU use from Android 8.
    const val DEVICE_OWNER_COMMAND: String = "adb shell dpm set-device-owner com.oneuptime.androidagent/.admin.AgentDeviceAdminReceiver"

    fun started(
        nowMillis: Long,
        agentVersion: String,
        source: ConfigSource,
        logcat: LogcatState,
        dropBox: DropBoxState = DropBoxState.DISABLED,
    ): LogRecord =
        LogRecord(
            timeUnixNano = millisToNanos(nowMillis),
            observedTimeUnixNano = millisToNanos(nowMillis),
            severity = Severity.INFO,
            body = "OneUptime Android agent $agentVersion started. ${logcatSentence(logcat)} ${dropBoxSentence(dropBox)}",
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.started")
                    text("oneuptime.agent.config_source", source.name.lowercase())
                    text("oneuptime.agent.logcat", logcat.name.lowercase())
                    text("oneuptime.agent.dropbox", dropBox.name.lowercase())
                },
        )

    fun dropBoxChanged(nowMillis: Long, dropBox: DropBoxState): LogRecord =
        LogRecord(
            timeUnixNano = millisToNanos(nowMillis),
            observedTimeUnixNano = millisToNanos(nowMillis),
            severity = if (dropBox == DropBoxState.READING || dropBox == DropBoxState.DISABLED) Severity.INFO else Severity.WARN,
            body = dropBoxSentence(dropBox),
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.dropbox")
                    text("oneuptime.agent.dropbox", dropBox.name.lowercase())
                },
        )

    /** Where the device's CPU use comes from, or plainly why it has none. */
    fun cpu(
        nowMillis: Long,
        source: CpuSource,
        unavailable: CpuUnavailable?,
    ): LogRecord =
        LogRecord(
            timeUnixNano = millisToNanos(nowMillis),
            observedTimeUnixNano = millisToNanos(nowMillis),
            severity = Severity.INFO,
            body = cpuSentence(source, unavailable),
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.cpu")
                    text("oneuptime.agent.cpu", (unavailable?.name ?: source.name).lowercase())
                },
        )

    fun cpuSentence(
        source: CpuSource,
        unavailable: CpuUnavailable?,
    ): String =
        when {
            source == CpuSource.PROC_STAT -> "CPU use: read from /proc/stat."
            source == CpuSource.HARDWARE_PROPERTIES -> "CPU use: read as the device owner, from Android's hardware properties."
            unavailable == CpuUnavailable.NOT_SUPPORTED ->
                "CPU use is not available: this device reports none, even to its device owner."
            else ->
                "CPU use is not available: Android 8 and later give it only to the device owner app. " +
                    "On a device no other device manager owns, make the agent its owner: $DEVICE_OWNER_COMMAND"
        }

    /** A log session OneUptime asked for moved on: asked at the device, allowed, declined, ended. */
    fun logSession(nowMillis: Long, view: LogSessionView): LogRecord =
        LogRecord(
            timeUnixNano = millisToNanos(nowMillis),
            observedTimeUnixNano = millisToNanos(nowMillis),
            severity =
                when (view.status) {
                    LogSessionStatus.DECLINED, LogSessionStatus.UNAVAILABLE, LogSessionStatus.EXPIRED -> Severity.WARN
                    else -> Severity.INFO
                },
            body = logSessionSentence(view),
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.log_session")
                    text(LogcatCollector.LOG_SESSION_ATTRIBUTE, view.request.id)
                    text("oneuptime.agent.log_session.status", view.status.wire)
                    text("oneuptime.agent.log_session.requested_by", view.request.requestedBy)
                    int("oneuptime.agent.log_session.duration_minutes", view.request.durationMinutes.toLong())
                    text("oneuptime.agent.log_session.level", view.request.minimumLevel.name.lowercase())
                },
        )

    fun logSessionSentence(view: LogSessionView): String {
        val who: String = view.request.requestedBy?.let { " asked for by $it" } ?: ""
        val subject = "Log session$who"
        return when (view.status) {
            LogSessionStatus.REQUESTED, LogSessionStatus.AWAITING_APPROVAL ->
                "$subject: waiting for the person at the device to allow sending every app's logs for ${view.request.durationMinutes} minutes."
            LogSessionStatus.STARTING -> "$subject: allowed on the device; waiting for Android's prompt to be answered."
            LogSessionStatus.COLLECTING ->
                "$subject: sending every app's logs at ${view.request.minimumLevel.name.lowercase()} and above for ${view.request.durationMinutes} minutes."
            LogSessionStatus.CANCELLED -> "$subject: cancelled in OneUptime."
            else -> "$subject: ${view.status.wire.lowercase()}." + (view.reason?.let { " ${it.message}" } ?: "")
        }
    }

    fun dropBoxSentence(state: DropBoxState): String =
        when (state) {
            DropBoxState.DISABLED -> "DropBox is not read (logcat_enabled)."
            DropBoxState.NOT_GRANTED ->
                "DropBox: every app's crash stacks and the reasons the device rebooted need READ_LOGS (READ_DROPBOX_DATA on Android 15 and later): `$GRANT_COMMAND`, and `$GRANT_DROPBOX_COMMAND`."
            DropBoxState.NO_USAGE_ACCESS ->
                "DropBox: every app's crash stacks and the reasons the device rebooted need usage access as well: `$USAGE_ACCESS_COMMAND`, or allow it under Settings, Usage access."
            DropBoxState.READING -> "DropBox: every app's crashes with their stacks, native crashes, ANRs and the reasons the device rebooted."
        }

    fun logcatChanged(nowMillis: Long, logcat: LogcatState): LogRecord =
        LogRecord(
            timeUnixNano = millisToNanos(nowMillis),
            observedTimeUnixNano = millisToNanos(nowMillis),
            severity = if (logcat == LogcatState.NOT_GRANTED) Severity.WARN else Severity.INFO,
            body = logcatSentence(logcat),
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.logcat")
                    text("oneuptime.agent.logcat", logcat.name.lowercase())
                },
        )

    fun droppedBatches(nowMillis: Long, count: Long): LogRecord =
        LogRecord(
            timeUnixNano = millisToNanos(nowMillis),
            observedTimeUnixNano = millisToNanos(nowMillis),
            severity = Severity.WARN,
            body =
                "Dropped $count batches of telemetry: the device kept more than the agent stores while offline " +
                    "(20 MB, or 7 days), or OneUptime refused them.",
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.dropped")
                    int("oneuptime.agent.dropped_batches", count)
                },
        )

    fun logcatSentence(state: LogcatState): String =
        when (state) {
            LogcatState.DISABLED -> "Logcat collection is switched off (logcat_enabled)."
            LogcatState.NOT_GRANTED ->
                "Logcat collection is off: READ_LOGS has not been granted. Grant it with `$GRANT_COMMAND`, or through your device manager's remote ADB."
            LogcatState.CRASHES_AND_ANRS ->
                "Logcat: every app's crashes and ANRs. Android 13 and later show other apps' log lines only to an app on screen that the person at the device allows."
            LogcatState.FULL -> "Logcat: every app's log lines, and crashes and ANRs."
        }
}
