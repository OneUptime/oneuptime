package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.FakeProcess
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogcatSessionTest {
    private val clock = FakeClock()
    private val launched: MutableList<List<String>> = mutableListOf()
    private val delivered: MutableList<LogcatLine> = mutableListOf()
    private val buffers: MutableList<String?> = mutableListOf()

    private val commands: List<(String?) -> List<String>> =
        listOf(
            { since -> listOf("logcat", "rich") + (since?.let { listOf("-T", it) } ?: emptyList()) },
            { _ -> listOf("logcat", "plain") },
        )

    private fun line(seconds: Long, millis: Int, message: String): String =
        "         $seconds.${millis.toString().padStart(3, '0')}  1000   580   600 I Tag: $message"

    /** A session whose launcher answers each start with the next of [outputs], and that stops after one full run. */
    private fun session(
        outputs: List<() -> Process>,
        resume: ResumePoint? = null,
        bootId: String? = "boot-1",
    ): LogcatSession {
        var next = 0
        lateinit var created: LogcatSession
        created =
            LogcatSession(
                name = "test",
                commands = commands,
                launcher = { command ->
                    launched.add(command)
                    outputs[minOf(next++, outputs.size - 1)]()
                },
                clock = clock,
                currentBootId = { bootId },
                initialResume = resume,
                onEntry = { entry, buffer ->
                    delivered.add(entry)
                    buffers.add(buffer)
                },
                sleeper = { throw InterruptedException() },
            )
        return created
    }

    @Test
    fun `every entry is handed on with the buffer it came from, and the session remembers the last`() {
        val output: String =
            listOf(
                "--------- beginning of main",
                line(1_795_076_850, 1, "first"),
                "--------- switch to system",
                line(1_795_076_851, 2, "second"),
                "not a logcat line",
            ).joinToString("\n")
        val session: LogcatSession = session(listOf({ FakeProcess(output) }))

        session.runLoop()

        assertEquals(listOf("first", "second"), delivered.map { it.message })
        assertEquals(listOf("main", "system"), buffers)
        assertEquals(ResumePoint("boot-1", 1_795_076_851_002_000_000L), session.resumePoint)
        assertEquals(listOf("logcat", "rich"), launched.single())
        assertEquals(2L, session.linesRead)
    }

    @Test
    fun `after a restart in the same boot it resumes after the last entry, and skips any it is given again`() {
        val resume = ResumePoint("boot-1", 1_795_076_851_002_000_000L)
        val output: String =
            listOf(
                line(1_795_076_850, 1, "old"),
                line(1_795_076_851, 2, "last one sent"),
                line(1_795_076_852, 3, "new"),
            ).joinToString("\n")
        val session: LogcatSession = session(listOf({ FakeProcess(output) }), resume = resume)

        session.runLoop()

        assertEquals(listOf("logcat", "rich", "-T", "1795076851.003"), launched.single())
        assertEquals(listOf("new"), delivered.map { it.message })
    }

    @Test
    fun `once a newer entry arrives, an older one is still handed on, as when the clock was set back`() {
        val resume = ResumePoint("boot-1", 1_795_076_851_000_000_000L)
        val output: String =
            listOf(
                line(1_795_076_852, 0, "new"),
                line(1_795_076_800, 0, "after the clock was set back"),
            ).joinToString("\n")

        session(listOf({ FakeProcess(output) }), resume = resume).runLoop()

        assertEquals(listOf("new", "after the clock was set back"), delivered.map { it.message })
    }

    @Test
    fun `after a reboot it reads the whole buffer, which holds only the new boot`() {
        val resume = ResumePoint("boot-1", 1_795_076_851_000_000_000L)
        val output: String = line(1_700_000_000, 0, "stamped before the clock was set").plus("\n")

        session(listOf({ FakeProcess(output) }), resume = resume, bootId = "boot-2").runLoop()

        assertEquals(listOf("logcat", "rich"), launched.single())
        assertEquals(listOf("stamped before the clock was set"), delivered.map { it.message })
    }

    @Test
    fun `a form of the command that prints nothing it can read gives way to the next`() {
        val session: LogcatSession =
            session(
                listOf(
                    { FakeProcess("logcat: Unknown format 'uid'\n", exitCode = 1) },
                    { FakeProcess(line(1_795_076_850, 0, "plain") + "\n") },
                ),
            )

        session.runLoop()

        assertEquals(listOf(listOf("logcat", "rich"), listOf("logcat", "plain")), launched)
        assertEquals(1, session.commandIndex)
        assertEquals(listOf("plain"), delivered.map { it.message })
    }

    @Test
    fun `a command that cannot start gives way to the next too`() {
        val session: LogcatSession =
            session(listOf({ throw IOException("no logcat") }, { FakeProcess(line(1_795_076_850, 0, "ok") + "\n") }))

        session.runLoop()

        assertEquals(2, launched.size)
        assertEquals(listOf("ok"), delivered.map { it.message })
    }

    @Test
    fun `a stopped session destroys its process and does not start again`() {
        val process = FakeProcess("")
        val session: LogcatSession = session(listOf({ process }))
        session.stop()

        session.runLoop()

        assertTrue(launched.isEmpty())
        assertFalse(session.isRunning)
        assertNull(session.resumePoint)
    }

    @Test
    fun `restarts back off from a second to five minutes`() {
        assertEquals(1_000L, LogcatSession.backoffMillis(0))
        assertEquals(2_000L, LogcatSession.backoffMillis(1))
        assertEquals(256_000L, LogcatSession.backoffMillis(8))
        assertEquals(300_000L, LogcatSession.backoffMillis(9))
        assertEquals(300_000L, LogcatSession.backoffMillis(50))
    }

    @Test
    fun `-T is given in Logcat's epoch form, to the millisecond`() {
        assertEquals("1795076857.467", LogcatSession.formatSince(1_795_076_857_467_999_999L))
        assertEquals("1795076857.007", LogcatSession.formatSince(1_795_076_857_007_000_000L))
    }
}
