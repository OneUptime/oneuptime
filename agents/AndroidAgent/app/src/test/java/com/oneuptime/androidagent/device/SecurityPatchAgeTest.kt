package com.oneuptime.androidagent.device

import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/*
 * How old a device's security patch level is (#9965), in whole UTC days:
 * what android.os.security_patch.age reports and the Security Patch Out of
 * Date template reads, more than 90 being out of date.
 */
class SecurityPatchAgeTest {
    private fun millis(iso: String): Long = java.time.Instant.parse(iso).toEpochMilli()

    @Test
    fun `the days from the patch level's date to today`() {
        assertEquals(0, SecurityPatchAge.days("2026-11-19", millis("2026-11-19T00:00:00Z")))
        assertEquals(0, SecurityPatchAge.days("2026-11-19", millis("2026-11-19T23:59:59.999Z")))
        assertEquals(1, SecurityPatchAge.days("2026-11-18", millis("2026-11-19T00:00:00Z")))
        assertEquals(90, SecurityPatchAge.days("2026-08-21", millis("2026-11-19T08:27:37.467Z")))
        assertEquals(91, SecurityPatchAge.days("2026-08-20", millis("2026-11-19T08:27:37.467Z")))
        // The golden kiosk's level, at the golden's time.
        assertEquals(897, SecurityPatchAge.days("2024-06-05", 1_795_076_857_467L))
    }

    @Test
    fun `days are UTC days, wherever the device is`() {
        // 23:30 in New York on the 18th is already the 19th in UTC.
        val lateEvening: Long = millis("2026-11-19T04:30:00Z")
        assertEquals(1, SecurityPatchAge.days("2026-11-18", lateEvening))
    }

    @Test
    fun `leap years and month ends count as the calendar does`() {
        assertEquals(366, SecurityPatchAge.days("2024-01-01", millis("2025-01-01T12:00:00Z")))
        assertEquals(1, SecurityPatchAge.days("2024-02-28", millis("2024-02-29T12:00:00Z")))
        assertEquals(1, SecurityPatchAge.days("2024-02-29", millis("2024-03-01T12:00:00Z")))
        assertEquals(1, SecurityPatchAge.days("2023-12-31", millis("2024-01-01T00:00:00Z")))
    }

    @Test
    fun `every day of a long span matches java time's count`() {
        val now: Long = millis("2026-11-19T08:27:37Z")
        var date: LocalDate = LocalDate.of(2015, 1, 1)
        val today: LocalDate = LocalDate.of(2026, 11, 19)
        while (!date.isAfter(today)) {
            val expected: Long = ChronoUnit.DAYS.between(date, today)
            assertEquals(date.toString(), expected.toInt(), SecurityPatchAge.days(date.toString(), now))
            assertEquals(date.toEpochDay(), SecurityPatchAge.epochDay(date.year, date.monthValue, date.dayOfMonth))
            date = date.plusDays(1)
        }
        assertEquals(LocalDate.of(2000, 3, 1).atStartOfDay(ZoneOffset.UTC).toLocalDate().toEpochDay(), SecurityPatchAge.epochDay(2000, 3, 1))
    }

    @Test
    fun `a level dated after today is none behind`() {
        assertEquals(0, SecurityPatchAge.days("2026-12-05", millis("2026-11-19T08:00:00Z")))
    }

    @Test
    fun `a level that is not a date is no age`() {
        val now: Long = millis("2026-11-19T08:00:00Z")
        assertNull(SecurityPatchAge.days(null, now))
        assertNull(SecurityPatchAge.days("", now))
        assertNull(SecurityPatchAge.days("unknown", now))
        assertNull(SecurityPatchAge.days("2024-6-5", now))
        assertNull(SecurityPatchAge.days("2024-13-01", now))
        assertNull(SecurityPatchAge.days("2023-02-29", now))
        assertNull(SecurityPatchAge.days("2024-04-31", now))
        assertNull(SecurityPatchAge.days("1999-12-01", now))
        // As a device writes it, with spaces around: read.
        assertEquals(1, SecurityPatchAge.days(" 2026-11-18 ", now))
    }
}
