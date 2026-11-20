package com.oneuptime.androidagent.transport

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackoffTest {
    @Test
    fun `the wait doubles with each failure, half of it random, up to the cap`() {
        val backoff = Backoff(baseMillis = 15_000, maxMillis = 15 * 60_000, random = Random(42))

        listOf(1 to 15_000L, 2 to 30_000L, 3 to 60_000L, 5 to 240_000L, 7 to 900_000L, 40 to 900_000L).forEach { (failures, ceiling) ->
            repeat(50) {
                val wait: Long = backoff.delayMillis(failures)
                assertTrue("failures=$failures wait=$wait", wait in ceiling / 2..ceiling)
            }
        }
    }

    @Test
    fun `a Retry-After the server sent is waited at least, up to an hour`() {
        val backoff = Backoff(baseMillis = 1_000, maxMillis = 10_000, random = Random(1))

        assertEquals(120_000L, backoff.delayMillis(1, retryAfterMillis = 120_000L))
        assertEquals(Backoff.MAX_RETRY_AFTER_MILLIS, backoff.delayMillis(1, retryAfterMillis = 24 * 3_600_000L))
        assertTrue(backoff.delayMillis(1, retryAfterMillis = 0L) >= 500L)
    }

    @Test
    fun `Retry-After is read in seconds or as an HTTP date`() {
        val now = 1_795_000_000_000L // Sat, 12 Nov 2026 ...

        assertEquals(120_000L, RetryAfter.parse("120", now))
        assertEquals(0L, RetryAfter.parse("-5", now))
        assertEquals(30_000L, RetryAfter.parse(httpDate(now + 30_000L), now))
        assertEquals(0L, RetryAfter.parse(httpDate(now - 30_000L), now))
        assertNull(RetryAfter.parse("soon", now))
        assertNull(RetryAfter.parse(null, now))
        assertNull(RetryAfter.parse("  ", now))
    }

    private fun httpDate(millis: Long): String {
        val format = java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", java.util.Locale.US)
        format.timeZone = java.util.TimeZone.getTimeZone("GMT")
        return format.format(java.util.Date(millis))
    }
}
