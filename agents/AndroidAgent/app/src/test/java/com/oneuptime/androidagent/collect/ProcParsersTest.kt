package com.oneuptime.androidagent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProcParsersTest {
    // The head of /proc/meminfo, as the Android 15 emulator printed it.
    private val meminfo =
        """
        MemTotal:        2531956 kB
        MemFree:          170204 kB
        MemAvailable:    1035540 kB
        Buffers:           41000 kB
        Cached:          1043516 kB
        Active(anon):     588180 kB
        HugePages_Total:       0
        garbage line
        """.trimIndent()

    @Test
    fun `meminfo is read in bytes, and a field without a unit as it is`() {
        val values: Map<String, Long> = MemInfoParser.parse(meminfo)

        assertEquals(2_531_956L * 1024, values["MemTotal"])
        assertEquals(1_035_540L * 1024, values["MemAvailable"])
        assertEquals(170_204L * 1024, values["MemFree"])
        assertEquals(588_180L * 1024, values["Active(anon)"])
        assertEquals(0L, values["HugePages_Total"])
        assertEquals(7, values.size)
    }

    @Test
    fun `an empty or foreign file gives nothing`() {
        assertTrue(MemInfoParser.parse("").isEmpty())
        assertTrue(MemInfoParser.parse("Permission denied").isEmpty())
    }

    private val statBefore =
        """
        cpu  1000 100 500 8000 200 50 50 0 0 0
        cpu0 500 50 250 4000 100 25 25 0 0 0
        cpu1 500 50 250 4000 100 25 25 0 0 0
        intr 123456
        ctxt 7890
        """.trimIndent()

    private val statAfter =
        """
        cpu  1600 100 900 8800 200 50 150 0 0 0
        cpu0 900 50 450 4200 100 25 75 0 0 0
        cpu1 700 50 450 4600 100 25 75 0 0 0
        """.trimIndent()

    @Test
    fun `stat is read per CPU and in total, and its other lines are skipped`() {
        val times: Map<String, CpuTimes> = CpuStatParser.parse(statBefore)

        assertEquals(setOf("cpu", "cpu0", "cpu1"), times.keys)
        assertEquals(CpuTimes(500, 50, 250, 4000, 100, 25, 25, 0), times["cpu0"])
        assertEquals(9_900L, times.getValue("cpu").total)
    }

    @Test
    fun `an old kernel's short cpu line still reads, with the missing states as zero`() {
        val times: Map<String, CpuTimes> = CpuStatParser.parse("cpu0 10 20 30 40")

        assertEquals(CpuTimes(10, 20, 30, 40, 0, 0, 0, 0), times["cpu0"])
        assertTrue(CpuStatParser.parse("cpu0 10 20").isEmpty())
    }

    @Test
    fun `utilization is each state's share of the time between two readings, per CPU`() {
        val utilization: Map<String, Map<String, Double>> =
            CpuUtilization.between(CpuStatParser.parse(statBefore), CpuStatParser.parse(statAfter))

        assertEquals(setOf("cpu0", "cpu1"), utilization.keys)
        // cpu0: 400 user, 200 system, 200 idle, 50 softirq of 850 ticks.
        val cpu0: Map<String, Double> = utilization.getValue("cpu0")
        assertEquals(400.0 / 850, cpu0.getValue("user"), 1e-9)
        assertEquals(200.0 / 850, cpu0.getValue("system"), 1e-9)
        assertEquals(200.0 / 850, cpu0.getValue("idle"), 1e-9)
        assertEquals(50.0 / 850, cpu0.getValue("softirq"), 1e-9)
        assertEquals(0.0, cpu0.getValue("wait"), 0.0)
        assertEquals(1.0, cpu0.values.sum(), 1e-9)
        assertEquals(
            listOf("user", "nice", "system", "idle", "wait", "interrupt", "softirq", "steal"),
            cpu0.keys.toList(),
        )
    }

    @Test
    fun `a CPU with no time between readings, or that went offline, is left out`() {
        val before: Map<String, CpuTimes> = CpuStatParser.parse("cpu0 1 1 1 1\ncpu1 1 1 1 1")
        val after: Map<String, CpuTimes> = CpuStatParser.parse("cpu0 1 1 1 1\ncpu2 5 5 5 5")

        assertTrue(CpuUtilization.between(before, after).isEmpty())
    }

    @Test
    fun `a counter that went backwards counts as zero, never as a negative share`() {
        val before: Map<String, CpuTimes> = CpuStatParser.parse("cpu0 100 0 100 100")
        val after: Map<String, CpuTimes> = CpuStatParser.parse("cpu0 50 0 200 300")

        val cpu0: Map<String, Double> = CpuUtilization.between(before, after).getValue("cpu0")
        assertEquals(0.0, cpu0.getValue("user"), 0.0)
        assertTrue(cpu0.values.all { it in 0.0..1.0 })
    }

    @Test
    fun `load average reads its three numbers`() {
        assertEquals(LoadAverage(0.52, 0.58, 0.59), LoadAverageParser.parse("0.52 0.58 0.59 1/1234 5678\n"))
        assertNull(LoadAverageParser.parse("0.52 0.58"))
        assertNull(LoadAverageParser.parse("a b c"))
        assertNull(LoadAverageParser.parse(""))
    }

    @Test
    fun `mounts are read with their escaped spaces, and the last mount at a path wins`() {
        val text =
            """
            /dev/block/dm-5 / ext4 ro,seclabel,relatime 0 0
            tmpfs /dev tmpfs rw,seclabel,nosuid 0 0
            /dev/block/dm-40 /data f2fs rw,lazytime,seclabel 0 0
            /dev/block/dm-41 /data ext4 rw,seclabel 0 0
            /dev/fuse /mnt/user/0/My\040Drive fuse rw 0 0
            short line
            """.trimIndent()
        val mounts: List<MountEntry> = MountsParser.parse(text)

        assertEquals(5, mounts.size)
        assertEquals("ro", mounts[0].mode)
        assertEquals("rw", mounts[2].mode)
        assertEquals("/mnt/user/0/My Drive", mounts[4].mountpoint)
        assertEquals(MountEntry("/dev/block/dm-41", "/data", "ext4", listOf("rw", "seclabel")), MountsParser.find(mounts, "/data"))
        assertNull(MountsParser.find(mounts, "/sdcard"))
    }

    @Test
    fun `boot id is a uuid, lower-cased, and nothing else is one`() {
        assertEquals("e7a7ab81-d18d-41ea-9dbb-27082631f948", BootIdParser.parse("E7A7AB81-D18D-41EA-9DBB-27082631F948\n"))
        assertNull(BootIdParser.parse("not a boot id"))
        assertNull(BootIdParser.parse(""))
        assertNull(BootIdParser.parse(null))
    }
}
