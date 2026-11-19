package com.oneuptime.androidagent

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oneuptime.androidagent.collect.BootIdParser
import com.oneuptime.androidagent.collect.CpuStatParser
import com.oneuptime.androidagent.collect.LoadAverageParser
import com.oneuptime.androidagent.collect.MemInfoParser
import com.oneuptime.androidagent.collect.MountsParser
import com.oneuptime.androidagent.config.EndpointParser
import com.oneuptime.androidagent.config.EndpointResult
import com.oneuptime.androidagent.config.LabelParser
import com.oneuptime.androidagent.config.ManagedConfigParser
import com.oneuptime.androidagent.config.ManagedSettings
import com.oneuptime.androidagent.device.DefaultDeviceName
import com.oneuptime.androidagent.dropbox.DropBoxDecoder
import com.oneuptime.androidagent.dropbox.DropBoxEntry
import com.oneuptime.androidagent.dropbox.DropBoxFinding
import com.oneuptime.androidagent.dropbox.NativeFrameParser
import com.oneuptime.androidagent.logs.LogcatLineParser
import com.oneuptime.androidagent.logs.LogcatParse
import com.oneuptime.androidagent.logs.LogcatUid
import com.oneuptime.androidagent.logs.Redactor
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/*
 * The JVM runs the unit tests with its own regular expressions; a device
 * runs the agent with ICU's, which refuses some patterns the JVM accepts (a
 * bare "}" crashed the first build at launch). Every parser runs here once,
 * on the device, so no pattern can pass the unit tests and fail on Android.
 */
@RunWith(AndroidJUnit4::class)
class OnDeviceParsersTest {
    @Test
    fun managedConfigurationParsesOnAndroid() {
        val settings: ManagedSettings =
            ManagedConfigParser.parse(mapOf("device_name" to "\${esper.deviceName}", "labels" to "store=0412", "logcat_min_level" to "info"))

        assertNull(settings.deviceName)
        assertEquals(mapOf("store" to "0412"), settings.labels)
        assertEquals(1, settings.problems.size)
    }

    @Test
    fun endpointsAndLabelsParseOnAndroid() {
        assertEquals(
            "https://oneuptime.com/otlp",
            (EndpointParser.parse("https://oneuptime.com/otlp/v1/metrics") as EndpointResult.Valid).endpoint.base,
        )
        assertEquals(listOf("bad name=1"), LabelParser.parse("ok=1, bad name=1").rejected)
        assertEquals("elo-i3-15", DefaultDeviceName.of(com.oneuptime.androidagent.device.DeviceFacts("Elo", "Elo i3 15", "14", 34, "B", "D", null, null, emptyList(), null, 4)))
    }

    @Test
    fun logcatLinesParseOnAndroid() {
        val zone: TimeZone = TimeZone.getTimeZone("UTC")
        val now = 1_795_076_900_000L

        assertTrue(LogcatLineParser.parse("         1795076845.947  root   380   439 I netd    : tetherGetStats()", now, zone) is LogcatParse.Entry)
        assertTrue(LogcatLineParser.parse("1795076845.927   580   974 W OomAdjuster: Not killing", now, zone) is LogcatParse.Entry)
        assertTrue(LogcatLineParser.parse("11-19 08:27:37.467  1000   580  1029 E ActivityManager: ANR", now, zone) is LogcatParse.Entry)
        assertEquals(LogcatParse.Divider("events"), LogcatLineParser.parse("--------- beginning of events", now, zone))
        assertEquals(10143, LogcatUid.appUid("u0_a143"))
    }

