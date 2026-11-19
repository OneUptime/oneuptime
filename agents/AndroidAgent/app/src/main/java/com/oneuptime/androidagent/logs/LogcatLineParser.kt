package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.otlp.Severity
import java.util.Calendar
import java.util.TimeZone

/** One Logcat entry. */
data class LogcatLine(
    val timeUnixNano: Long,
    // The writer's user id as Logcat prints it: "10143", "u0_a143", "root". Null without `-v uid`.
    val uid: String?,
    val pid: Int,
    val tid: Int,
    // V, D, I, W, E, F (or A, as Android 4 called fatal).
    val priority: Char,
    val tag: String,
    val message: String,
) {
    val severity: Severity get() = LogcatLineParser.severityOf(priority)
}

sealed interface LogcatParse {
    data class Entry(val line: LogcatLine) : LogcatParse

    // "--------- beginning of main": the lines after it are from that buffer.
    data class Divider(val buffer: String) : LogcatParse

    data object Unrecognized : LogcatParse
}

/**
 * Reads the lines `logcat -v threadtime` prints, in each form the agent asks
 * for: with `-v epoch` (seconds since the epoch instead of a local date) and
 * `-v uid` (the writer's user id before its process id), as Android 7 and
 * later print them, and the plain local-time form older or unusual Logcats
 * fall back to:
 *
 *   1795076857.467  1000   580  1029 I am_crash: [1179,0,...]
 *   1795076857.467   580  1029 I ActivityManager: Start proc ...
 *   11-19 08:27:37.467   580  1029 I ActivityManager: Start proc ...
 *
 * The tag is everything up to the first ": " (Logcat pads short tags with
 * spaces), and the message everything after it.
 */
object LogcatLineParser {
    private val EPOCH_WITH_UID: Regex =
        Regex("""^\s*(\d{1,12})\.(\d{1,9})\s+(\S+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s(.*)$""")
    private val EPOCH: Regex = Regex("""^\s*(\d{1,12})\.(\d{1,9})\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s(.*)$""")
    private val LOCAL_TIME: Regex =
        Regex("""^\s*(\d\d)-(\d\d)\s+(\d\d):(\d\d):(\d\d)\.(\d{1,9})\s+(?:(\S+)\s+)??(\d+)\s+(\d+)\s+([VDIWEFA])\s(.*)$""")
    private val DIVIDER: Regex = Regex("""^-+ (?:beginning of|switch to) (\w+)""")

    fun parse(raw: String, nowMillis: Long, zone: TimeZone = TimeZone.getDefault()): LogcatParse {
        val line: String = raw.trimEnd('\r', '\n')

        DIVIDER.find(line)?.let { return LogcatParse.Divider(it.groupValues[1]) }

        EPOCH_WITH_UID.matchEntire(line)?.let { match ->
            val values: List<String> = match.groupValues
            return entry(epochNanos(values[1], values[2]), values[3], values[4], values[5], values[6], values[7])
        }

        EPOCH.matchEntire(line)?.let { match ->
            val values: List<String> = match.groupValues
            return entry(epochNanos(values[1], values[2]), null, values[3], values[4], values[5], values[6])
        }

        LOCAL_TIME.matchEntire(line)?.let { match ->
            val values: List<String> = match.groupValues
            val nanos: Long =
                localNanos(
                    month = values[1].toInt(),
                    day = values[2].toInt(),
                    hour = values[3].toInt(),
                    minute = values[4].toInt(),
                    second = values[5].toInt(),
                    fraction = values[6],
                    nowMillis = nowMillis,
                    zone = zone,
                ) ?: return LogcatParse.Unrecognized
            return entry(nanos, values[7].ifEmpty { null }, values[8], values[9], values[10], values[11])
        }

        return LogcatParse.Unrecognized
    }

    fun severityOf(priority: Char): Severity =
        when (priority) {
            'V' -> Severity.TRACE
            'D' -> Severity.DEBUG
            'I' -> Severity.INFO
            'W' -> Severity.WARN
            'E' -> Severity.ERROR
            else -> Severity.FATAL
        }

    private fun entry(
        timeUnixNano: Long,
        uid: String?,
        pid: String,
        tid: String,
        priority: String,
        rest: String,
    ): LogcatParse {
        val separator: Int = rest.indexOf(": ")
        val tag: String
        val message: String
        if (separator >= 0) {
            tag = rest.substring(0, separator).trim()
            message = rest.substring(separator + 2)
        } else {
            // An empty message: "Tag:" or "Tag: ".
            tag = rest.trim().removeSuffix(":").trim()
            message = ""
        }
        return LogcatParse.Entry(
            LogcatLine(
                timeUnixNano = timeUnixNano,
                uid = uid,
                pid = pid.toIntOrNull() ?: 0,
                tid = tid.toIntOrNull() ?: 0,
                priority = priority[0],
                tag = tag,
                message = message,
            ),
        )
    }

    private fun epochNanos(seconds: String, fraction: String): Long =
        seconds.toLong() * 1_000_000_000L + fraction.padEnd(9, '0').take(9).toLong()

    /*
     * The plain form has no year or time zone: it is the device's local time,
     * and the year is this one unless that puts the entry more than a day in
     * the future (a December line read in January).
     */
    private fun localNanos(
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        second: Int,
        fraction: String,
        nowMillis: Long,
        zone: TimeZone,
    ): Long? {
        if (month !in 1..12 || day !in 1..31 || hour > 23 || minute > 59 || second > 60) {
            return null
        }
        val calendar: Calendar = Calendar.getInstance(zone)
        calendar.timeInMillis = nowMillis
        val year: Int = calendar.get(Calendar.YEAR)
        calendar.clear()
        calendar.set(year, month - 1, day, hour, minute, second)
        var millis: Long = calendar.timeInMillis
        if (millis - nowMillis > DAY_MILLIS) {
            calendar.set(Calendar.YEAR, year - 1)
            millis = calendar.timeInMillis
        }
        return millis * 1_000_000L + fraction.padEnd(9, '0').take(9).toLong()
    }

    private const val DAY_MILLIS: Long = 24L * 60 * 60 * 1000
}

/** The app a Logcat line came from, by its writer's user id. */
object LogcatUid {
    private val APP_NAME: Regex = Regex("""^u(\d+)_a(\d+)$""")

    /** The numeric uid of an app's line, or null for the system's own (root, system, shell, ...). */
    fun appUid(uid: String?): Int? = numeric(uid)?.takeIf { it % 100_000 >= 10_000 }

    /** The uid as a number: "10143" and "u0_a143" are 10143. Null for a name such as "system" or "root". */
    fun numeric(uid: String?): Int? {
        val text: String = uid?.trim().orEmpty()
        return text.toIntOrNull()
            ?: APP_NAME.matchEntire(text)?.let { match ->
                match.groupValues[1].toInt() * 100_000 + 10_000 + match.groupValues[2].toInt()
            }
    }
}
