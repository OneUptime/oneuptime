package com.oneuptime.androidagent.collect

import com.oneuptime.androidagent.otlp.Metric
import com.oneuptime.androidagent.otlp.MetricData
import com.oneuptime.androidagent.otlp.NumberPoint
import com.oneuptime.androidagent.otlp.NumberValue
import com.oneuptime.androidagent.otlp.millisToNanos
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * The metric names, types, units and attributes are the hostmetrics
 * receiver's, because OneUptime's Hosts product reads exactly those:
 * HostReadingsScan (the Hosts list's CPU, memory and disk columns and the
 * host's booted-at), scanHostInfraStatsFromMetrics (cores and total memory)
 * and the host alert templates (HostAlertTemplates.ts).
 */
class HostMetricsTest {
    private val now: Long = 1_795_076_857_467L
    private val boot: Long = now - 3_600_000L

    private fun snapshot(
        cpu: Map<String, Map<String, Double>>? = null,
        load: LoadAverage? = null,
        memory: MemoryReading? = MemoryReading(totalBytes = 4_000L, availableBytes = 1_500L, freeBytes = 500L),
        filesystems: List<FilesystemReading> =
            listOf(FilesystemReading("/dev/block/dm-40", "/data", "f2fs", "rw", 1_000L, 300L, 250L)),
        network: NetworkReading? = NetworkReading(10_000L, 2_000L, 100L, 20L),
        battery: BatteryReading? = null,
        thermal: ThermalReading? = null,
    ) = DeviceSnapshot(
        timeMillis = now,
        bootTimeMillis = boot,
        uptimeSeconds = 3_600.0,
        logicalCpuCount = 8,
        cpuUtilization = cpu,
        loadAverage = load,
        memory = memory,
        filesystems = filesystems,
        network = network,
        battery = battery,
        thermal = thermal,
    )

    private fun List<Metric>.named(name: String): Metric = single { it.name == name }

    private fun Metric.values(): Map<Map<String, Any>, Number> =
        data.points.associate { point -> point.attributes.toMap() to point.number() }

    private fun NumberPoint.number(): Number =
        when (val value: NumberValue = value) {
            is NumberValue.Whole -> value.value
            is NumberValue.Fraction -> value.value
        }

    @Test
    fun `uptime is a gauge in seconds, from which OneUptime works out when the device booted`() {
        val uptime: Metric = HostMetrics.from(snapshot()).named("system.uptime")

        assertEquals("s", uptime.unit)
        assertTrue(uptime.data is MetricData.Gauge)
        assertEquals(3_600.0, uptime.data.points.single().number())
        assertEquals(millisToNanos(now), uptime.data.points.single().timeUnixNano)
    }

    @Test
    fun `the logical CPU count is an up-down sum, which OneUptime reads as the host's cores`() {
        val count: Metric = HostMetrics.from(snapshot()).named("system.cpu.logical.count")

        assertEquals(MetricData.Sum::class, count.data::class)
        assertFalse((count.data as MetricData.Sum).isMonotonic)
        assertEquals(8L, count.data.points.single().number())
    }

    @Test
    fun `memory is used, free and cached, summing to the total, with used being what is not available`() {
        val metrics: List<Metric> = HostMetrics.from(snapshot())
        val usage: Map<Map<String, Any>, Number> = metrics.named("system.memory.usage").values()

        assertEquals(2_500L, usage[mapOf("state" to "used")])
        assertEquals(500L, usage[mapOf("state" to "free")])
        assertEquals(1_000L, usage[mapOf("state" to "cached")])
        assertEquals(4_000L, usage.values.sumOf { it.toLong() })

        val utilization: Map<Map<String, Any>, Number> = metrics.named("system.memory.utilization").values()
        assertEquals(0.625, utilization[mapOf("state" to "used")]!!.toDouble(), 1e-9)
        assertEquals(1.0, utilization.values.sumOf { it.toDouble() }, 1e-9)
    }

    @Test
    fun `without MemFree, memory is used and free, still summing to the total`() {
        val usage: Map<Map<String, Any>, Number> =
            HostMetrics.from(snapshot(memory = MemoryReading(4_000L, 1_500L, null))).named("system.memory.usage").values()

        assertEquals(mapOf(mapOf("state" to "used") to 2_500L, mapOf("state" to "free") to 1_500L), usage)
    }

    @Test
    fun `a filesystem is used, free and reserved, and its utilization is used over used plus free, as df prints`() {
        val metrics: List<Metric> = HostMetrics.from(snapshot())
        val labels: Map<String, Any> = mapOf("device" to "/dev/block/dm-40", "mode" to "rw", "mountpoint" to "/data", "type" to "f2fs")
        val usage: Map<Map<String, Any>, Number> = metrics.named("system.filesystem.usage").values()

        assertEquals(700L, usage[labels + ("state" to "used")])
        assertEquals(250L, usage[labels + ("state" to "free")])
        assertEquals(50L, usage[labels + ("state" to "reserved")])

        val utilization: Map<Map<String, Any>, Number> = metrics.named("system.filesystem.utilization").values()
        assertEquals(700.0 / 950.0, utilization[labels]!!.toDouble(), 1e-9)
    }

    @Test
    fun `network traffic is a monotonic counter since boot, over every interface`() {
        val io: Metric = HostMetrics.from(snapshot()).named("system.network.io")

        assertTrue((io.data as MetricData.Sum).isMonotonic)
        assertEquals("By", io.unit)
        assertEquals(
            mapOf(
                mapOf("device" to "all", "direction" to "receive") to 10_000L,
                mapOf("device" to "all", "direction" to "transmit") to 2_000L,
            ),
            io.values(),
        )
        assertTrue(io.data.points.all { it.startTimeUnixNano == millisToNanos(boot) })
        assertEquals(2, HostMetrics.from(snapshot()).named("system.network.packets").data.points.size)
    }

    @Test
    fun `CPU utilization is per CPU and state, where Android lets the agent read it`() {
        val cpu: Map<String, Map<String, Double>> = mapOf("cpu0" to mapOf("user" to 0.25, "system" to 0.25, "idle" to 0.5))
        val utilization: Metric = HostMetrics.from(snapshot(cpu = cpu)).named("system.cpu.utilization")

        assertEquals("1", utilization.unit)
        assertEquals(0.25, utilization.values()[mapOf("cpu" to "cpu0", "state" to "user")])
        assertEquals(3, utilization.data.points.size)
    }

    @Test
    fun `load average is three gauges`() {
        val metrics: List<Metric> = HostMetrics.from(snapshot(load = LoadAverage(1.0, 2.0, 3.0)))

        assertEquals(3.0, metrics.named("system.cpu.load_average.15m").data.points.single().number())
        assertEquals(1.0, metrics.named("system.cpu.load_average.1m").data.points.single().number())
    }

    @Test
    fun `a reading Android does not give is not sent at all, never as zero`() {
        val names: Set<String> =
            HostMetrics.from(snapshot(memory = null, filesystems = emptyList(), network = null)).map { it.name }.toSet()

        assertEquals(setOf("system.uptime", "system.cpu.logical.count"), names)
    }

    @Test
    fun `the battery's charge, temperature and power source are sent, when there is a battery`() {
        val metrics: List<Metric> =
            HostMetrics.from(snapshot(battery = BatteryReading(charge = 0.8, state = "charging", plugged = "ac", temperatureCelsius = 31.5)))

        assertEquals(0.8, metrics.named("hw.battery.charge").values()[mapOf("hw.id" to "battery")])
        assertEquals(31.5, metrics.named("hw.temperature").values()[mapOf("hw.id" to "battery", "hw.sensor_location" to "battery")])
        assertEquals(1L, metrics.named("android.battery.plugged").values()[mapOf("android.battery.power_source" to "ac")])
    }

    @Test
    fun `a device on its battery reports plugged as 0, which an alert on a kiosk losing power reads`() {
        val plugged: Metric =
            HostMetrics.from(snapshot(battery = BatteryReading(0.4, "discharging", null, null))).named("android.battery.plugged")

        assertEquals(mapOf(emptyMap<String, Any>() to 0L), plugged.values())
    }

    @Test
    fun `thermal status and headroom are sent where Android has them`() {
        val metrics: List<Metric> = HostMetrics.from(snapshot(thermal = ThermalReading(status = 2, headroom = 0.7)))

        assertEquals(2L, metrics.named("android.thermal.status").data.points.single().number())
        assertEquals(0.7, metrics.named("android.thermal.headroom").data.points.single().number())

        val noHeadroom: List<Metric> = HostMetrics.from(snapshot(thermal = ThermalReading(status = 0, headroom = Double.NaN)))
        assertTrue(noHeadroom.none { it.name == "android.thermal.headroom" })
    }

    @Test
    fun `every name the Hosts product reads is spelled as the hostmetrics receiver spells it`() {
        val names: Set<String> =
            HostMetrics.from(
                snapshot(cpu = mapOf("cpu0" to mapOf("user" to 1.0)), load = LoadAverage(1.0, 1.0, 1.0)),
            ).map { it.name }.toSet()

        assertTrue(
            names.containsAll(
                listOf(
                    "system.uptime",
                    "system.cpu.utilization",
                    "system.cpu.logical.count",
                    "system.cpu.load_average.15m",
                    "system.memory.usage",
                    "system.memory.utilization",
                    "system.filesystem.usage",
                    "system.filesystem.utilization",
                    "system.network.io",
                ),
            ),
        )
        assertNull(names.firstOrNull { it.startsWith("system.paging") })
    }

    @Test
    fun `the boots of the last hour, for the Restart Loop template, sent every collection`() {
        val metric: Metric = HostMetrics.from(snapshot().copy(bootsInLastHour = 3)).named("android.boot.recent_count")

        assertEquals("{boot}", metric.unit)
        assertTrue(metric.data is MetricData.Gauge)
        assertEquals(NumberValue.Whole(3L), metric.data.points.single().value)
        // A device up for more than an hour has had none: 0, so a monitor reads it as healthy rather than as no data.
        assertEquals(NumberValue.Whole(0L), HostMetrics.from(snapshot().copy(bootsInLastHour = 0)).named("android.boot.recent_count").data.points.single().value)
        // Unknown is not sent.
        assertTrue(HostMetrics.from(snapshot()).none { it.name == "android.boot.recent_count" })
    }

    @Test
    fun `the security patch level's age in days, for the Security Patch Out of Date template, sent every collection`() {
        val metric: Metric = HostMetrics.from(snapshot().copy(securityPatchAgeDays = 120)).named("android.os.security_patch.age")

        assertEquals("d", metric.unit)
        assertTrue(metric.data is MetricData.Gauge)
        assertEquals(NumberValue.Whole(120L), metric.data.points.single().value)
        // Patched today is 0 days behind: sent, so a monitor reads the device as up to date.
        assertEquals(
            NumberValue.Whole(0L),
            HostMetrics.from(snapshot().copy(securityPatchAgeDays = 0)).named("android.os.security_patch.age").data.points.single().value,
        )
        // A level that is not a date has no age, and none is sent.
        assertTrue(HostMetrics.from(snapshot()).none { it.name == "android.os.security_patch.age" })
    }

    @Test
    fun `CPU use read as the device owner has only user and idle, and still reads as busy`() {
        val metric: Metric =
            HostMetrics.from(snapshot(cpu = mapOf("cpu0" to mapOf("user" to 0.3, "idle" to 0.7)))).named("system.cpu.utilization")

        val states: Map<Any?, Double> =
            metric.data.points.associate { point -> point.attributes.toMap()["state"] to (point.value as NumberValue.Fraction).value }
        assertEquals(mapOf("user" to 0.3, "idle" to 0.7), states)
    }
}
