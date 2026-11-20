package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.FakeProcess
import com.oneuptime.androidagent.testing.toMap
import java.util.Collections
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogcatCollectorTest {
    private val clock = FakeClock()
    private val buffer = LogBuffer()
    private val launched: MutableList<List<String>> = Collections.synchronizedList(mutableListOf())
    private val savedPoints: MutableMap<String, ResumePoint> = mutableMapOf()
    private var collector: LogcatCollector? = null

    /** Answers the first start of each session with [eventsOutput] or [textOutput], and later starts with nothing. */
    private fun collector(
        sdkInt: Int,
        eventsOutput: String = "",
        textOutput: String = "",
    ): LogcatCollector {
        val started: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
        return LogcatCollector(
            clock = clock,
            sdkInt = sdkInt,
            launcher = { command ->
                launched.add(command)
                val kind: String = if ("events" in command) "events" else "text"
                FakeProcess(if (started.add(kind)) (if (kind == "events") eventsOutput else textOutput) else "")
            },
            packages = { uid -> if (uid == 10143) "com.example.kiosk" else null },
            currentBootId = { "boot-1" },
            buffer = buffer,
            resumePoints =
                object : ResumePointStore {
                    override fun load(session: String): ResumePoint? = savedPoints[session]

                    override fun save(session: String, point: ResumePoint) {
                        savedPoints[session] = point
                    }
                },
        ).also { collector = it }
    }

    @After
    fun tearDown() {
        collector?.stopAll()
    }

    private fun awaitRecords(count: Int): List<LogRecord> {
        val collected: MutableList<LogRecord> = mutableListOf()
        val deadline: Long = System.currentTimeMillis() + 5_000
        while (collected.size < count && System.currentTimeMillis() < deadline) {
            collected.addAll(buffer.drain())
            Thread.sleep(10)
        }
        return collected
    }

    // The sessions' threads add to the list while a test reads it: read a copy, taken under its lock.
    private fun launchedSnapshot(): List<List<String>> = synchronized(launched) { launched.toList() }

    private fun awaitLaunches(count: Int) {
        awaitCondition { launched.size >= count }
    }

    private fun awaitCondition(condition: () -> Boolean): Boolean {
        val deadline: Long = System.currentTimeMillis() + 5_000
        while (!condition() && System.currentTimeMillis() < deadline) {
            Thread.sleep(10)
        }
        return condition()
    }

    @Test
    fun `switched off or not granted, no Logcat runs`() {
        val logcat: LogcatCollector = collector(sdkInt = 34)

        assertEquals(LogcatState.DISABLED, logcat.update(enabled = false, granted = true, minLevel = LogcatLevel.WARN))
        assertEquals(LogcatState.NOT_GRANTED, logcat.update(enabled = true, granted = false, minLevel = LogcatLevel.WARN))
        Thread.sleep(50)
        assertTrue(launched.isEmpty())
    }

    @Test
    fun `on Android 13 and later only the events buffer is read, for crashes and ANRs`() {
        val logcat: LogcatCollector =
            collector(
                sdkInt = 33,
                eventsOutput = "         1795076857.467  1000   580  1029 I am_crash: [1179,0,com.android.settings,0,java.lang.IllegalStateException,boom,A.java,1,0]\n",
            )

        assertEquals(LogcatState.CRASHES_AND_ANRS, logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN))
        val records: List<LogRecord> = awaitRecords(1)

        assertEquals(1, records.size)
        assertEquals("app.crash", records.single().attributes.toMap()["event.name"])
        val command: List<String> = launchedSnapshot().first()
        assertEquals(listOf("logcat", "-b", "events"), command.take(3))
        assertTrue(command.containsAll(listOf("am_crash:I", "am_anr:I", "*:S")))
        assertTrue(launchedSnapshot().none { "main" in it })
    }

    @Test
    fun `on Android 12 and earlier the main, system and crash buffers are read too, at the chosen level`() {
        val logcat: LogcatCollector =
            collector(
                sdkInt = 32,
                textOutput =
                    "--------- beginning of main\n" +
                        "         1795076857.500 10143  4242  4250 W KioskApp: Printer offline\n",
            )

        assertEquals(LogcatState.FULL, logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN))
        val record: LogRecord = awaitRecords(1).single()
        awaitLaunches(2)

        assertEquals(Severity.WARN, record.severity)
        assertEquals("Printer offline", record.body)
        assertEquals(
            mapOf(
                "android.log.tag" to "KioskApp",
                "process.pid" to 4242L,
                "thread.id" to 4250L,
                "android.log.buffer" to "main",
                "android.package.name" to "com.example.kiosk",
            ),
            record.attributes.toMap(),
        )
        val text: List<String> = launchedSnapshot().first { "main" in it }
        assertTrue(text.containsAll(listOf("-b", "main", "system", "crash", "*:W")))
        assertTrue(launchedSnapshot().any { "events" in it })
    }

    @Test
    fun `a new level restarts the text session with it`() {
        val logcat: LogcatCollector = collector(sdkInt = 30)
        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
        assertTrue(awaitCondition { launchedSnapshot().any { "*:W" in it } })

        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.INFO)

        assertTrue(awaitCondition { launchedSnapshot().any { "*:I" in it } })
        assertEquals(LogcatState.FULL, logcat.state)
    }

    @Test
    fun `revoking READ_LOGS stops every session`() {
        val logcat: LogcatCollector = collector(sdkInt = 30)
        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
        awaitLaunches(2)

        assertEquals(LogcatState.NOT_GRANTED, logcat.update(enabled = true, granted = false, minLevel = LogcatLevel.WARN))
        assertEquals(LogcatState.NOT_GRANTED, logcat.state)
    }

    @Test
    fun `where each session got to is saved, so a restart resumes there`() {
        val logcat: LogcatCollector =
            collector(sdkInt = 33, eventsOutput = "         1795076857.467  1000   580  1029 I am_anr: [0,8123,com.example.kiosk,0,Input dispatching timed out]\n")
        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
        awaitRecords(1)

        logcat.saveResumePoints()

        assertEquals(ResumePoint("boot-1", 1_795_076_857_467_000_000L), savedPoints["events"])
    }

    @Test
    fun `lines over the limit are dropped and counted in one record`() {
        val lines: String = (0 until 2_005).joinToString("\n") { "         1795076857.${(it % 1000).toString().padStart(3, '0')} 10143  4242  4250 E App: line $it" }
        val logcat: LogcatCollector = collector(sdkInt = 30, textOutput = lines + "\n")
        logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)

        val kept: List<LogRecord> = awaitRecords(2_000)
        Thread.sleep(100)

        assertEquals(2_000, kept.size + buffer.drain().size)
        val dropped: LogRecord? = logcat.takeDroppedLinesRecord()
        assertNotNull(dropped)
        assertEquals(5L, dropped!!.attributes.toMap()["oneuptime.agent.logcat.dropped_lines"])
        assertEquals(Severity.WARN, dropped.severity)
        assertNull(logcat.takeDroppedLinesRecord())
    }

    @Test
    fun `a long message is cut, and a system line has no package`() {
        val line = LogcatLine(1L, "1000", 1, 2, 'E', "Tag", "x".repeat(10_000))
        val record: LogRecord = LogcatCollector.textRecord(line, null, 5L, packages = { "never" })

        assertEquals(LogcatCollector.MAX_MESSAGE_LENGTH + 1, record.body.length)
        assertTrue(record.body.endsWith("…"))
        assertNull(record.attributes.toMap()["android.package.name"])
        assertNull(record.attributes.toMap()["android.log.buffer"])
        assertEquals(5L, record.observedTimeUnixNano)
    }

    @Test
    fun `the commands fall back to simpler forms`() {
        val events: List<(String?) -> List<String>> = LogcatCommands.events()

        assertEquals(3, events.size)
        assertEquals(
            listOf("logcat", "-b", "events", "-v", "threadtime", "-v", "epoch", "-v", "uid", "-v", "printable", "-T", "1.000", "am_crash:I", "am_anr:I", "*:S"),
            events[0]("1.000"),
        )
        assertEquals(listOf("logcat", "-b", "events", "-v", "threadtime", "-v", "epoch", "am_crash:I", "am_anr:I", "*:S"), events[1](null))
        assertEquals(listOf("logcat", "-b", "events", "-v", "threadtime", "am_crash:I", "am_anr:I", "*:S"), events[2]("1.000"))

        assertEquals(
            listOf("logcat", "-b", "main", "-b", "system", "-b", "crash", "-v", "threadtime", "-v", "epoch", "-v", "uid", "-v", "printable", "*:E"),
            LogcatCommands.text(LogcatLevel.ERROR)[0](null),
        )
    }
}
