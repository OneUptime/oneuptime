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
import com.oneuptime.androidagent.logs.LogcatLineParser
import com.oneuptime.androidagent.logs.LogcatParse
import com.oneuptime.androidagent.logs.LogcatUid
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
    fun kernelFilesParseOnAndroid() {
        assertEquals(1024L, MemInfoParser.parse("MemTotal: 1 kB\nActive(anon): 2 kB")["MemTotal"])
        assertEquals(1, CpuStatParser.parse("cpu0 1 2 3 4 5 6 7 8").size)
        assertEquals(0.5, LoadAverageParser.parse("0.5 0.4 0.3 1/2 3")!!.oneMinute, 0.0)
        assertEquals("/a b", MountsParser.parse("/dev/x /a\\040b ext4 rw 0 0").single().mountpoint)
        assertEquals("e7a7ab81-d18d-41ea-9dbb-27082631f948", BootIdParser.parse("e7a7ab81-d18d-41ea-9dbb-27082631f948"))
    }
}
