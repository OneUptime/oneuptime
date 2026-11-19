package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.otlp.Severity
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/*
 * The lines are real: printed by `logcat -v threadtime -v epoch -v uid -v printable`
 * on the Android 15 emulator, which is what the agent runs.
 */
class LogcatLineParserTest {
    private val now: Long = 1_795_076_900_000L
    private val utc: TimeZone = TimeZone.getTimeZone("UTC")

    private fun entry(raw: String, zone: TimeZone = utc): LogcatLine =
        (LogcatLineParser.parse(raw, now, zone) as LogcatParse.Entry).line

    @Test
    fun `an epoch line with a numeric uid`() {
        val line: LogcatLine =
            entry(
                "         1795076843.458 10143  1288  1288 D BoundBrokerSvc: onUnbind: Intent { act=com.google.android.gms.clearcut.service.START }",
            )

        assertEquals(1_795_076_843_458_000_000L, line.timeUnixNano)
        assertEquals("10143", line.uid)
        assertEquals(1288, line.pid)
        assertEquals(1288, line.tid)
        assertEquals('D', line.priority)
        assertEquals("BoundBrokerSvc", line.tag)
        assertEquals("onUnbind: Intent { act=com.google.android.gms.clearcut.service.START }", line.message)
        assertEquals(Severity.DEBUG, line.severity)
    }

    @Test
    fun `a uid Logcat prints by name, and a padded short tag`() {
        val line: LogcatLine = entry("         1795076845.947  root   380   439 I netd    : tetherGetStats() -> {[]} <0.39ms>")

        assertEquals("root", line.uid)
        assertEquals("netd", line.tag)
        assertEquals("tetherGetStats() -> {[]} <0.39ms>", line.message)
    }

    @Test
    fun `an events-buffer line keeps its list as the message`() {
        val line: LogcatLine =
            entry(
                "         1795076857.467  1000   580  1029 I am_crash: [1179,0,com.android.settings,952876613,android.app.RemoteServiceException\$CrashedByAdbException,shell-induced crash,ActivityThread.java,2257,0]",
            )

        assertEquals("am_crash", line.tag)
        assertEquals(
            "[1179,0,com.android.settings,952876613,android.app.RemoteServiceException\$CrashedByAdbException,shell-induced crash,ActivityThread.java,2257,0]",
            line.message,
        )
    }

    @Test
    fun `an epoch line without a uid, from a Logcat that does not know -v uid`() {
        val line: LogcatLine = entry("1795076845.927   580   974 W OomAdjuster: Not killing cached processes")

        assertNull(line.uid)
        assertEquals(580, line.pid)
        assertEquals(974, line.tid)
        assertEquals(Severity.WARN, line.severity)
    }

    @Test
    fun `microseconds are kept`() {
        assertEquals(1_795_076_845_927_123_000L, entry("1795076845.927123   580   974 I Tag: m").timeUnixNano)
    }

    @Test
    fun `the plain local-time form is read in the device's time zone and this year`() {
        // now is 2026-11-19 in UTC.
        val line: LogcatLine = entry("11-19 08:27:37.467   580  1029 E ActivityManager: ANR in com.example.kiosk")

        assertEquals(1_795_076_857_467_000_000L, line.timeUnixNano)
        assertNull(line.uid)
        assertEquals("ActivityManager", line.tag)
        assertEquals(Severity.ERROR, line.severity)

        val withUid: LogcatLine = entry("11-19 08:27:37.467  1000   580  1029 E ActivityManager: ANR in com.example.kiosk")
        assertEquals("1000", withUid.uid)
        assertEquals(580, withUid.pid)
    }

    @Test
    fun `a December line read in January is from last year`() {
        val january: Long = 1_799_020_800_000L // 2027-01-04 00:00 UTC
        val line: LogcatLine = (LogcatLineParser.parse("12-31 23:59:59.000   1   1 I Tag: m", january, utc) as LogcatParse.Entry).line

        assertEquals(1_798_761_599_000_000_000L, line.timeUnixNano) // 2026-12-31 23:59:59 UTC
    }

    @Test
    fun `the local-time form follows the device's zone`() {
        val line: LogcatLine = entry("11-19 09:27:37.467   580  1029 I Tag: m", TimeZone.getTimeZone("Europe/Berlin"))

        assertEquals(1_795_076_857_467_000_000L, line.timeUnixNano)
    }

    @Test
    fun `a line with an empty message, and a message with colons`() {
        assertEquals("", entry("1795076845.927   580   974 I Tag:").message)
        assertEquals("Tag", entry("1795076845.927   580   974 I Tag: ").tag)
        assertEquals("a: b: c", entry("1795076845.927   580   974 I Tag: a: b: c").message)
    }

    @Test
    fun `buffer dividers name the buffer`() {
        assertEquals(LogcatParse.Divider("main"), LogcatLineParser.parse("--------- beginning of main", now, utc))
        assertEquals(LogcatParse.Divider("system"), LogcatLineParser.parse("--------- switch to system", now, utc))
    }

    @Test
    fun `anything else is unrecognized`() {
        listOf("", "logcat: Unknown format 'uid'", "\tat com.example.Foo.bar(Foo.java:1)", "1795076845.927 580 974 X Tag: m")
            .forEach { assertEquals(it, LogcatParse.Unrecognized, LogcatLineParser.parse(it, now, utc)) }
    }

    @Test
    fun `each priority has its OpenTelemetry severity`() {
        assertEquals(
            listOf(Severity.TRACE, Severity.DEBUG, Severity.INFO, Severity.WARN, Severity.ERROR, Severity.FATAL, Severity.FATAL),
            listOf('V', 'D', 'I', 'W', 'E', 'F', 'A').map { LogcatLineParser.severityOf(it) },
        )
    }

    @Test
    fun `an app's uid is read whichever way Logcat prints it, and the system's uids are none`() {
        assertEquals(10143, LogcatUid.appUid("10143"))
        assertEquals(10143, LogcatUid.appUid("u0_a143"))
        assertEquals(1_010_123, LogcatUid.appUid("u10_a123"))
        assertNull(LogcatUid.appUid("1000"))
        assertNull(LogcatUid.appUid("root"))
        assertNull(LogcatUid.appUid("system"))
        assertNull(LogcatUid.appUid(null))
    }
}
