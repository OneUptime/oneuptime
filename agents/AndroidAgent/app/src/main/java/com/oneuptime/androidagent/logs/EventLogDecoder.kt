package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.otlp.attributes

/**
 * Turns the two system events that say an app failed into exceptions
 * OneUptime files under the device's host:
 *
 *   am_crash  an app crashed: an uncaught exception ended its process.
 *             [pid, user, process, flags, exception class, message, file, line(, recoverable)]
 *   am_anr    an app stopped responding (Application Not Responding).
 *             [user, pid, process, flags, reason]
 *
 * ActivityManager writes both to Logcat's `events` buffer, which an app
 * holding READ_LOGS may read in the background on every Android version -
 * unlike the other buffers, which Android 13 and later only show it after
 * someone allows it on the device's screen (see LogcatReader).
 *
 * The values are printed comma-separated with no escaping, and a message or
 * a reason may itself hold commas. So each list is read from both ends: the
 * fields before the free text from the left, the fields after it from the
 * right. (am_crash's first two values are the pid and then the user, the
 * other way round from the names the tag declares for them: what
 * ActivityManagerService writes is what counts.)
 *
 * Each record is an event OneUptime already knows from OpenTelemetry Android,
 * `app.crash` and `device.anr`, with the `exception.*` attributes that make
 * it an unhandled exception in Exceptions. The message names the app, so two
 * apps that fail the same way are two exceptions, not one.
 */
object EventLogDecoder {
    const val TAG_CRASH: String = "am_crash"
    const val TAG_ANR: String = "am_anr"

    val TAGS: List<String> = listOf(TAG_CRASH, TAG_ANR)

    fun decode(line: LogcatLine, observedUnixNano: Long): LogRecord? =
        when (line.tag) {
            TAG_CRASH -> crash(line, observedUnixNano)
            TAG_ANR -> anr(line, observedUnixNano)
            else -> null
        }

    private fun crash(line: LogcatLine, observedUnixNano: Long): LogRecord? {
        val values: List<String> = values(line.message) ?: return null
        if (values.size < 8) {
            return null
        }
        val pid: Long? = values[0].trim().toLongOrNull()
        val process: String = values[2].trim()
        val exceptionType: String = values[4].trim()

        // Android 14 added "recoverable" after the line: two numbers at the end, not one.
        val hasRecoverable: Boolean = values.size >= 9 && values[values.size - 2].trim().toLongOrNull() != null
        val fileIndex: Int = if (hasRecoverable) values.size - 3 else values.size - 2
        if (fileIndex < 5 || process.isEmpty() || exceptionType.isEmpty()) {
            return null
        }
        // An exception's message is whatever the app put in it: a card number or a token has no business leaving the device.
        val message: String = Redactor.redact(values.subList(5, fileIndex).joinToString(",").trim())
        val file: String = values[fileIndex].trim()
        val lineNumber: Long? = values[fileIndex + 1].trim().toLongOrNull()
        val recoverable: Boolean = hasRecoverable && values.last().trim() == "1"
        val packageName: String = process.substringBefore(':')

        return LogRecord(
            timeUnixNano = line.timeUnixNano,
            observedTimeUnixNano = observedUnixNano,
            severity = if (recoverable) Severity.ERROR else Severity.FATAL,
            body =
                buildString {
                    append(process).append(" crashed: ").append(exceptionType)
                    if (message.isNotEmpty()) append(": ").append(message)
                },
            attributes =
                attributes {
                    text("event.name", "app.crash")
                    text("exception.type", exceptionType)
                    text("exception.message", if (message.isEmpty()) "$process crashed" else "$process: $message")
                    bool("exception.escaped", true)
                    text("android.package.name", packageName)
                    text("android.process.name", process)
                    int("process.pid", pid)
                    text("code.file.path", file.takeIf { it.isNotEmpty() && it != "null" && it != "unknown" })
                    int("code.line.number", lineNumber?.takeIf { it > 0 })
                    text("android.log.tag", TAG_CRASH)
                },
        )
    }

    private fun anr(line: LogcatLine, observedUnixNano: Long): LogRecord? {
        val values: List<String> = values(line.message) ?: return null
        if (values.size < 5) {
            return null
        }
        val pid: Long? = values[1].trim().toLongOrNull()
        val process: String = values[2].trim()
        if (process.isEmpty()) {
            return null
        }
        val reason: String = Redactor.redact(values.subList(4, values.size).joinToString(",").trim())
        // "Input dispatching timed out (8b3b1a2 ... Waited 5001ms ...)": the kind, without what changes each time.
        val kind: String = reason.substringBefore('(').trim().ifEmpty { "Application Not Responding" }

        return LogRecord(
            timeUnixNano = line.timeUnixNano,
            observedTimeUnixNano = observedUnixNano,
            severity = Severity.ERROR,
            body = if (reason.isEmpty()) "$process is not responding" else "$process is not responding: $reason",
            attributes =
                attributes {
                    text("event.name", "device.anr")
                    text("exception.type", "ANR")
                    text("exception.message", "$process: $kind")
                    bool("exception.escaped", true)
                    text("android.package.name", process.substringBefore(':'))
                    text("android.process.name", process)
                    int("process.pid", pid)
                    text("android.anr.reason", reason)
                    text("android.log.tag", TAG_ANR)
                },
        )
    }

    /** "[1,2,abc]" as ["1", "2", "abc"], or null when it is not a list. */
    private fun values(message: String): List<String>? {
        val text: String = message.trim()
        if (!text.startsWith("[") || !text.endsWith("]")) {
            return null
        }
        return text.substring(1, text.length - 1).split(',')
    }
}
