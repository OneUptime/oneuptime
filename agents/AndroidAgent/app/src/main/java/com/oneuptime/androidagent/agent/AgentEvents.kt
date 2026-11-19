package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.config.ConfigSource
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.otlp.attributes
import com.oneuptime.androidagent.otlp.millisToNanos

/** The records the agent sends about itself, so a device's Logs say what the agent can and cannot see. */
object AgentEvents {
    const val GRANT_COMMAND: String = "adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS"

    fun started(nowMillis: Long, agentVersion: String, source: ConfigSource, logcat: LogcatState): LogRecord =
        LogRecord(
            timeUnixNano = millisToNanos(nowMillis),
            observedTimeUnixNano = millisToNanos(nowMillis),
            severity = Severity.INFO,
            body = "OneUptime Android agent $agentVersion started. ${logcatSentence(logcat)}",
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.started")
                    text("oneuptime.agent.config_source", source.name.lowercase())
                    text("oneuptime.agent.logcat", logcat.name.lowercase())
                },
        )

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
