package com.oneuptime.androidagent.boot

import com.oneuptime.androidagent.config.MemoryKeyValueStore
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.otlp.millisToNanos
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class BootTrackerTest {
    private val store = MemoryKeyValueStore()
    private val clock = FakeClock(now = 1_795_000_000_000L, elapsed = 0L)
    private val tracker = BootTracker(store, clock)

    private fun bootedAt(bootTime: Long, id: String? = null, count: Int? = null) = BootInfo(id, count, bootTime)

    /** Runs the device for [millis], the agent reporting it alive along the way. */
    private fun runFor(millis: Long, byService: Boolean = true) {
        clock.advance(millis)
        tracker.recordAlive(byService)
    }

    /** Powers the device off for [millis] and boots it, the clocks as a real boot leaves them. */
    private fun reboot(offMillis: Long): Long {
        clock.now += offMillis
        clock.elapsed = 0L
        return clock.now
    }

    @Test
    fun `the first boot the agent sees is recorded, not reported`() {
        assertNull(tracker.observe(bootedAt(clock.now, "boot-1", 41)))
        assertNull(tracker.observe(bootedAt(clock.now, "boot-1", 41)))
    }

    @Test
    fun `a new boot id is a boot, reported once, with how the previous boot ended`() {
        tracker.observe(bootedAt(clock.now, "boot-1", 41))
        runFor(3 * 86_400_000L + 4 * 3_600_000L)
        val shutdown: LogRecord = tracker.recordShutdown()
        val bootTime: Long = reboot(offMillis = 125_000L)

        val event: BootEvent = tracker.observe(bootedAt(bootTime, "boot-2", 42))!!

        assertEquals(PreviousShutdown.CLEAN, event.previousShutdown)
        assertEquals(3 * 86_400L + 4 * 3_600L, event.previousUptimeSeconds)
        assertEquals(125L, event.offlineSeconds)
        // The boot before was days ago: this one is the only boot in the last hour.
        assertEquals(1, event.bootsInLastHour)
        assertNull(tracker.observe(bootedAt(bootTime, "boot-2", 42)))

        assertEquals("device.shutdown", shutdown.attributes.toMap()["event.name"])
        assertEquals(3 * 86_400L + 4 * 3_600L, shutdown.attributes.toMap()["android.boot.uptime"])
        assertEquals("Device shutting down after 3d 4h 0m up.", shutdown.body)
    }

    @Test
    fun `a boot with no shutdown before it, while the agent was running, went down unexpectedly`() {
        tracker.observe(bootedAt(clock.now, "boot-1"))
        runFor(600_000L)
        val bootTime: Long = reboot(offMillis = 30_000L)

        val event: BootEvent = tracker.observe(bootedAt(bootTime, "boot-2"))!!

        assertEquals(PreviousShutdown.UNEXPECTED, event.previousShutdown)
        assertEquals(30L, event.offlineSeconds)
        val record: LogRecord = BootTracker.record(event, clock.now)
        assertEquals(Severity.WARN, record.severity)
        assertEquals("unexpected", record.attributes.toMap()["android.boot.previous_shutdown"])
    }

    @Test
    fun `when only the watchdog was running, how the device went down is unknown`() {
        tracker.observe(bootedAt(clock.now, "boot-1"))
        runFor(600_000L, byService = false)
        val bootTime: Long = reboot(offMillis = 30_000L)

        assertEquals(PreviousShutdown.UNKNOWN, tracker.observe(bootedAt(bootTime, "boot-2"))!!.previousShutdown)
    }

    @Test
    fun `without a boot id the boot count tells boots apart, and without either the boot time does`() {
        tracker.observe(bootedAt(clock.now, null, 41))
        assertNull(tracker.observe(bootedAt(clock.now + 5_000L, null, 41)))
        assertNotNull(tracker.observe(bootedAt(clock.now + 60_000L, null, 42)))

        val other = BootTracker(MemoryKeyValueStore(), clock)
        other.observe(bootedAt(1_000_000L))
        // The wall clock moves the computed boot time a little: that is the same boot.
        assertNull(other.observe(bootedAt(1_000_000L + 30_000L)))
        assertNotNull(other.observe(bootedAt(1_000_000L + 10 * 60_000L)))
    }

    @Test
    fun `three boots in an hour are a restart loop, reported as a warning`() {
        tracker.observe(bootedAt(clock.now, "boot-1"))
        var last: BootEvent? = null
        listOf("boot-2", "boot-3").forEach { id ->
            runFor(60_000L)
            tracker.recordShutdown()
            last = tracker.observe(bootedAt(reboot(10_000L), id))
        }

        assertEquals(3, last!!.bootsInLastHour)
        val record: LogRecord = BootTracker.record(last!!, clock.now)
        assertEquals(Severity.WARN, record.severity)
        assertEquals(3L, record.attributes.toMap()["android.boot.recent_count"])
        assertEquals(true, record.body.endsWith("It has started 3 times in the last hour."))
    }

    @Test
    fun `boots more than an hour apart are not a loop`() {
        tracker.observe(bootedAt(clock.now, "boot-1"))
        runFor(2 * 3_600_000L)
        tracker.recordShutdown()

        assertEquals(1, tracker.observe(bootedAt(reboot(1_000L), "boot-2"))!!.bootsInLastHour)
    }

    @Test
    fun `the boot record carries what is known, stamped at boot`() {
        val event =
            BootEvent(
                boot = BootInfo("boot-2", 42, 1_795_000_000_000L),
                previousUptimeSeconds = 3_600L,
                offlineSeconds = 125L,
                previousShutdown = PreviousShutdown.CLEAN,
                bootsInLastHour = 1,
            )
        val record: LogRecord = BootTracker.record(event, nowMillis = 1_795_000_060_000L)
        val attributes: Map<String, Any> = record.attributes.toMap()

        assertEquals(millisToNanos(1_795_000_000_000L), record.timeUnixNano)
        assertEquals(millisToNanos(1_795_000_060_000L), record.observedTimeUnixNano)
        assertEquals(Severity.INFO, record.severity)
        assertEquals("device.boot", attributes["event.name"])
        assertEquals("boot-2", attributes["android.boot.id"])
        assertEquals(42L, attributes["android.boot.count"])
        assertEquals(3_600L, attributes["android.boot.previous_uptime"])
        assertEquals(125L, attributes["android.boot.offline_duration"])
        assertEquals("clean", attributes["android.boot.previous_shutdown"])
        assertEquals(1L, attributes["android.boot.recent_count"])
        assertEquals(
            "Device started (boot 42). It had been up for 1h 0m, and shut down cleanly. It was off for 2m 5s.",
            record.body,
        )
    }

    @Test
    fun `a device that booted before its clock was set is stamped when the agent noticed`() {
        val event = BootEvent(BootInfo(null, null, 946_684_800_000L), null, null, PreviousShutdown.UNKNOWN, 1)

        val record: LogRecord = BootTracker.record(event, nowMillis = 1_795_000_000_000L)

        assertEquals(millisToNanos(1_795_000_000_000L), record.timeUnixNano)
        assertEquals("Device started.", record.body)
    }

    @Test
    fun `the body says only what is known`() {
        fun body(uptime: Long?, offline: Long?, shutdown: PreviousShutdown) =
            BootTracker.describe(BootEvent(BootInfo(null, null, 0L), uptime, offline, shutdown, 1))

        assertEquals("Device started. It had been up for 45s.", body(45L, null, PreviousShutdown.UNKNOWN))
        assertEquals("Device started. It shut down cleanly.", body(null, null, PreviousShutdown.CLEAN))
        assertEquals(
            "Device started. It had been up for 2h 5m, and went down without shutting down: power lost, a crash or a forced reset. It was off for at most 1m 0s.",
            body(7_500L, 60L, PreviousShutdown.UNEXPECTED),
        )
    }

    @Test
    fun `durations read the way people say them`() {
        assertEquals("0s", BootTracker.formatDuration(0))
        assertEquals("59s", BootTracker.formatDuration(59))
        assertEquals("1m 5s", BootTracker.formatDuration(65))
        assertEquals("2h 0m", BootTracker.formatDuration(7_200))
        assertEquals("3d 4h 10m", BootTracker.formatDuration(3 * 86_400 + 4 * 3_600 + 600 + 59))
        assertEquals("0s", BootTracker.formatDuration(-5))
    }
}
