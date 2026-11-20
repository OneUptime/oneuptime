package com.oneuptime.androidagent.device

/**
 * How old the device's security patch level is, in whole days (#9965): the
 * `android.os.security_patch.age` metric a fleet is alerted by when a device
 * falls behind (the Security Patch Out of Date template: more than 90 days).
 *
 * The patch level is Build.VERSION.SECURITY_PATCH, the date of the Android
 * security bulletin the device's build includes ("2024-06-05"). Its age is
 * counted from that date to today, both as UTC days, so a device reads the
 * same age wherever it is. A level that is not such a date is no age; one
 * dated after today (a device whose clock is behind) is 0.
 *
 * Plain arithmetic on civil dates, not java.time: the agent runs on
 * Android 7, which has no java.time without desugaring.
 */
object SecurityPatchAge {
    private val DATE: Regex = Regex("""^(\d{4})-(\d{2})-(\d{2})$""")
    private const val MILLIS_PER_DAY: Long = 86_400_000L

    fun days(securityPatch: String?, nowMillis: Long): Int? {
        val match: MatchResult = DATE.matchEntire(securityPatch?.trim() ?: return null) ?: return null
        val year: Int = match.groupValues[1].toInt()
        val month: Int = match.groupValues[2].toInt()
        val day: Int = match.groupValues[3].toInt()
        if (year < 2000 || month !in 1..12 || day !in 1..daysInMonth(year, month)) {
            return null
        }
        val today: Long = Math.floorDiv(nowMillis, MILLIS_PER_DAY)
        val age: Long = today - epochDay(year, month, day)
        return age.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
    }

    // Days since 1970-01-01 of a date in the proleptic Gregorian calendar (Howard Hinnant's days_from_civil).
    fun epochDay(year: Int, month: Int, day: Int): Long {
        val y: Long = if (month <= 2) year - 1L else year.toLong()
        val era: Long = Math.floorDiv(y, 400L)
        val yearOfEra: Long = y - era * 400
        val monthFromMarch: Long = ((month + 9) % 12).toLong()
        val dayOfYear: Long = (153 * monthFromMarch + 2) / 5 + day - 1
        val dayOfEra: Long = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    private fun daysInMonth(year: Int, month: Int): Int =
        when (month) {
            2 -> if ((year % 4 == 0 && year % 100 != 0) || year % 400 == 0) 29 else 28
            4, 6, 9, 11 -> 30
            else -> 31
        }
}
