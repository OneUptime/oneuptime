package com.oneuptime.androidagent.ui

import android.content.Context
import android.text.format.DateFormat
import com.oneuptime.androidagent.R
import com.oneuptime.androidagent.agent.ContextStrings
import com.oneuptime.androidagent.agent.StringSource
import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.logsession.LogSessionReason
import com.oneuptime.androidagent.logsession.LogSessionRequest
import com.oneuptime.androidagent.logsession.LogSessionStatus
import com.oneuptime.androidagent.logsession.LogSessionView
import java.util.Date

/** The sentences the notification and the agent's screen say about a log session, in the device's language. */
object LogSessionText {
    fun requestSentence(context: Context, request: LogSessionRequest): String = requestSentence(ContextStrings(context), request)

    /** "Jane Doe asks, in OneUptime, for every app's logs on this device for 30 minutes, at Info and above." */
    fun requestSentence(strings: StringSource, request: LogSessionRequest): String {
        val duration: String = duration(strings, request.durationMinutes)
        val level: String = levelName(strings, request.minimumLevel)
        val by: String? = request.requestedBy?.trim()?.takeIf { it.isNotEmpty() }
        return if (by != null) {
            strings.get(R.string.log_session_request_by, by, duration, level)
        } else {
            strings.get(R.string.log_session_request, duration, level)
        }
    }

    /** "30 minutes", "1 hour", "2 hours": a request asks for minutes, and whole hours read as hours. */
    fun duration(strings: StringSource, minutes: Int): String =
        if (minutes >= 60 && minutes % 60 == 0) {
            strings.plural(R.plurals.duration_hours, minutes / 60, minutes / 60)
        } else {
            strings.plural(R.plurals.duration_minutes, minutes, minutes)
        }

    fun levelName(strings: StringSource, level: LogcatLevel): String =
        when (level) {
            LogcatLevel.VERBOSE -> strings.get(R.string.logcat_level_verbose)
            LogcatLevel.DEBUG -> strings.get(R.string.logcat_level_debug)
            LogcatLevel.INFO -> strings.get(R.string.logcat_level_info)
            LogcatLevel.WARN -> strings.get(R.string.logcat_level_warn)
            LogcatLevel.ERROR -> strings.get(R.string.logcat_level_error)
            LogcatLevel.FATAL -> strings.get(R.string.logcat_level_fatal)
        }

    /**
     * What the screen says of a session: the request while it waits, what to
     * do in Android's prompt while it starts, until when it sends while it
     * runs, and how it ended. [formatTime] writes a time as the device does.
     */
    fun state(strings: StringSource, view: LogSessionView, formatTime: (Long) -> String): String =
        when (view.status) {
            LogSessionStatus.REQUESTED, LogSessionStatus.AWAITING_APPROVAL -> requestSentence(strings, view.request)
            LogSessionStatus.STARTING -> strings.get(R.string.log_session_starting)
            LogSessionStatus.COLLECTING ->
                view.endsAtMillis?.let { strings.get(R.string.log_session_collecting_until, formatTime(it)) }
                    ?: strings.get(R.string.log_session_collecting)
            LogSessionStatus.CANCELLED -> strings.get(R.string.log_session_cancelled)
            LogSessionStatus.EXPIRED -> strings.get(R.string.log_session_expired)
            else -> view.reason?.let { reason(strings, it) } ?: strings.get(R.string.log_session_ended)
        }

    fun reason(strings: StringSource, reason: LogSessionReason): String =
        when (reason) {
            LogSessionReason.DECLINED_IN_AGENT -> strings.get(R.string.log_session_declined_here)
            LogSessionReason.DECLINED_BY_ANDROID -> strings.get(R.string.log_session_declined_by_android)
            LogSessionReason.NO_ANSWER_FROM_ANDROID -> strings.get(R.string.log_session_no_answer)
            LogSessionReason.TIME_UP -> strings.get(R.string.log_session_time_up)
            LogSessionReason.STOPPED_ON_DEVICE -> strings.get(R.string.log_session_stopped)
            LogSessionReason.AGENT_RESTARTED -> strings.get(R.string.log_session_agent_restarted)
            LogSessionReason.LOGCAT_STOPPED -> strings.get(R.string.log_session_logcat_stopped)
            LogSessionReason.LOGCAT_DISABLED -> strings.get(R.string.log_session_logcat_disabled)
            LogSessionReason.NOT_GRANTED -> strings.get(R.string.log_session_not_granted)
            LogSessionReason.REQUEST_EXPIRED -> strings.get(R.string.log_session_expired)
        }

    fun timeFormatter(context: Context): (Long) -> String {
        val format: java.text.DateFormat = DateFormat.getTimeFormat(context)
        return { millis -> format.format(Date(millis)) }
    }
}