    @Test
    fun dropBoxEntriesDecodeOnAndroid() {
        val crash: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "data_app_crash",
                    0L,
                    "Process: com.example.kiosk\nPID: 4321\nPackage: com.example.kiosk v42 (4.2.0)\nForeground: Yes\n\n" +
                        "java.lang.IllegalStateException: Card 4111111111111111 declined\n" +
                        "\tat com.example.kiosk.PaymentFlow.charge(PaymentFlow.kt:88)\n",
                ),
                0L,
            )
        val anr: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "data_app_anr",
                    0L,
                    "Process: com.example.kiosk\nPID: 4321\nSubject: Input dispatching timed out\n\n" +
                        "\"main\" prio=5 tid=1 Sleeping\n  at com.example.kiosk.MainActivity.onClick(MainActivity.kt:42)\n\n",
                ),
                0L,
            )
        val native: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "data_app_native_crash",
                    0L,
                    "Process: com.example.kiosk\nPID: 4321\n\n*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n" +
                        "pid: 4321, tid: 4350, name: PrinterThread  >>> com.example.kiosk <<<\n" +
                        "signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000010\n" +
                        "backtrace:\n" +
                        "      #00 pc 000000000005a4c4  /data/app/~~Zh3x==/com.example.kiosk-Ab1==/lib/x86_64/libprinter.so (print_job(Job*)+52) (BuildId: 1a2b3c)\n",
                ),
                0L,
            )
        val tombstone: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "SYSTEM_TOMBSTONE",
                    0L,
                    "isPrevious: true\n\n*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n" +
                        "pid: 812, tid: 812, name: printer-service  >>> /vendor/bin/hw/android.hardware.printer-service <<<\n" +
                        "signal 6 (SIGABRT), code -1 (SI_QUEUE), fault addr --------\n" +
                        "Abort message: 'Check failed: fd >= 0'\n" +
                        "backtrace:\n" +
                        "      #00 pc 0000000000068c4f  /apex/com.android.runtime/lib64/bionic/libc.so (abort+191) (BuildId: aa)\n" +
                        "      #01 pc 0000000000012345  /vendor/lib64/libprinterhal.so (PrinterHal::open()+77) (BuildId: bb)\n",
                ),
                0L,
            )
        val boot: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "SYSTEM_LAST_KMSG",
                    0L,
                    "isPrevious: true\n\n[[TRUNCATED]]\n" +
                        "[ 8812.200100] Kernel panic - not syncing: Fatal exception in interrupt\n\n" +
                        "Boot info:\nLast boot reason: kernel_panic\n",
                ),
                0L,
            )

        assertTrue(crash is DropBoxFinding.Fault)
        assertTrue(anr is DropBoxFinding.Fault)
        assertEquals(4321L, (native as DropBoxFinding.Fault).nativeCrashPid)
        assertTrue(tombstone is DropBoxFinding.Fault)
        assertEquals("kernel_panic", (boot as DropBoxFinding.Boot).kernelLog!!.bootReason)
        assertEquals("libprinter.so", NativeFrameParser.parse("      #00 pc 000000000005a4c4  /data/app/x/lib/x86_64/libprinter.so (f+52) (BuildId: 1a)")!!.libraryName)
    }

    @Test
    fun secretsAreRedactedOnAndroid() {
        assertEquals("Declined [card number] for [email]", Redactor.redact("Declined 4111111111111111 for jane@example.com"))
        assertEquals("Authorization: Bearer [credential]", Redactor.redact("Authorization: Bearer abcdefghijklmnop"))
        assertEquals("password=[redacted]&user=7", Redactor.redact("password=hunter2&user=7"))
        assertEquals("order 4111111111111112", Redactor.redact("order 4111111111111112"))
    }

    @Test
    fun kernelFilesParseOnAndroid() {
        assertEquals(1024L, MemInfoParser.parse("MemTotal: 1 kB\nActive(anon): 2 kB")["MemTotal"])
        assertEquals(1, CpuStatParser.parse("cpu0 1 2 3 4 5 6 7 8").size)
        assertEquals(0.5, LoadAverageParser.parse("0.5 0.4 0.3 1/2 3")!!.oneMinute, 0.0)
        assertEquals("/a b", MountsParser.parse("/dev/x /a\\040b ext4 rw 0 0").single().mountpoint)
        assertEquals("e7a7ab81-d18d-41ea-9dbb-27082631f948", BootIdParser.parse("e7a7ab81-d18d-41ea-9dbb-27082631f948"))
    }
}
