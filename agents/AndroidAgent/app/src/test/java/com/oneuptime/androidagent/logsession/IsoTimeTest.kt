package com.oneuptime.androidagent.logsession

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IsoTimeTest {
    @Test
    fun `it writes and reads OneUptime's times`() {
        assertEquals("2026-11-19T14:02:00.000Z", IsoTime.format(1_795_096_920_000L))
        assertEquals(1_795_096_920_000L, IsoTime.parse("2026-11-19T14:02:00.000Z"))
        assertEquals(1_795_096_920_000L, IsoTime.parse("2026-11-19T14:02:00Z"))
        assertEquals(1_795_096_920_123L, IsoTime.parse("2026-11-19T14:02:00.123456Z"))
    }

    @Test
    fun `an offset is taken into account`() {
        assertEquals(1_795_096_920_000L, IsoTime.parse("2026-11-19T15:02:00+01:00"))
        assertEquals(1_795_096_920_000L, IsoTime.parse("2026-11-19T09:02:00-0500"))
        // No zone is read as UTC.
        assertEquals(1_795_096_920_000L, IsoTime.parse("2026-11-19T14:02:00"))
    }

    @Test
    fun `anything else is no time`() {
        assertNull(IsoTime.parse(null))
        assertNull(IsoTime.parse(""))
        assertNull(IsoTime.parse("yesterday"))
        assertNull(IsoTime.parse("2026-13-19T14:02:00Z"))
        assertNull(IsoTime.parse("2026-11-19T25:02:00Z"))
    }
}
