package com.oneuptime.androidagent.collect

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oneuptime.androidagent.testing.FakeClock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** CPU use from HardwarePropertiesManager, for a device on which the agent is the device owner (Android 8 and later). */
@RunWith(AndroidJUnit4::class)
class CoreTimesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val clock = FakeClock()

    @Test
    fun `each core's busy share between two readings, as user, and the rest as idle`() {
        val previous: List<CoreTime?> = listOf(CoreTime(1_000, 10_000), CoreTime(5_000, 10_000))
        val current: List<CoreTime?> = listOf(CoreTime(1_600, 12_000), CoreTime(5_500, 12_000))

        val utilization: Map<String, Map<String, Double>> = CoreUtilization.between(previous, current)

        assertEquals(setOf("cpu0", "cpu1"), utilization.keys)
        assertEquals(0.3, utilization.getValue("cpu0").getValue("user"), 1e-9)
        assertEquals(0.7, utilization.getValue("cpu0").getValue("idle"), 1e-9)
        assertEquals(0.25, utilization.getValue("cpu1").getValue("user"), 1e-9)
        // No system state: Android gives a core's active time as one figure.
        assertNull(utilization.getValue("cpu0")["system"])
    }

    @Test
    fun `an offline core, a core that was off, and counters that went back are left out`() {
        val previous: List<CoreTime?> = listOf(CoreTime(100, 1_000), null, CoreTime(100, 1_000), CoreTime(500, 1_000))
        val current: List<CoreTime?> = listOf(null, CoreTime(100, 1_000), CoreTime(100, 1_000), CoreTime(200, 2_000))

        assertTrue(CoreUtilization.between(previous, current).isEmpty())
    }

    @Test
    fun `a busy share is never more than all of it`() {
        val utilization = CoreUtilization.between(listOf(CoreTime(0, 0)), listOf(CoreTime(2_000, 1_000)))

        assertEquals(1.0, utilization.getValue("cpu0").getValue("user"), 0.0)
        assertEquals(0.0, utilization.getValue("cpu0").getValue("idle"), 0.0)
    }

    private fun collector(reader: CoreTimesReader, stat: String? = null): SnapshotCollector =
        SnapshotCollector(context, clock, reader) { path -> if (path == SnapshotCollector.PROC_STAT) stat else null }

    @Test
    fun `where stat cannot be read, the device owner reads CPU use from HardwarePropertiesManager`() {
        var reading = listOf<CoreTime?>(CoreTime(1_000, 10_000))
        val collector: SnapshotCollector = collector({ CoreTimesResult.Read(reading) })

        assertNull(collector.collect().cpuUtilization)
        assertTrue(collector.capabilities.cpuUtilization)
        assertEquals(CpuSource.HARDWARE_PROPERTIES, collector.capabilities.cpuSource)

        reading = listOf(CoreTime(2_000, 12_000))
        assertEquals(0.5, collector.collect().cpuUtilization!!.getValue("cpu0").getValue("user"), 1e-9)
        assertNull(collector.capabilities.cpuUnavailable)
    }

    @Test
    fun `without device owner it says plainly that CPU use is not available`() {
        val collector: SnapshotCollector = collector({ CoreTimesResult.NotDeviceOwner })

        assertNull(collector.collect().cpuUtilization)
        assertFalse(collector.capabilities.cpuUtilization)
        assertEquals(CpuSource.NONE, collector.capabilities.cpuSource)
        assertEquals(CpuUnavailable.NOT_DEVICE_OWNER, collector.capabilities.cpuUnavailable)
    }

    @Test
    fun `as device owner on a device that reports none, it says the device does not`() {
        val collector: SnapshotCollector = collector({ CoreTimesResult.NotSupported })

        collector.collect()
        assertEquals(CpuUnavailable.NOT_SUPPORTED, collector.capabilities.cpuUnavailable)
    }

    @Test
    fun `stat wins where it can be read, with every state`() {
        var asked = 0
        val collector: SnapshotCollector =
            collector(
                {
                    asked += 1
                    CoreTimesResult.NotDeviceOwner
                },
                stat = "cpu0 100 0 100 800 0 0 0 0\n",
            )

        collector.collect()
        assertEquals(CpuSource.PROC_STAT, collector.capabilities.cpuSource)
        assertEquals(0, asked)
    }

    @Test
    fun `on Robolectric the agent is no device owner, so the real reader says so`() {
        assertEquals(CoreTimesResult.NotDeviceOwner, HardwarePropertiesCoreTimes(context).read())
    }
}
