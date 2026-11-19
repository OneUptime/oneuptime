package com.oneuptime.androidagent.boot

import com.oneuptime.androidagent.config.MemoryKeyValueStore
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BootTrackerRebootFactsTest {
    private val clock = FakeClock(now = 1_795_000_000_000L, elapsed = 60_000L)
    private val store = MemoryKeyValueStore()
    private val tracker = BootTracker(store, clock)

    private fun boot(id: String, bootTime: Long = clock.now - clock.elapsed) = BootInfo(id, null, bootTime)

    @Test
    fun `isNew tells a new boot without recording it`() {
        // The first boot the agent ever sees is recorded, not reported: it is not new.
        assertFalse(tracker.isNew(boot("boot-1")))
        tracker.observe(boot("boot-1"))
        assertFalse(tracker.isNew(boot("boot-1")))

        assertTrue(tracker.isNew(boot("boot-2")))
        // Still new: isNew records nothing.
        assertTrue(tracker.isNew(boot("boot-2")))
        tracker.observe(boot("boot-2"))
        assertFalse(tracker.isNew(boot("boot-2")))
    }

    @Test
    fun `boots in the last hour, counted from now`() {
        tracker.observe(boot("boot-1", clock.now - 50 * 60_000))
        tracker.observe(boot("boot-2", clock.now - 20 * 60_000))
        tracker.observe(boot("boot-3", clock.now - 1 * 60_000))

        assertEquals(3, tracker.bootsInLastHour(clock.now))
        assertEquals(2, tracker.bootsInLastHour(clock.now + 15 * 60_000))
        assertEquals(0, tracker.bootsInLastHour(clock.now + 2 * 60 * 60_000))
    }

    @Test
    fun `the reboot's reason and the kernel's panic go on the boot's record`() {
        tracker.observe(boot("boot-1", clock.now - 3_600_000))
        val event: BootEvent = tracker.observe(boot("boot-2"))!!
        val facts = RebootFacts("kernel_panic", "Kernel panic - not syncing: Fatal exception", listOf("line 1", "line 2"))

        val record: LogRecord = BootTracker.record(event, clock.now, facts)
        val attributes: Map<String, Any> = record.attributes.toMap()

        assertEquals("kernel_panic", attributes["android.boot.reason"])
        assertEquals("Kernel panic - not syncing: Fatal exception", attributes["android.boot.kernel_panic"])
        assertEquals("line 1\nline 2", attributes["android.boot.last_kernel_log"])
        assertEquals(Severity.WARN, record.severity)
        assertTrue(record.body.contains("The kernel panicked: Kernel panic - not syncing: Fatal exception."))
        assertTrue(record.body.contains("Android gives the reboot's reason as kernel_panic."))
    }

    @Test
    fun `without reboot facts the record is as it was`() {
        tracker.observe(boot("boot-1", clock.now - 3_600_000))
        val event: BootEvent = tracker.observe(boot("boot-2"))!!

        val record: LogRecord = BootTracker.record(event, clock.now)

        assertNull(record.attributes.toMap()["android.boot.reason"])
        assertNull(record.attributes.toMap()["android.boot.last_kernel_log"])
        assertEquals(BootTracker.describe(event), record.body)
    }

    @Test
    fun `a reason without a panic is information, not a warning`() {
        tracker.observe(boot("boot-1", clock.now - 3_600_000))
        tracker.recordShutdown()
        val event: BootEvent = tracker.observe(boot("boot-2"))!!

        val record: LogRecord = BootTracker.record(event, clock.now, RebootFacts("reboot,userrequested", null, emptyList()))

        assertEquals(Severity.INFO, record.severity)
        assertEquals("reboot,userrequested", record.attributes.toMap()["android.boot.reason"])
    }
}
