package com.oneuptime.androidagent.logsession

import com.oneuptime.androidagent.config.LogcatLevel

/**
 * Where a log session is. The names are OneUptime's (HostLogSessionStatus):
 * the agent and the server read the same words.
 */
enum class LogSessionStatus(val wire: String) {
    // Asked for in OneUptime; the device has not answered yet.
    REQUESTED("Requested"),

    // The device has it, and waits for the person at the device to allow it.
    AWAITING_APPROVAL("AwaitingApproval"),

    // Allowed in the agent; waiting for Android's own prompt to be answered (Android 13 and later).
    STARTING("Starting"),

    // Sending every app's logs, until its time is up.
    COLLECTING("Collecting"),

    // Not allowed, in the agent or in Android's prompt.
    DECLINED("Declined"),

    // Ran its time, was stopped at the device, or ended when the agent or the device restarted.
    ENDED("Ended"),

    // Called off in OneUptime.
    CANCELLED("Cancelled"),

    // Nobody at the device answered before the request ran out.
    EXPIRED("Expired"),

    // This device cannot: READ_LOGS is not granted, or Logcat is switched off.
    UNAVAILABLE("Unavailable"),
    ;

    val isActive: Boolean get() = this == REQUESTED || this == AWAITING_APPROVAL || this == STARTING || this == COLLECTING

    companion object {
        fun parse(text: String?): LogSessionStatus? = entries.firstOrNull { it.wire.equals(text?.trim(), ignoreCase = true) }
    }
}

/** A log session as OneUptime sends it: who asked, for how long and at what level. */
data class LogSessionRequest(
    val id: String,
    val status: LogSessionStatus,
    // How long to send for once allowed.
    val durationMinutes: Int,
    // Info, Debug or Verbose: a troubleshooting session is never quieter than Info.
    val minimumLevel: LogcatLevel,
    val requestedAtMillis: Long?,
    // The name of the OneUptime user who asked.
    val requestedBy: String?,
    // Until when someone at the device can allow it.
    val expiresAtMillis: Long?,
    // Why they ask, in their words: one line of plain text, shown under the request (LogSessionNote).
    val note: String? = null,
)

/** What the device tells OneUptime about a session. */
data class LogSessionReport(
    val id: String,
    val status: LogSessionStatus,
    // In the agent's words, for OneUptime to show: why it was declined, ended or unavailable.
    val message: String?,
    val startedAtMillis: Long?,
    val endsAtMillis: Long?,
)

/** Why this device cannot send a session's logs. */
enum class LogSessionUnavailable {
    // logcat_enabled is false: the device manager switched Logcat off.
    LOGCAT_DISABLED,

    // READ_LOGS has not been granted.
    NOT_GRANTED,
}

/**
 * The Logcat a session reads: a `logcat` process of its own, at its level,
 * from the moment it starts (LogcatCollector). An interface so the manager
 * is tested without a device.
 */
interface SessionLogcat {
    /** Why it cannot run here, or null when it can. */
    fun unavailable(): LogSessionUnavailable?

    /** Starts reading every app's lines at [level], each record tagged with [sessionId]. Must run while the agent is on screen on Android 13+. */
    fun start(sessionId: String, level: LogcatLevel)

    fun stop()

    val isRunning: Boolean

    /** When a line from another app was last read, in elapsed-realtime milliseconds, or null: Android allowed it once one arrives. */
    val lastOtherAppLineElapsedMillis: Long?
}
