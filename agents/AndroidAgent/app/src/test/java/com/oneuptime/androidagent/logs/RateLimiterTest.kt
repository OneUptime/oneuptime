package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RateLimiterTest {
    @Test
    fun `a burst up to the capacity goes through, then the refill rate holds`() {
        var elapsed = 0L
        val limiter = RateLimiter(capacity = 5.0, perSecond = 2.0, elapsedMillis = { elapsed })

        repeat(5) { assertTrue(limiter.tryAcquire()) }
        assertFalse(limiter.tryAcquire())

        elapsed += 500 // one token back
        assertTrue(limiter.tryAcquire())
        assertFalse(limiter.tryAcquire())

        elapsed += 60_000 // never more than the capacity
        repeat(5) { assertTrue(limiter.tryAcquire()) }
        assertFalse(limiter.tryAcquire())
    }

    @Test
    fun `a clock that goes backwards gives nothing back`() {
        var elapsed = 10_000L
        val limiter = RateLimiter(capacity = 1.0, perSecond = 1.0, elapsedMillis = { elapsed })

        assertTrue(limiter.tryAcquire())
        elapsed = 0L
        assertFalse(limiter.tryAcquire())
    }

    @Test
    fun `the log buffer holds up to its capacity, then counts what it drops`() {
        val buffer = LogBuffer(capacity = 2)
        val record = LogRecord(1, 1, Severity.INFO, "line")

        assertTrue(buffer.add(record))
        assertTrue(buffer.add(record))
        assertFalse(buffer.add(record))
        assertEquals(2, buffer.size())
        assertEquals(1L, buffer.takeDropped())
        assertEquals(0L, buffer.takeDropped())

        assertEquals(2, buffer.drain().size)
        assertEquals(0, buffer.size())
        assertTrue(buffer.add(record))
    }
}
