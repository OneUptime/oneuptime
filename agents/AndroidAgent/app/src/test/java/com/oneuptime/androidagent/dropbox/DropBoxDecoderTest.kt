package com.oneuptime.androidagent.dropbox

import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DropBoxDecoderTest {
    private val time: Long = 1_795_000_000_000L
    private val observed: Long = 1_795_000_060_000_000_000L

    private fun fault(tag: String, text: String): DropBoxFinding.Fault =
        DropBoxDecoder.decode(DropBoxEntry(tag, time, text), observed) as DropBoxFinding.Fault

    @Test
    fun `an app's crash is an unhandled exception with its whole stack, its secrets taken out`() {
        val record: LogRecord = fault("data_app_crash", DropBoxFixtures.JAVA_CRASH).record
        val attributes: Map<String, Any> = record.attributes.toMap()

        assertEquals(time * 1_000_000L, record.timeUnixNano)
        assertEquals(observed, record.observedTimeUnixNano)
        assertEquals(Severity.FATAL, record.severity)
        assertEquals("app.crash", attributes["event.name"])
        assertEquals("java.lang.IllegalStateException", attributes["exception.type"])
        assertEquals("com.example.kiosk: Card [card number] declined for [email]", attributes["exception.message"])
        assertEquals(true, attributes["exception.escaped"])
        val stack: String = attributes["exception.stacktrace"] as String
        assertTrue(stack.startsWith("java.lang.IllegalStateException: Card [card number] declined for [email]"))
        assertTrue(stack.contains("at com.example.kiosk.PaymentFlow.charge(PaymentFlow.kt:88)"))
        assertFalse(stack.contains("4111111111111111"))
        assertFalse(record.body.contains("jane@example.com"))
        assertEquals("com.example.kiosk", attributes["android.package.name"])
        assertEquals("com.example.kiosk", attributes["android.process.name"])
        assertEquals("4.2.0", attributes["android.package.version"])
        assertEquals(4321L, attributes["process.pid"])
        assertEquals(true, attributes["android.app.foreground"])
        assertEquals(2L, attributes["android.dropbox.dropped_count"])
        assertEquals("data_app_crash", attributes["android.dropbox.tag"])
    }

    @Test
    fun `a system app's and the system server's crashes are read the same way`() {
        val system: Map<String, Any> = fault("system_app_crash", DropBoxFixtures.JAVA_CRASH).record.attributes.toMap()
        assertEquals("system_app_crash", system["android.dropbox.tag"])

        val server: Map<String, Any> =
            fault("system_server_crash", "Build: x\n\njava.lang.RuntimeException: boom\n\tat com.android.server.X.y(X.java:1)").record.attributes.toMap()
        assertEquals("system_server", server["android.process.name"])
        assertEquals("system_server: boom", server["exception.message"])
    }

    @Test
    fun `an ANR is filed as one, with the main thread's stack and the reason`() {
        val record: LogRecord = fault("data_app_anr", DropBoxFixtures.ANR).record
        val attributes: Map<String, Any> = record.attributes.toMap()

        assertEquals(Severity.ERROR, record.severity)
        assertEquals("device.anr", attributes["event.name"])
        assertEquals("ANR", attributes["exception.type"])
        assertEquals("com.example.kiosk: Input dispatching timed out", attributes["exception.message"])
        val stack: String = attributes["exception.stacktrace"] as String
        assertTrue(stack.startsWith("\"main\" prio=5 tid=1 Sleeping"))
        assertTrue(stack.contains("MainActivity.onClick(MainActivity.kt:42)"))
        assertFalse(stack.contains("RenderThread"))
        assertTrue((attributes["android.anr.reason"] as String).startsWith("Input dispatching timed out"))
        assertTrue(record.body.startsWith("com.example.kiosk is not responding: Input dispatching timed out"))
    }

    @Test
    fun `a native crash is named by its signal and where in the app's own code it crashed`() {
        val finding: DropBoxFinding.Fault = fault("data_app_native_crash", DropBoxFixtures.NATIVE_CRASH)
        val attributes: Map<String, Any> = finding.record.attributes.toMap()

        assertEquals(4321L, finding.nativeCrashPid)
        assertEquals("app.crash", attributes["event.name"])
        assertEquals("SIGSEGV", attributes["exception.type"])
        // No fault address: it differs on every crash, and the message is what groups these.
        assertEquals("com.example.kiosk: SIGSEGV (SEGV_MAPERR) in libprinter.so (print_job(Job*)+52)", attributes["exception.message"])
        assertTrue((attributes["exception.stacktrace"] as String).contains("backtrace:"))
        assertEquals("PrinterThread", attributes["thread.name"])
        assertEquals(4350L, attributes["thread.id"])
        assertEquals("4.2.0", attributes["android.package.version"])
        assertEquals("SEGV_MAPERR", attributes["android.native.code"])
    }

    @Test
    fun `a daemon's tombstone names its process, and its abort message is redacted`() {
        val finding: DropBoxFinding.Fault = fault("SYSTEM_TOMBSTONE", DropBoxFixtures.TOMBSTONE)
        val attributes: Map<String, Any> = finding.record.attributes.toMap()

        assertEquals(812L, finding.nativeCrashPid)
        assertEquals("SIGABRT", attributes["exception.type"])
        assertEquals(
            "/vendor/bin/hw/android.hardware.printer-service: SIGABRT in libprinterhal.so (PrinterHal::open()+77): Check failed: fd >= 0 token=[redacted] (fd=-1)",
            attributes["exception.message"],
        )
        assertEquals("/vendor/bin/hw/android.hardware.printer-service", attributes["android.process.name"])
        // A path is no package.
        assertNull(attributes["android.package.name"])
        assertFalse((attributes["exception.stacktrace"] as String).contains("abc123"))
    }

    @Test
    fun `the system server hanging is an exception with the blocked thread's stack`() {
        val record: LogRecord = fault("system_server_watchdog", DropBoxFixtures.WATCHDOG).record
        val attributes: Map<String, Any> = record.attributes.toMap()

        assertEquals("device.watchdog", attributes["event.name"])
        assertEquals("Watchdog", attributes["exception.type"])
        assertTrue((attributes["exception.message"] as String).startsWith("system_server: Blocked in handler on foreground thread (android.fg)"))
        assertTrue((attributes["exception.stacktrace"] as String).startsWith("\"android.fg\" prio=5 tid=31 Blocked"))
    }

    @Test
    fun `the system server restarting is an event, not an exception`() {
        val finding: DropBoxFinding = DropBoxDecoder.decode(DropBoxEntry("SYSTEM_RESTART", time, DropBoxFixtures.SYSTEM_RESTART), observed)!!
        val record: LogRecord = (finding as DropBoxFinding.Event).record

        assertEquals(Severity.WARN, record.severity)
        assertEquals("device.system_restart", record.attributes.toMap()["event.name"])
        assertNull(record.attributes.toMap()["exception.type"])
    }

    @Test
    fun `a boot's entries say a boot happened, and the kernel's last log why the one before ended`() {
        val boot = DropBoxDecoder.decode(DropBoxEntry("SYSTEM_BOOT", time, DropBoxFixtures.SYSTEM_BOOT), observed) as DropBoxFinding.Boot
        assertEquals(time, boot.timeMillis)
        assertNull(boot.kernelLog)

        val kmsg = DropBoxDecoder.decode(DropBoxEntry("SYSTEM_LAST_KMSG", time, DropBoxFixtures.LAST_KERNEL_LOG), observed) as DropBoxFinding.Boot
        assertEquals("kernel_panic", kmsg.kernelLog!!.bootReason)
    }

    @Test
    fun `an entry that cannot be read, or of a tag the agent does not read, is nothing`() {
        assertNull(DropBoxDecoder.decode(DropBoxEntry("data_app_crash", time, "Process: x\n\nnot a stack"), observed))
        assertNull(DropBoxDecoder.decode(DropBoxEntry("data_app_native_crash", time, "Process: x\n\nno signal"), observed))
        assertNull(DropBoxDecoder.decode(DropBoxEntry("netstats", time, "whatever"), observed))
        assertNull(DropBoxDecoder.decode(DropBoxEntry("data_app_crash", time, "java.lang.Error: no headers"), observed))
    }

    @Test
    fun `every tag read has a span, the kernel's log read from its end`() {
        DropBoxTags.ALL.forEach { tag -> assertTrue(tag, DropBoxTags.spanOf(tag) != null) }
        assertTrue(DropBoxTags.spanOf("SYSTEM_LAST_KMSG")!!.fromEnd)
        assertFalse(DropBoxTags.spanOf("data_app_crash")!!.fromEnd)
        assertNull(DropBoxTags.spanOf("SYSTEM_TOMBSTONE_PROTO_WITH_HEADERS"))
    }
}
