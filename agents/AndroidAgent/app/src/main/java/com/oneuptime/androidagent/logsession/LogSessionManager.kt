package com.oneuptime.androidagent.logsession

import com.oneuptime.androidagent.Clock

/** A session as the device holds it, and what the screen shows of it. */
data class LogSessionView(
    val request: LogSessionRequest,
    val status: LogSessionStatus,
    // Why it was declined, ended or is unavailable, in the agent's words.
    val reason: LogSessionReason?,
    val startedAtMillis: Long?,
    val endsAtMillis: Long?,
)

/** Why a session is where it is: each is a sentence on the agent's screen and in OneUptime. */
enum class LogSessionReason(val message: String) {
    DECLINED_IN_AGENT("Declined on the device."),
    DECLINED_BY_ANDROID("Android's prompt to allow access to all device logs was declined."),
    NO_ANSWER_FROM_ANDROID("Nobody answered Android's prompt to allow access to all device logs."),
    TIME_UP("Sent every app's logs for the time asked."),
    STOPPED_ON_DEVICE("Stopped on the device."),
    AGENT_RESTARTED("The agent or the device restarted, and Android's permission to read all device logs ended with it."),
    LOGCAT_STOPPED("Logcat stopped reading before the time was up."),
    LOGCAT_DISABLED("Logcat is switched off on this device (logcat_enabled)."),
    NOT_GRANTED("READ_LOGS has not been granted on this device."),
    REQUEST_EXPIRED("Nobody at the device allowed it in time."),
}

/**
 * The log sessions OneUptime asks a device for: every app's Logcat lines for
 * a while, for troubleshooting, allowed by the person at the device.
 *
 * Android 13 and later show other apps' lines only to an app that is on
 * screen when it starts reading, after the person at the device allows it in
 * Android's own prompt (LogcatManagerService), and keep that permission only
 * for the `logcat` process it was given to. So a session runs like this:
 *
 *   1. OneUptime asks; the agent's next poll fetches it (LogSessionClient),
 *      shows a notification, and its screen shows the request.
 *   2. The person taps Allow on the agent's screen. The agent starts a
 *      `logcat` of its own at once, while its screen is in front, and
 *      Android shows "Allow access to all device logs?".
 *   3. Lines from other apps arriving say Android allowed it: the session
 *      sends every app's lines until its time is up, then stops. None
 *      arriving after the person is back on the agent's screen say Android
 *      did not.
 *
 * On Android 12 and earlier Android asks nothing, and the session runs as
 * soon as it is allowed on the agent's screen. Whatever happens is reported
 * back on the next poll, and OneUptime's audit log keeps who asked and when.
 *
 * In memory only: Android's permission does not outlive the agent's process,
 * so after a restart a session OneUptime still thinks is running is reported
 * ended, and one still waiting is shown again.
 */
