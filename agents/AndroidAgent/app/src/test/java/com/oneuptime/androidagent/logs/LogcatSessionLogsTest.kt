package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.logsession.LogSessionUnavailable
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.FakeProcess
import com.oneuptime.androidagent.testing.toMap
import java.util.Collections
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A log session's own logcat (LogSessionManager), and what DropBox covering crashes changes. */
class LogcatSessionLogsTest {
    private val clock = FakeClock(now = 1_795_000_000_000L)
    private val buffer = LogBuffer()
    private val launched: MutableList<List<String>> = Collections.synchronizedList(mutableListOf())
    private var collector: LogcatCollector? = null
    private var granted = true
    private var crashesCovered = false

    private val myUid = 10190

    /** Answers each `logcat` start by the buffers it reads: events, the session's, the regular text one. */
    private fun collector(sdkInt: Int, outputs: Map<String, String>): LogcatCollector {
        val started: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
        return LogcatCollector(
            clock = clock,
            sdkInt = sdkInt,
            launcher = { command ->
                launched.add(command)
                val kind: String =
                    when {
                        "events" in command -> "events"
                        command.contains("-T") -> "session"
                        else -> "text"
                    }
                FakeProcess(if (started.add(kind)) outputs[kind].orEmpty() else "")
            },
            packages = { uid -> if (uid == 10143) "com.example.kiosk" else null },
            currentBootId = { "boot-1" },
            buffer = buffer,
            resumePoints =
                object : ResumePointStore {
                    override fun load(session: String): ResumePoint? = null

                    override fun save(session: String, point: ResumePoint) = Unit
                },
            myUid = myUid,
            myPid = 4000,
            isGranted = { granted },
            crashesCoveredElsewhere = { crashesCovered },
        ).also { collector = it }
    }

    @After
    fun tearDown() {
        collector?.stopAll()
    }

    private fun launchedSnapshot(): List<List<String>> = synchronized(launched) { launched.toList() }

    private fun awaitRecords(count: Int): List<LogRecord> {
        val collected: MutableList<LogRecord> = mutableListOf()
        val deadline: Long = System.currentTimeMillis() + 5_000
        while (collected.size < count && System.currentTimeMillis() < deadline) {
            collected.addAll(buffer.drain())
            Thread.sleep(10)
        }
        Thread.sleep(50)
        collected.addAll(buffer.drain())
        return collected
    }

    // A line written after the session started: the session reads from its start, and skips what came before.
    private fun line(uid: String, pid: Int, message: String, offsetMillis: Long = 1_000): String {
        val millis: Long = clock.now + offsetMillis
        return "${millis / 1000}.${(millis % 1000).toString().padStart(3, '0')}  $uid  $pid  $pid I Printer: $message\n"
    }

    @Test
    fun `a session reads every app's lines from its start, at its level, each record tagged with it`() {
        val logcat: LogcatCollector =
            collector(
                sdkInt = 34,
                outputs = mapOf("session" to line("10143", 4321, "job queued") + line("1000", 580, "card 4111111111111111 declined")),
            )
        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)

        logcat.start("session-1", LogcatLevel.DEBUG)
        val records: List<LogRecord> = awaitRecords(2)

        assertEquals(2, records.size)
        assertTrue(records.all { it.attributes.toMap()[LogcatCollector.LOG_SESSION_ATTRIBUTE] == "session-1" })
        assertEquals("com.example.kiosk", records[0].attributes.toMap()["android.package.name"])
        assertEquals("card [card number] declined", records[1].body)
        val command: List<String> = launchedSnapshot().first { it.contains("-T") }
        assertTrue(command.containsAll(listOf("-b", "main", "system", "crash", "*:D")))
        assertTrue(logcat.isRunning)
    }

    @Test
    fun `lines from other apps say Android allowed it, the agent's own do not`() {
        val own: LogcatCollector = collector(sdkInt = 34, outputs = mapOf("session" to line("u0_a190", 4000, "only mine")))
        own.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
        own.start("s", LogcatLevel.INFO)
        awaitRecords(1)
        assertNull(own.lastOtherAppLineElapsedMillis)
        own.stopAll()

        val others: LogcatCollector = collector(sdkInt = 34, outputs = mapOf("session" to line("system", 580, "from the system")))
        others.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
        others.start("s", LogcatLevel.INFO)
        awaitRecords(1)
        assertEquals(clock.elapsed, others.lastOtherAppLineElapsedMillis)
    }

    @Test
    fun `stopped, its logcat ends and nothing more is tagged`() {
        val logcat: LogcatCollector = collector(sdkInt = 34, outputs = emptyMap())
        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
        logcat.start("s", LogcatLevel.INFO)

        logcat.stop()

        assertFalse(logcat.isRunning)
    }

    @Test
    fun `while a session runs on Android 12, the regular text session sends nothing, so no line goes twice`() {
        val logcat: LogcatCollector =
            collector(
                sdkInt = 31,
                outputs = mapOf("text" to line("10143", 4321, "from the regular session"), "session" to line("10143", 4321, "from the session")),
            )
        logcat.start("s", LogcatLevel.INFO)
        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)

        val records: List<LogRecord> = awaitRecords(1)

        assertEquals(listOf("from the session"), records.map { it.body })
    }

    @Test
    fun `it says when a session cannot run here`() {
        val logcat: LogcatCollector = collector(sdkInt = 34, outputs = emptyMap())
        assertNull(logcat.unavailable())

        granted = false
        assertEquals(LogSessionUnavailable.NOT_GRANTED, logcat.unavailable())

        granted = true
        logcat.update(enabled = false, granted = true, minLevel = LogcatLevel.WARN)
        assertEquals(LogSessionUnavailable.LOGCAT_DISABLED, logcat.unavailable())
    }

    @Test
    fun `switching Logcat off stops a session too`() {
        val logcat: LogcatCollector = collector(sdkInt = 34, outputs = emptyMap())
        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
        logcat.start("s", LogcatLevel.INFO)

        logcat.update(enabled = false, granted = true, minLevel = LogcatLevel.WARN)

        assertFalse(logcat.isRunning)
    }

    @Test
    fun `with DropBox covering crashes, the events buffer's copies are not sent`() {
        val crash = "1795000001.000  1000   580  1029 I am_crash: [1179,0,com.android.settings,0,java.lang.IllegalStateException,boom,A.java,1,0]\n"
        val anr = "1795000002.000  1000   580  1029 I am_anr: [0,4321,com.example.kiosk,0,Input dispatching timed out]\n"
        crashesCovered = true
        val logcat: LogcatCollector = collector(sdkInt = 34, outputs = mapOf("events" to crash + anr))

        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
        val records: List<LogRecord> = awaitRecords(1)

        // ANRs are not covered here: only the crash is left to DropBox.
        assertEquals(listOf("device.anr"), records.map { it.attributes.toMap()["event.name"] })
        assertNotNull(records.single().attributes.toMap()["exception.message"])
    }
}
