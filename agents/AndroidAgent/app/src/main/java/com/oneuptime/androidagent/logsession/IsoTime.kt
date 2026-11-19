package com.oneuptime.androidagent.logsession

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * ISO 8601 times, as OneUptime's API writes them ("2026-11-19T14:02:00.000Z"),
 * without java.time, which Android has only from 8.0 (the agent runs on 7).
 */
object IsoTime {
    // 2026-11-19T14:02:00, an optional fraction, then Z or an offset.
    private val PATTERN: Regex =
        Regex("""^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}:?\d{2})?$""")

    fun format(millis: Long): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(millis))
    }

    /** Milliseconds since the epoch, or null when [text] is not an ISO 8601 time. */
    fun parse(text: String?): Long? {
        val match: MatchResult = PATTERN.matchEntire(text?.trim().orEmpty()) ?: return null
        val values: List<String> = match.groupValues
        val month: Int = values[2].toInt()
        val day: Int = values[3].toInt()
        val hour: Int = values[4].toInt()
        val minute: Int = values[5].toInt()
        val second: Int = values[6].toInt()
        if (month !in 1..12 || day !in 1..31 || hour > 23 || minute > 59 || second > 60) {
            return null
        }
        val calendar: Calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.US)
        calendar.clear()
        calendar.set(values[1].toInt(), month - 1, day, hour, minute, second)
        val millis: Long = values[7].padEnd(3, '0').take(3).toInt().toLong()
        val zone: String = values[8]
        val offsetMillis: Long =
            if (zone.isEmpty() || zone.equals("Z", ignoreCase = true)) {
                0L
            } else {
                val sign: Int = if (zone[0] == '-') -1 else 1
                val digits: String = zone.substring(1).replace(":", "")
                sign * (digits.substring(0, 2).toLong() * 60 + digits.substring(2, 4).toLong()) * 60_000L
            }
        return calendar.timeInMillis + millis - offsetMillis
    }
}