class LogSessionManager(
    private val clock: Clock,
    private val sdkInt: Int,
    private val logcat: SessionLogcat,
    private val onNewRequest: (LogSessionRequest) -> Unit = {},
    private val onChanged: (LogSessionView) -> Unit = {},
) {
    private class Local(
        var request: LogSessionRequest,
        var status: LogSessionStatus,
        var reason: LogSessionReason? = null,
        var startedAtMillis: Long? = null,
        var endsAtMillis: Long? = null,
        var startedElapsed: Long? = null,
        var resumedElapsed: Long? = null,
        var reportPending: Boolean = true,
        var finishedElapsed: Long? = null,
    )

    private val sessions: LinkedHashMap<String, Local> = linkedMapOf()

    /** Merges the sessions OneUptime says are open for this device. */
    @Synchronized
    fun onServerSessions(requests: List<LogSessionRequest>) {
        val seen: MutableSet<String> = mutableSetOf()
        for (request in requests) {
            seen.add(request.id)
            val local: Local? = sessions[request.id]
            if (local == null) {
                when (request.status) {
                    LogSessionStatus.REQUESTED, LogSessionStatus.AWAITING_APPROVAL -> {
                        val unavailable: LogSessionUnavailable? = logcat.unavailable()
                        if (unavailable != null) {
                            sessions[request.id] = Local(request, LogSessionStatus.UNAVAILABLE, reasonFor(unavailable)).also { finish(it) }
                        } else {
                            val local = Local(request, LogSessionStatus.AWAITING_APPROVAL)
                            sessions[request.id] = local
                            changed(local)
                            onNewRequest(request)
                        }
                    }
                    // OneUptime thinks it is running, and this process never started it: it ended with the last one.
                    LogSessionStatus.STARTING, LogSessionStatus.COLLECTING ->
                        sessions[request.id] = Local(request, LogSessionStatus.ENDED, LogSessionReason.AGENT_RESTARTED).also { finish(it) }
                    else -> Unit
                }
                continue
            }
            local.request = request.copy(status = local.request.status)
            if (request.status == LogSessionStatus.CANCELLED && local.status.isActive) {
                if (local.status == LogSessionStatus.STARTING || local.status == LogSessionStatus.COLLECTING) {
                    logcat.stop()
                }
                local.status = LogSessionStatus.CANCELLED
                local.reason = null
                // OneUptime cancelled it itself: nothing to tell it.
                local.reportPending = false
                local.finishedElapsed = clock.elapsedRealtimeMillis()
                changed(local)
            }
        }
        // A session OneUptime no longer lists, and that is over and reported, is forgotten.
        sessions.entries.removeAll { (id, local) -> id !in seen && !local.status.isActive && !local.reportPending }
    }

    /** The person at the device allowed it on the agent's screen. Call while the screen is in front. */
    @Synchronized
    fun allow(id: String): LogSessionView? {
        val local: Local = sessions[id] ?: return null
        if (local.status != LogSessionStatus.AWAITING_APPROVAL) {
            return view(local)
        }
        logcat.unavailable()?.let { unavailable ->
            local.status = LogSessionStatus.UNAVAILABLE
            local.reason = reasonFor(unavailable)
            finish(local)
            return view(local)
        }
        // One session at a time: a second one allowed replaces the first.
        sessions.values.filter { it !== local && (it.status == LogSessionStatus.STARTING || it.status == LogSessionStatus.COLLECTING) }.forEach {
            it.status = LogSessionStatus.ENDED
            it.reason = LogSessionReason.STOPPED_ON_DEVICE
            finish(it)
        }
        logcat.start(local.request.id, local.request.minimumLevel)
        val now: Long = clock.nowMillis()
        local.startedElapsed = clock.elapsedRealtimeMillis()
        local.resumedElapsed = null
        local.startedAtMillis = now
        local.endsAtMillis = now + local.request.durationMinutes.coerceIn(1, MAX_DURATION_MINUTES) * 60_000L
        local.status = if (sdkInt >= ANDROID_13) LogSessionStatus.STARTING else LogSessionStatus.COLLECTING
        local.reportPending = true
        changed(local)
        return view(local)
    }

    /** The person at the device declined it on the agent's screen. */
    @Synchronized
    fun decline(id: String): LogSessionView? {
        val local: Local = sessions[id] ?: return null
        if (local.status == LogSessionStatus.AWAITING_APPROVAL) {
            local.status = LogSessionStatus.DECLINED
            local.reason = LogSessionReason.DECLINED_IN_AGENT
            finish(local)
        }
        return view(local)
    }

    /** Stopped on the agent's screen. */
    @Synchronized
    fun stop(id: String): LogSessionView? {
        val local: Local = sessions[id] ?: return null
        if (local.status == LogSessionStatus.STARTING || local.status == LogSessionStatus.COLLECTING) {
            logcat.stop()
            local.status = LogSessionStatus.ENDED
            local.reason = LogSessionReason.STOPPED_ON_DEVICE
            finish(local)
        }
        return view(local)
    }

    /**
     * The agent's screen is in front again: after Android's prompt closed,
     * when one was shown. Lines from other apps not arriving soon after
     * this say Android's prompt was declined.
     */
    @Synchronized
    fun onScreenResumed() {
        val elapsed: Long = clock.elapsedRealtimeMillis()
        sessions.values.filter { it.status == LogSessionStatus.STARTING }.forEach { local ->
            val started: Long = local.startedElapsed ?: return@forEach
            if (elapsed - started >= PROMPT_SHOWN_AFTER_MILLIS) {
                local.resumedElapsed = elapsed
            }
        }
    }

    /** Moves sessions on with time: an answer from Android, a session whose time is up, a request no one answered. */
    @Synchronized
    fun tick() {
        val elapsed: Long = clock.elapsedRealtimeMillis()
        val now: Long = clock.nowMillis()
        for (local in sessions.values) {
            when (local.status) {
                LogSessionStatus.STARTING -> {
                    val started: Long = local.startedElapsed ?: elapsed
                    val otherApps: Long? = logcat.lastOtherAppLineElapsedMillis
                    when {
                        otherApps != null && otherApps >= started -> {
                            local.status = LogSessionStatus.COLLECTING
                            local.reportPending = true
                            changed(local)
                        }
                        local.resumedElapsed != null && elapsed - local.resumedElapsed!! >= ANSWER_WAIT_MILLIS -> {
                            logcat.stop()
                            local.status = LogSessionStatus.DECLINED
                            local.reason = LogSessionReason.DECLINED_BY_ANDROID
                            finish(local)
                        }
                        elapsed - started >= PROMPT_TIMEOUT_MILLIS -> {
                            logcat.stop()
                            local.status = LogSessionStatus.DECLINED
                            local.reason = LogSessionReason.NO_ANSWER_FROM_ANDROID
                            finish(local)
                        }
                    }
                }
                LogSessionStatus.COLLECTING -> {
                    val endsAt: Long = local.endsAtMillis ?: now
                    val startedElapsed: Long = local.startedElapsed ?: elapsed
                    val durationMillis: Long = endsAt - (local.startedAtMillis ?: now)
                    when {
                        // Elapsed time, not the wall clock: a clock changed during the session neither shortens nor stretches it.
                        elapsed - startedElapsed >= durationMillis -> {
                            logcat.stop()
                            local.status = LogSessionStatus.ENDED
                            local.reason = LogSessionReason.TIME_UP
                            finish(local)
                        }
                        !logcat.isRunning -> {
                            local.status = LogSessionStatus.ENDED
                            local.reason = LogSessionReason.LOGCAT_STOPPED
                            finish(local)
                        }
                    }
                }
                LogSessionStatus.AWAITING_APPROVAL -> {
                    val expires: Long? = local.request.expiresAtMillis
                    if (expires != null && now >= expires) {
                        local.status = LogSessionStatus.EXPIRED
                        local.reason = LogSessionReason.REQUEST_EXPIRED
                        finish(local)
                    }
                }
                else -> Unit
            }
        }
    }

    /** What OneUptime has not been told yet. */
    @Synchronized
    fun reportsToSend(): List<LogSessionReport> =
        sessions.values.filter { it.reportPending }.map { local ->
            LogSessionReport(local.request.id, local.status, local.reason?.message, local.startedAtMillis, local.endsAtMillis)
        }

    /** OneUptime took these reports. */
    @Synchronized
    fun onReported(reports: List<LogSessionReport>) {
        for (report in reports) {
            val local: Local = sessions[report.id] ?: continue
            // A report of an older status does not clear a newer one still to send.
            if (local.status == report.status) {
                local.reportPending = false
            }
        }
    }

    /**
     * The session the screen shows: one running or starting first, then one
     * waiting to be allowed, then one that just ended (for a minute, so the
     * person sees how it went).
     */
    @Synchronized
    fun current(): LogSessionView? {
        val elapsed: Long = clock.elapsedRealtimeMillis()
        val order: List<LogSessionStatus> = listOf(LogSessionStatus.STARTING, LogSessionStatus.COLLECTING, LogSessionStatus.AWAITING_APPROVAL)
        for (status in order) {
            sessions.values.firstOrNull { it.status == status }?.let { return view(it) }
        }
        return sessions.values
            .filter { !it.status.isActive && it.finishedElapsed != null && elapsed - it.finishedElapsed!! < SHOW_FINISHED_MILLIS }
            .maxByOrNull { it.finishedElapsed!! }
            ?.let { view(it) }
    }

    /** Whether a session is reading every app's lines now, or waiting for Android to allow it. */
    @Synchronized
    fun isRunning(): Boolean = sessions.values.any { it.status == LogSessionStatus.STARTING || it.status == LogSessionStatus.COLLECTING }

    private fun finish(local: Local) {
        local.reportPending = true
        local.finishedElapsed = clock.elapsedRealtimeMillis()
        changed(local)
    }

    private fun changed(local: Local) {
        onChanged(view(local))
    }

    private fun view(local: Local): LogSessionView = LogSessionView(local.request, local.status, local.reason, local.startedAtMillis, local.endsAtMillis)

    private fun reasonFor(unavailable: LogSessionUnavailable): LogSessionReason =
        when (unavailable) {
            LogSessionUnavailable.LOGCAT_DISABLED -> LogSessionReason.LOGCAT_DISABLED
            LogSessionUnavailable.NOT_GRANTED -> LogSessionReason.NOT_GRANTED
        }

    companion object {
        const val ANDROID_13: Int = 33
        const val MAX_DURATION_MINUTES: Int = 240

        // The screen paused for at least this long after Allow means Android's prompt was shown over it.
        const val PROMPT_SHOWN_AFTER_MILLIS: Long = 1_000

        // Back on the agent's screen, how long lines from other apps have to start arriving.
        const val ANSWER_WAIT_MILLIS: Long = 20_000

        // Android declines a prompt nobody answers after 400 seconds (LogcatManagerService).
        const val PROMPT_TIMEOUT_MILLIS: Long = 420_000

        const val SHOW_FINISHED_MILLIS: Long = 60_000
    }
}
