package com.oneuptime.androidagent.logsession

import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.testing.FakeClock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogSessionManagerTest {
    private val clock = FakeClock(now = 1_795_000_000_000L, elapsed = 600_000L)

    private class FakeLogcat(private val clock: FakeClock) : SessionLogcat {
        var unavailableBecause: LogSessionUnavailable? = null
        var started: Pair<String, LogcatLevel>? = null
        var stops: Int = 0
        var running: Boolean = false
        var otherAppLine: Long? = null

        override fun unavailable(): LogSessionUnavailable? = unavailableBecause

        override fun start(sessionId: String, level: LogcatLevel) {
            started = sessionId to level
            running = true
        }

        override fun stop() {
            stops += 1
            running = false
        }

        override val isRunning: Boolean get() = running

        override val lastOtherAppLineElapsedMillis: Long? get() = otherAppLine

        fun androidAllowed() {
            otherAppLine = clock.elapsed
        }
    }

    private val logcat = FakeLogcat(clock)
    private val asked: MutableList<LogSessionRequest> = mutableListOf()
    private val changes: MutableList<LogSessionView> = mutableListOf()

    private fun manager(sdkInt: Int = 34) = LogSessionManager(clock, sdkInt, logcat, { asked.add(it) }, { changes.add(it) })

    private fun request(
        id: String = "s1",
        status: LogSessionStatus = LogSessionStatus.REQUESTED,
        minutes: Int = 30,
        expiresAt: Long? = clock.now + 60 * 60_000,
    ) = LogSessionRequest(id, status, minutes, LogcatLevel.INFO, clock.now, "Jane Doe", expiresAt)

    @Test
    fun `a request is shown at the device, and OneUptime is told it waits there`() {
        val manager = manager()

        manager.onServerSessions(listOf(request()))

        assertEquals(1, asked.size)
        assertEquals(LogSessionStatus.AWAITING_APPROVAL, manager.current()!!.status)
        assertEquals(listOf(LogSessionStatus.AWAITING_APPROVAL), manager.reportsToSend().map { it.status })
        // Asked again in the next poll, it is not shown twice.
        manager.onServerSessions(listOf(request(status = LogSessionStatus.AWAITING_APPROVAL)))
        assertEquals(1, asked.size)
    }

    @Test
    fun `allowed on Android 13 and later, it starts its logcat at once and waits for Android's prompt`() {
        val manager = manager(sdkInt = 34)
        manager.onServerSessions(listOf(request()))

        val view: LogSessionView = manager.allow("s1")!!

        assertEquals("s1" to LogcatLevel.INFO, logcat.started)
        assertEquals(LogSessionStatus.STARTING, view.status)
        assertEquals(clock.now + 30 * 60_000, view.endsAtMillis)
        assertTrue(manager.isRunning())

        // Lines from other apps: Android allowed it.
        clock.advance(5_000)
        logcat.androidAllowed()
        manager.tick()
        assertEquals(LogSessionStatus.COLLECTING, manager.current()!!.status)
        assertEquals(LogSessionStatus.COLLECTING, manager.reportsToSend().single().status)
    }

    @Test
    fun `on Android 12 and earlier Android asks nothing, and it collects as soon as it is allowed`() {
        val manager = manager(sdkInt = 31)
        manager.onServerSessions(listOf(request()))

        assertEquals(LogSessionStatus.COLLECTING, manager.allow("s1")!!.status)
    }

    @Test
    fun `it stops on its own when its time is up, by the elapsed clock`() {
        val manager = manager(sdkInt = 31)
        manager.onServerSessions(listOf(request(minutes = 15)))
        manager.allow("s1")

        clock.elapsed += 14 * 60_000
        manager.tick()
        assertEquals(LogSessionStatus.COLLECTING, manager.current()!!.status)

        // The wall clock jumping back changes nothing: elapsed time decides.
        clock.now -= 60 * 60_000
        clock.elapsed += 60_000
        manager.tick()
        val ended: LogSessionView = manager.current()!!
        assertEquals(LogSessionStatus.ENDED, ended.status)
        assertEquals(LogSessionReason.TIME_UP, ended.reason)
        assertFalse(logcat.running)
        assertEquals(LogSessionReason.TIME_UP.message, manager.reportsToSend().single().message)
    }

    @Test
    fun `declined in Android's prompt, nothing from other apps once the person is back on the agent's screen`() {
        val manager = manager()
        manager.onServerSessions(listOf(request()))
        manager.allow("s1")

        // The prompt covered the screen for a few seconds, then the person came back.
        clock.advance(4_000)
        manager.onScreenResumed()
        clock.advance(LogSessionManager.ANSWER_WAIT_MILLIS - 1)
        manager.tick()
        assertEquals(LogSessionStatus.STARTING, manager.current()!!.status)

        clock.advance(1)
        manager.tick()
        val view: LogSessionView = manager.current()!!
        assertEquals(LogSessionStatus.DECLINED, view.status)
        assertEquals(LogSessionReason.DECLINED_BY_ANDROID, view.reason)
        assertEquals(1, logcat.stops)
    }

    @Test
    fun `the screen coming back at once is not the prompt closing`() {
        val manager = manager()
        manager.onServerSessions(listOf(request()))
        manager.allow("s1")

        manager.onScreenResumed()
        clock.advance(LogSessionManager.ANSWER_WAIT_MILLIS + 1_000)
        manager.tick()

        assertEquals(LogSessionStatus.STARTING, manager.current()!!.status)
    }

    @Test
    fun `nobody answering Android's prompt ends it as Android does`() {
        val manager = manager()
        manager.onServerSessions(listOf(request()))
        manager.allow("s1")

        clock.advance(LogSessionManager.PROMPT_TIMEOUT_MILLIS)
        manager.tick()

        assertEquals(LogSessionReason.NO_ANSWER_FROM_ANDROID, manager.current()!!.reason)
    }

    @Test
    fun `declined or stopped on the agent's screen`() {
        val manager = manager(sdkInt = 31)
        manager.onServerSessions(listOf(request("a"), request("b")))

        assertEquals(LogSessionStatus.DECLINED, manager.decline("a")!!.status)
        assertNull(logcat.started)

        manager.allow("b")
        val stopped: LogSessionView = manager.stop("b")!!
        assertEquals(LogSessionStatus.ENDED, stopped.status)
        assertEquals(LogSessionReason.STOPPED_ON_DEVICE, stopped.reason)
        assertFalse(logcat.running)
    }

    @Test
    fun `a device that cannot answers so, without asking anyone`() {
        logcat.unavailableBecause = LogSessionUnavailable.NOT_GRANTED
        val manager = manager()

        manager.onServerSessions(listOf(request()))

        assertTrue(asked.isEmpty())
        val report: LogSessionReport = manager.reportsToSend().single()
        assertEquals(LogSessionStatus.UNAVAILABLE, report.status)
        assertEquals(LogSessionReason.NOT_GRANTED.message, report.message)
    }

    @Test
    fun `Logcat switched off between the request and Allow makes it unavailable`() {
        val manager = manager()
        manager.onServerSessions(listOf(request()))
        logcat.unavailableBecause = LogSessionUnavailable.LOGCAT_DISABLED

        assertEquals(LogSessionStatus.UNAVAILABLE, manager.allow("s1")!!.status)
        assertNull(logcat.started)
    }

    @Test
    fun `cancelled in OneUptime, it stops at once and has nothing to report`() {
        val manager = manager(sdkInt = 31)
        manager.onServerSessions(listOf(request()))
        manager.allow("s1")
        manager.onReported(manager.reportsToSend())

        manager.onServerSessions(listOf(request(status = LogSessionStatus.CANCELLED)))

        assertEquals(LogSessionStatus.CANCELLED, manager.current()!!.status)
        assertFalse(logcat.running)
        assertTrue(manager.reportsToSend().isEmpty())
    }

    @Test
    fun `a session OneUptime thinks is running ended with the agent's last process`() {
        val manager = manager()

        manager.onServerSessions(listOf(request(status = LogSessionStatus.COLLECTING)))

        val report: LogSessionReport = manager.reportsToSend().single()
        assertEquals(LogSessionStatus.ENDED, report.status)
        assertEquals(LogSessionReason.AGENT_RESTARTED.message, report.message)
        assertTrue(asked.isEmpty())
    }

    @Test
    fun `a request nobody allowed runs out`() {
        val manager = manager()
        manager.onServerSessions(listOf(request(expiresAt = clock.now + 60_000)))

        clock.advance(60_000)
        manager.tick()

        assertEquals(LogSessionStatus.EXPIRED, manager.current()!!.status)
    }

    @Test
    fun `a newer status is reported even when an older one was just taken`() {
        val manager = manager(sdkInt = 31)
        manager.onServerSessions(listOf(request()))
        val first: List<LogSessionReport> = manager.reportsToSend()
        manager.allow("s1")

        manager.onReported(first)

        assertEquals(LogSessionStatus.COLLECTING, manager.reportsToSend().single().status)
    }

    @Test
    fun `one session at a time, allowing a second ends the first`() {
        val manager = manager(sdkInt = 31)
        manager.onServerSessions(listOf(request("a"), request("b")))
        manager.allow("a")

        manager.allow("b")

        assertEquals("b", manager.current()!!.request.id)
        assertEquals(LogSessionStatus.ENDED, manager.reportsToSend().first { it.id == "a" }.status)
    }

    @Test
    fun `a finished session shows for a minute, then the screen is clear`() {
        val manager = manager()
        manager.onServerSessions(listOf(request()))
        manager.decline("s1")
        assertEquals(LogSessionStatus.DECLINED, manager.current()!!.status)

        clock.advance(LogSessionManager.SHOW_FINISHED_MILLIS)
        assertNull(manager.current())
    }

    @Test
    fun `a session that is over and reported is forgotten once OneUptime stops listing it`() {
        val manager = manager()
        manager.onServerSessions(listOf(request()))
        manager.decline("s1")
        manager.onReported(manager.reportsToSend())

        manager.onServerSessions(emptyList())
        clock.advance(1)

        assertNull(manager.current())
        assertTrue(manager.reportsToSend().isEmpty())
    }

    @Test
    fun `every change is told, for the device's logs`() {
        val manager = manager(sdkInt = 31)
        manager.onServerSessions(listOf(request()))
        manager.allow("s1")
        manager.stop("s1")

        assertEquals(
            listOf(LogSessionStatus.AWAITING_APPROVAL, LogSessionStatus.COLLECTING, LogSessionStatus.ENDED),
            changes.map { it.status },
        )
    }
}
