package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EventLogDecoderTest {
    private val observed: Long = 1_795_076_900_000_000_000L

    private fun line(tag: String, message: String): LogcatLine =
        LogcatLine(
            timeUnixNano = 1_795_076_857_467_000_000L,
            uid = "1000",
            pid = 580,
            tid = 1029,
            priority = 'I',
            tag = tag,
            message = message,
        )

    private fun decode(tag: String, message: String): LogRecord? = EventLogDecoder.decode(line(tag, message), observed)

    @Test
    fun `a crash, as Android 15 logs it, is an unhandled exception of the app that crashed`() {
        // Captured with `am crash com.android.settings` on the Android 15 emulator.
        val record: LogRecord =
            decode(
                "am_crash",
                "[1179,0,com.android.settings,952876613,android.app.RemoteServiceException\$CrashedByAdbException,shell-induced crash,ActivityThread.java,2257,0]",
            )!!
        val attributes: Map<String, Any> = record.attributes.toMap()

        assertEquals(Severity.FATAL, record.severity)
        assertEquals(1_795_076_857_467_000_000L, record.timeUnixNano)
        assertEquals(observed, record.observedTimeUnixNano)
        assertEquals(
            "com.android.settings crashed: android.app.RemoteServiceException\$CrashedByAdbException: shell-induced crash",
            record.body,
        )
        assertEquals("app.crash", attributes["event.name"])
        assertEquals("android.app.RemoteServiceException\$CrashedByAdbException", attributes["exception.type"])
        assertEquals("com.android.settings: shell-induced crash", attributes["exception.message"])
        assertEquals(true, attributes["exception.escaped"])
        assertEquals("com.android.settings", attributes["android.package.name"])
        assertEquals("com.android.settings", attributes["android.process.name"])
        assertEquals(1179L, attributes["process.pid"])
        assertEquals("ActivityThread.java", attributes["code.file.path"])
        assertEquals(2257L, attributes["code.line.number"])
        assertEquals("am_crash", attributes["android.log.tag"])
    }

    @Test
    fun `a crash as Android 13 and earlier log it, without the recoverable flag`() {
        val attributes: Map<String, Any> =
            decode("am_crash", "[4242,0,com.example.kiosk:payments,550026820,java.lang.IllegalStateException,Printer offline,Printer.kt,88]")!!
                .attributes.toMap()

        assertEquals("java.lang.IllegalStateException", attributes["exception.type"])
        assertEquals("com.example.kiosk:payments: Printer offline", attributes["exception.message"])
        assertEquals("com.example.kiosk", attributes["android.package.name"])
        assertEquals("com.example.kiosk:payments", attributes["android.process.name"])
        assertEquals("Printer.kt", attributes["code.file.path"])
        assertEquals(88L, attributes["code.line.number"])
    }

    @Test
    fun `a message with commas in it is kept whole, in either form`() {
        val older: Map<String, Any> =
            decode("am_crash", "[1,0,com.example,0,java.lang.RuntimeException,a, b, and c,Main.java,7]")!!.attributes.toMap()
        val newer: Map<String, Any> =
            decode("am_crash", "[1,0,com.example,0,java.lang.RuntimeException,a, b, and c,Main.java,7,0]")!!.attributes.toMap()

        assertEquals("com.example: a, b, and c", older["exception.message"])
        assertEquals("com.example: a, b, and c", newer["exception.message"])
        assertEquals("Main.java", newer["code.file.path"])
    }

    @Test
    fun `a recoverable crash is an error rather than fatal`() {
        assertEquals(
            Severity.ERROR,
            decode("am_crash", "[1,0,com.example,0,java.lang.RuntimeException,boom,Main.java,7,1]")!!.severity,
        )
    }

    @Test
    fun `a crash with no message says the app crashed, and a file Android did not know is left out`() {
        val attributes: Map<String, Any> =
            decode("am_crash", "[1,0,com.example,0,java.lang.NullPointerException,,null,0,0]")!!.attributes.toMap()

        assertEquals("com.example crashed", attributes["exception.message"])
        assertNull(attributes["code.file.path"])
        assertNull(attributes["code.line.number"])
    }

    @Test
    fun `an ANR is an exception named ANR, grouped by what kind it was`() {
        val record: LogRecord =
            decode(
                "am_anr",
                "[0,8123,com.example.kiosk,550026820,Input dispatching timed out (8b3b1a2 com.example.kiosk/.MainActivity (server) is not responding. Waited 5001ms for FocusEvent(hasFocus=true))]",
            )!!
        val attributes: Map<String, Any> = record.attributes.toMap()

        assertEquals(Severity.ERROR, record.severity)
        assertEquals("device.anr", attributes["event.name"])
        assertEquals("ANR", attributes["exception.type"])
        assertEquals("com.example.kiosk: Input dispatching timed out", attributes["exception.message"])
        assertEquals(true, attributes["exception.escaped"])
        assertEquals(8123L, attributes["process.pid"])
        assertEquals("com.example.kiosk", attributes["android.package.name"])
        assertEquals(
            "Input dispatching timed out (8b3b1a2 com.example.kiosk/.MainActivity (server) is not responding. Waited 5001ms for FocusEvent(hasFocus=true))",
            attributes["android.anr.reason"],
        )
        assertEquals(
            "com.example.kiosk is not responding: Input dispatching timed out (8b3b1a2 com.example.kiosk/.MainActivity (server) is not responding. Waited 5001ms for FocusEvent(hasFocus=true))",
            record.body,
        )
    }

    @Test
    fun `an ANR whose reason has commas keeps it whole`() {
        val attributes: Map<String, Any> =
            decode("am_anr", "[0,8123,com.example.kiosk,0,executing service com.example/.Sync, started 20s ago]")!!.attributes.toMap()

        assertEquals("executing service com.example/.Sync, started 20s ago", attributes["android.anr.reason"])
    }

    @Test
    fun `an ANR with no reason still counts`() {
        val attributes: Map<String, Any> = decode("am_anr", "[0,8123,com.example.kiosk,0,]")!!.attributes.toMap()

        assertEquals("com.example.kiosk: Application Not Responding", attributes["exception.message"])
    }

    @Test
    fun `other events and malformed lists are not decoded`() {
        assertNull(decode("am_proc_died", "[0,996,WebViewLoader-x86_64,-700,0]"))
        assertNull(decode("am_crash", "not a list"))
        assertNull(decode("am_crash", "[1,0,com.example]"))
        assertNull(decode("am_crash", "[1,0,,0,java.lang.RuntimeException,boom,Main.java,7]"))
        assertNull(decode("am_anr", "[0,8123]"))
        assertNull(decode("am_anr", "[0,8123,,0,reason]"))
    }

    @Test
    fun `it decodes the two tags the agent asks Logcat for`() {
        assertEquals(listOf("am_crash", "am_anr"), EventLogDecoder.TAGS)
    }
}
