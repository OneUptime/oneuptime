package com.oneuptime.androidagent.dropbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DropBoxParsersTest {
    @Test
    fun `headers are read up to the blank line, and the body is what follows`() {
        val headers: DropBoxHeaders = DropBoxHeaderParser.parse(DropBoxFixtures.JAVA_CRASH)

        assertEquals("com.example.kiosk", headers["Process"])
        assertEquals("4321", headers["PID"])
        assertEquals("2", headers["Dropped-Count"])
        assertNull(headers["Missing"])
        assertTrue(headers.body.startsWith("java.lang.IllegalStateException"))
    }

    @Test
    fun `a body that starts with a line looking like a header is still body after the blank line`() {
        val headers: DropBoxHeaders = DropBoxHeaderParser.parse("Process: a\n\nCause: something\nmore")

        assertEquals("a", headers["Process"])
        assertNull(headers["Cause"])
        assertEquals("Cause: something\nmore", headers.body)
    }

    @Test
    fun `an entry without headers is all body`() {
        val headers: DropBoxHeaders = DropBoxHeaderParser.parse("*** *** ***\npid: 1, tid: 1")

        assertTrue(headers.values.isEmpty())
        assertTrue(headers.body.startsWith("*** *** ***"))
    }

    @Test
    fun `the process an ActivityManager entry is about`() {
        val process: DropBoxProcess = DropBoxProcessParser.parse(DropBoxHeaderParser.parse(DropBoxFixtures.JAVA_CRASH))!!

        assertEquals("com.example.kiosk", process.processName)
        assertEquals(4321L, process.pid)
        assertEquals(10190L, process.uid)
        assertEquals("com.example.kiosk", process.packageName)
        assertEquals("4.2.0", process.versionName)
        assertEquals(true, process.foreground)
        assertEquals(2L, process.droppedCount)
    }

    @Test
    fun `a process with a colon is its package's, and an entry with no process has none`() {
        val process: DropBoxProcess = DropBoxProcessParser.parse(DropBoxHeaderParser.parse("Process: com.example.kiosk:printer\nForeground: No\n\n"))!!

        assertEquals("com.example.kiosk", process.packageName)
        assertEquals(false, process.foreground)
        assertNull(process.versionName)
        assertNull(DropBoxProcessParser.parse(DropBoxHeaderParser.parse("Build: x\n\n")))
    }

    @Test
    fun `a Java crash's exception and stack stop where the logcat lines Android appends begin`() {
        val body: String = DropBoxHeaderParser.parse(DropBoxFixtures.JAVA_CRASH).body
        val throwable: JavaThrowable = JavaStackParser.parse(body, 32 * 1024)!!

        assertEquals("java.lang.IllegalStateException", throwable.type)
        assertEquals("Card 4111111111111111 declined for jane@example.com", throwable.message)
        assertTrue(throwable.stackTrace.contains("Caused by: java.io.IOException: terminal offline"))
        assertTrue(throwable.stackTrace.endsWith("\t... 3 more"))
        assertFalse(throwable.stackTrace.contains("SomeOtherApp"))
    }

    @Test
    fun `an exception with no message, a long stack cut short, and a body that is no exception`() {
        val bare: JavaThrowable = JavaStackParser.parse("java.lang.NullPointerException\n\tat a.B.c(B.java:1)", 1024)!!
        assertEquals("java.lang.NullPointerException", bare.type)
        assertEquals("", bare.message)

        val long: String = "java.lang.Error: deep\n" + (1..2000).joinToString("\n") { "\tat a.B.c$it(B.java:$it)" }
        val cut: JavaThrowable = JavaStackParser.parse(long, 4096)!!
        assertTrue(cut.stackTrace.length <= 4096 + JavaStackParser.TRUNCATED.length)
        assertTrue(cut.stackTrace.endsWith(JavaStackParser.TRUNCATED))

        assertNull(JavaStackParser.parse("not an exception at all", 1024))
        assertNull(JavaStackParser.parse("", 1024))
    }

    @Test
    fun `a Java crash named in any script's letters is read, here as on a device`() {
        // Android's \w read a name's Cyrillic letters and the JVM's did not, so this crash was parsed on a device alone (#10876).
        val cyrillic: JavaThrowable = JavaStackParser.parse("com.example.Ошибка: Платёж отклонён\n\tat com.example.Касса.оплата(Касса.kt:7)", 1024)!!
        assertEquals("com.example.Ошибка", cyrillic.type)
        assertEquals("Платёж отклонён", cyrillic.message)
        // A package in another script, a nested class's "$", an "_", a digit and a currency sign: what Java lets in a name.
        assertEquals("例え.パッケージ.エラー\$内部", JavaStackParser.parse("例え.パッケージ.エラー\$内部: x", 1024)!!.type)
        assertEquals("a.b_c.D1\$€", JavaStackParser.parse("a.b_c.D1\$€", 1024)!!.type)
        // No package, or a space in the name: no Java class's.
        assertNull(JavaStackParser.parse("Ошибка: x", 1024))
        assertNull(JavaStackParser.parse("com.example.My Error: x", 1024))
    }

    @Test
    fun `an exception's message and an abort's are read whole, whatever character they hold`() {
        // Android's "." took no vertical tab or form feed and the JVM's took both, and neither took the other three, so such
        // a crash was dropped (#10876).
        for (inside in listOf("\u000B", "\u000C", "\u0085", "\u2028", "\u2029")) {
            val name: String = "U+%04X".format(inside[0].code)
            val throwable: JavaThrowable = JavaStackParser.parse("java.lang.IllegalStateException: before${inside}after\n\tat a.B.c(B.java:1)", 1024)!!
            assertEquals(name, "before${inside}after", throwable.message)
            val crash: NativeCrash = TombstoneParser.parse(DropBoxFixtures.TOMBSTONE.replace("Check failed: fd", "Check failed:${inside}fd"))!!
            assertEquals(name, "Check failed:${inside}fd >= 0 token=abc123 (fd=-1)", crash.abortMessage)
        }
    }


    @Test
    fun `the main thread's stack is found among an ANR's threads`() {
        val body: String = DropBoxHeaderParser.parse(DropBoxFixtures.ANR).body
        val main: String = ThreadTraceParser.thread(body, "main", 32 * 1024)!!

        assertTrue(main.startsWith("\"main\" prio=5 tid=1 Sleeping"))
        assertTrue(main.contains("at com.example.kiosk.MainActivity.onClick(MainActivity.kt:42)"))
        assertFalse(main.contains("RenderThread"))
        assertFalse(main.contains("Signal Catcher"))
        assertNull(ThreadTraceParser.thread(body, "nonexistent", 1024))
    }

    @Test
    fun `a thread's header is read alike on a device and here, whatever script its name is in`() {
        val body =
            "\"主线程\" prio=5 tid=1 Native\n  at a.B.c(B.java:1)\n\n" +
                "\"worker\" prio=5 utid=7 Native\n  at d.E.f(E.java:2)\n\n" +
                "\"x\" prio=5 线程tid=9 Native\n  at g.H.i(H.java:3)\n"

        assertTrue(ThreadTraceParser.thread(body, "主线程", 1024)!!.startsWith("\"主线程\" prio=5 tid=1 Native"))
        // An ASCII letter runs into "tid=": no thread's id.
        assertNull(ThreadTraceParser.thread(body, "worker", 1024))
        // A letter of another script does not, as on the JVM: Android's own \b once said it did (#10835).
        assertTrue(ThreadTraceParser.thread(body, "x", 1024)!!.contains("at g.H.i(H.java:3)"))
    }

    @Test
    fun `a native crash's signal, cause and the crashing thread's backtrace`() {
        val crash: NativeCrash = TombstoneParser.parse(DropBoxFixtures.NATIVE_CRASH)!!

        assertEquals("com.example.kiosk", crash.processName)
        assertEquals("PrinterThread", crash.threadName)
        assertEquals(4321L, crash.pid)
        assertEquals(4350L, crash.tid)
        assertEquals("SIGSEGV", crash.signalName)
        assertEquals(11, crash.signalNumber)
        assertEquals("SEGV_MAPERR", crash.code)
        assertEquals("0x0000000000000010", crash.faultAddress)
        assertEquals("null pointer dereference", crash.cause)
        assertNull(crash.abortMessage)
        assertEquals(3, crash.frames.size)
        assertEquals("libprinter.so (print_job(Job*)+52)", crash.topFrame!!.label)
    }

    @Test
    fun `a tombstone's report leaves out registers and memory`() {
        val crash: NativeCrash = TombstoneParser.parse(DropBoxFixtures.NATIVE_CRASH)!!
        val report: String = crash.report(32 * 1024)

        assertTrue(report.contains("signal 11 (SIGSEGV), code SEGV_MAPERR, fault addr 0x0000000000000010"))
        assertTrue(report.contains("Cause: null pointer dereference"))
        assertTrue(report.contains("#00 pc 000000000005a4c4"))
        assertFalse(report.contains("rax"))
        assertFalse(report.contains("memory near"))
    }

    @Test
    fun `an abort's message, and only the crashing thread's frames`() {
        val crash: NativeCrash = TombstoneParser.parse(DropBoxFixtures.TOMBSTONE)!!

        assertEquals("/vendor/bin/hw/android.hardware.printer-service", crash.processName)
        assertEquals("SIGABRT", crash.signalName)
        assertEquals("SI_QUEUE", crash.code)
        assertNull(crash.faultAddress)
        assertEquals("Check failed: fd >= 0 token=abc123 (fd=-1)", crash.abortMessage)
        assertEquals(2, crash.frames.size)
        // abort() is Android's; the first frame of the vendor's own library is the one that names it.
        assertEquals("/apex/com.android.runtime/lib64/bionic/libc.so", NativeFrameParser.parse(crash.frames[0])!!.library)
        assertEquals("libprinterhal.so (PrinterHal::open()+77)", crash.topFrame!!.label)
    }

    @Test
    fun `native frames, the function, an APK's offset, a frame without one`() {
        val apk: NativeFrame =
            NativeFrameParser.parse(
                "#01 pc 0000000000039b70  /data/app/~~Zh3x==/com.example.kiosk-Ab1==/base.apk!libbridge.so (offset 0x1f000) (Java_com_example_Printer_print+40) (BuildId: 4d5e)",
            )!!
        assertEquals(1, apk.index)
        assertEquals("base.apk!libbridge.so", apk.libraryName)
        assertEquals("Java_com_example_Printer_print+40", apk.function)
        assertFalse(apk.isSystemLibrary)

        val bare: NativeFrame = NativeFrameParser.parse("#05 pc 00000000000abcde  /system/lib64/libc.so")!!
        assertNull(bare.function)
        assertEquals("libc.so", bare.label)
        assertTrue(bare.isSystemLibrary)

        assertNull(NativeFrameParser.parse("not a frame"))
    }

    @Test
    fun `text without a signal or a backtrace is no native crash`() {
        assertNull(TombstoneParser.parse("Process: x\n\nnothing here"))
    }

    @Test
    fun `the kernel's last log has the reboot's reason, its panic and its last lines`() {
        val log: LastKernelLog = LastKernelLogParser.parse(DropBoxFixtures.LAST_KERNEL_LOG, 30)

        assertEquals("kernel_panic", log.bootReason)
        assertEquals("Kernel panic - not syncing: Fatal exception in interrupt", log.panic)
        assertEquals(4, log.lastLines.size)
        assertTrue(log.lastLines.last().contains("Comm: swapper/2"))
        assertFalse(log.lastLines.any { it.contains("[[TRUNCATED]]") || it.contains("Last boot reason") })
    }

    @Test
    fun `a kernel log without a footer or a panic, and only its last lines`() {
        val text: String = "isPrevious: true\n\n" + (1..100).joinToString("\n") { "[ $it.000] line $it" }
        val log: LastKernelLog = LastKernelLogParser.parse(text, 30)

        assertNull(log.bootReason)
        assertNull(log.panic)
        assertEquals(30, log.lastLines.size)
        assertEquals("[ 100.000] line 100", log.lastLines.last())
        assertNotNull(LastKernelLogParser.parse("", 30))
    }
}
