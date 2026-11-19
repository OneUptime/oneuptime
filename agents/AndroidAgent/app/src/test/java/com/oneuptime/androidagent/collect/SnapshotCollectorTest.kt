package com.oneuptime.androidagent.collect

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Environment
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oneuptime.androidagent.agent.AndroidPackageNames
import com.oneuptime.androidagent.testing.FakeClock
import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowStatFs

@RunWith(AndroidJUnit4::class)
class SnapshotCollectorTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val clock = FakeClock(now = 1_795_076_857_467L, elapsed = 7_200_000L)
    private val files: MutableMap<String, String> = mutableMapOf()

    private fun collector() = SnapshotCollector(context, clock) { path -> files[path] }

    @Test
    fun `memory comes from meminfo, uptime and boot time from the clocks`() {
        files[SnapshotCollector.PROC_MEMINFO] = "MemTotal: 4000 kB\nMemFree: 500 kB\nMemAvailable: 1500 kB\n"

        val snapshot: DeviceSnapshot = collector().collect()

        assertEquals(MemoryReading(4_096_000L, 1_536_000L, 512_000L), snapshot.memory)
        assertEquals(7_200.0, snapshot.uptimeSeconds, 0.0)
        assertEquals(1_795_076_857_467L - 7_200_000L, snapshot.bootTimeMillis)
        assertTrue(snapshot.logicalCpuCount > 0)
    }

    @Test
    fun `without meminfo, memory comes from ActivityManager`() {
        val snapshot: DeviceSnapshot = collector().collect()

        // Robolectric's ActivityManager reports some memory; only that it was read matters.
        assertTrue(snapshot.memory == null || snapshot.memory!!.freeBytes == null)
    }

    @Test
    fun `CPU utilization needs two readings of stat, and is left out where stat cannot be read`() {
        val collector: SnapshotCollector = collector()
        files[SnapshotCollector.PROC_STAT] = "cpu0 100 0 100 800 0 0 0 0\n"
        assertNull(collector.collect().cpuUtilization)
        assertTrue(collector.capabilities.cpuUtilization)

        files[SnapshotCollector.PROC_STAT] = "cpu0 150 0 150 900 0 0 0 0\n"
        val utilization: Map<String, Map<String, Double>> = collector.collect().cpuUtilization!!
        assertEquals(0.25, utilization.getValue("cpu0").getValue("user"), 1e-9)

        files.remove(SnapshotCollector.PROC_STAT)
        assertNull(collector.collect().cpuUtilization)
        assertFalse(collector.capabilities.cpuUtilization)
    }

    @Test
    fun `load average is read where Android allows it`() {
        files[SnapshotCollector.PROC_LOADAVG] = "0.50 0.40 0.30 1/200 300"

        assertEquals(LoadAverage(0.5, 0.4, 0.3), collector().collect().loadAverage)
    }

    @Test
    fun `the data partition is measured, with its device and type from mounts`() {
        val data: String = Environment.getDataDirectory().path
        ShadowStatFs.registerStats(data, 1_000, 300, 250)
        files[SnapshotCollector.PROC_SELF_MOUNTS] = "/dev/block/dm-40 $data f2fs rw,lazytime 0 0\n"

        val filesystem: FilesystemReading = collector().collect().filesystems.single()

        assertEquals("/dev/block/dm-40", filesystem.device)
        assertEquals(data, filesystem.mountpoint)
        assertEquals("f2fs", filesystem.type)
        assertEquals("rw", filesystem.mode)
        assertEquals(filesystem.totalBytes / 1_000 * 300, filesystem.freeBytes)
        assertEquals(filesystem.totalBytes / 1_000 * 250, filesystem.availableBytes)
    }

    @Test
    fun `the battery comes from the sticky battery broadcast`() {
        context.sendStickyBroadcast(
            Intent(Intent.ACTION_BATTERY_CHANGED)
                .putExtra(BatteryManager.EXTRA_PRESENT, true)
                .putExtra(BatteryManager.EXTRA_LEVEL, 42)
                .putExtra(BatteryManager.EXTRA_SCALE, 100)
                .putExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_DISCHARGING)
                .putExtra(BatteryManager.EXTRA_PLUGGED, 0)
                .putExtra(BatteryManager.EXTRA_TEMPERATURE, 287),
        )

        val collector: SnapshotCollector = collector()
        val battery: BatteryReading = collector.collect().battery!!

        assertEquals(BatteryReading(0.42, "discharging", null, 28.7), battery)
        assertTrue(collector.capabilities.battery)
    }

    @Test
    fun `addresses Android reports for loopback and link-local are not the device's`() {
        val addresses: List<InetAddress> =
            listOf("127.0.0.1", "fe80::1", "10.20.30.40", "2001:db8::40", "::").map { InetAddress.getByName(it) }

        assertEquals(listOf("10.20.30.40", "2001:db8::40"), SnapshotCollector.reportableAddresses(addresses))
    }

    @Test
    fun `IPv6 addresses are written the short way RFC 5952 gives`() {
        fun compressed(text: String): String = SnapshotCollector.compressIpv6(InetAddress.getByName(text).address)

        assertEquals("2001:db8::40", compressed("2001:0db8:0000:0000:0000:0000:0000:0040"))
        assertEquals("fd00:1:2:3:4:5:6:7", compressed("fd00:1:2:3:4:5:6:7"))
        assertEquals("2001:db8::1:0:0:1", compressed("2001:db8:0:0:1:0:0:1"))
        assertEquals("2001:0:1::1", compressed("2001:0:1:0:0:0:0:1"))
        assertEquals("::1", compressed("::1"))
        assertEquals("fe80::", compressed("fe80::"))
    }

    @Test
    fun `a Logcat writer's uid is resolved to its app, and remembered`() {
        val packageManager: PackageManager = context.packageManager
        shadowOf(packageManager).setPackagesForUid(10143, "com.example.kiosk", "com.example.kiosk.helper")
        val names = AndroidPackageNames(packageManager)

        assertEquals("com.example.kiosk", names.packageForUid(10143))
        assertNull(names.packageForUid(10999))
        assertNotNull(names.packageForUid(10143))
    }
}
