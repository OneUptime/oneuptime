package com.oneuptime.androidagent.collect

import com.oneuptime.androidagent.otlp.Metric
import com.oneuptime.androidagent.otlp.MetricData
import com.oneuptime.androidagent.otlp.NumberPoint
import com.oneuptime.androidagent.otlp.NumberValue
import com.oneuptime.androidagent.otlp.attributes
import com.oneuptime.androidagent.otlp.millisToNanos

/**
 * A [DeviceSnapshot] as metrics, named, typed and labelled exactly as the
 * OpenTelemetry Collector's hostmetrics receiver sends a server's.
 *
 * That is what makes an Android device a host like any other in OneUptime:
 * the Hosts list's CPU, memory and disk columns, a host's Overview charts,
 * the "booted at" it shows and the host alert templates (Host Stopped
 * Reporting, High CPU Utilization, High Memory Utilization, High Filesystem
 * Usage, Host Restarted) all read these names, with these attributes:
 *
 *   system.uptime                  gauge, s
 *   system.cpu.logical.count       up-down sum, {cpu}
 *   system.cpu.utilization         gauge, 1, by cpu and state - where Android lets an app read /proc/stat
 *   system.cpu.load_average.*      gauge, {thread} - where it lets an app read /proc/loadavg
 *   system.memory.usage            up-down sum, By, by state (used, free, cached), summing to the total
 *   system.memory.utilization      gauge, 1, by state
 *   system.filesystem.usage        up-down sum, By, by device, mode, mountpoint, type and state (used, free, reserved)
 *   system.filesystem.utilization  gauge, 1: used over used plus free, the Use% of df
 *   system.network.io              counter, By, by device and direction
 *   system.network.packets         counter, {packet}, by device and direction
 *
 * and, from the semantic conventions for hardware and from Android itself:
 *
 *   hw.battery.charge              gauge, 1
 *   hw.temperature                 gauge, Cel, the battery's
 *   android.battery.plugged        gauge, 1 when on external power, 0 when on battery
 *   android.thermal.status         gauge, PowerManager's thermal status, 0 (none) to 6 (shutdown)
 *   android.thermal.headroom       gauge, 1.0 when the device starts throttling
 *   android.boot.recent_count      gauge, {boot}, the boots in the last hour, this one included:
 *                                  3 or more is a restart loop (the Restart Loop template)
 *
 * system.cpu.utilization comes from /proc/stat with every state where
 * Android lets an app read it, and from HardwarePropertiesManager when the
 * agent is the device owner: there a core's active time is one figure, sent
 * as `user`, with the rest as `idle` (CoreUtilization).
 *
 * Memory "used" is what is not available (MemTotal less MemAvailable):
 * Android keeps the page cache full on purpose, and counting it would put
 * every healthy device near 100%. "cached" is the rest of what is available
 * beyond the plainly free memory.
 */
object HostMetrics {
    fun from(snapshot: DeviceSnapshot): List<Metric> {
        val time: Long = millisToNanos(snapshot.timeMillis)
        val start: Long = millisToNanos(snapshot.bootTimeMillis)
        val metrics: MutableList<Metric> = mutableListOf()

        fun gauge(name: String, unit: String, description: String, points: List<NumberPoint>) {
            if (points.isNotEmpty()) {
                metrics.add(Metric(name, unit, description, MetricData.Gauge(points)))
            }
        }

        fun sum(name: String, unit: String, description: String, monotonic: Boolean, points: List<NumberPoint>) {
            if (points.isNotEmpty()) {
                metrics.add(Metric(name, unit, description, MetricData.Sum(points, monotonic)))
            }
        }

        fun fraction(value: Double, attrs: Map<String, String> = emptyMap()): NumberPoint =
            NumberPoint(NumberValue.Fraction(value), time, attributes { attrs.forEach { (key, text) -> text(key, text) } })

        fun whole(value: Long, attrs: Map<String, String> = emptyMap()): NumberPoint =
            NumberPoint(
                NumberValue.Whole(value),
                time,
                attributes { attrs.forEach { (key, text) -> text(key, text) } },
                startTimeUnixNano = start,
            )

        gauge("system.uptime", "s", "The time the system has been running.", listOf(fraction(snapshot.uptimeSeconds)))

        sum(
            "system.cpu.logical.count",
            "{cpu}",
            "Number of available logical CPUs.",
            false,
            listOf(whole(snapshot.logicalCpuCount.toLong())),
        )

        snapshot.cpuUtilization?.let { perCpu ->
            gauge(
                "system.cpu.utilization",
                "1",
                "Difference in system.cpu.time since the last measurement per logical CPU, divided by the elapsed time.",
                perCpu.flatMap { (cpu, states) ->
                    states.map { (state, share) -> fraction(share, mapOf("cpu" to cpu, "state" to state)) }
                },
            )
        }

        snapshot.loadAverage?.let { load ->
            gauge("system.cpu.load_average.1m", "{thread}", "Average CPU Load over 1 minute.", listOf(fraction(load.oneMinute)))
            gauge("system.cpu.load_average.5m", "{thread}", "Average CPU Load over 5 minutes.", listOf(fraction(load.fiveMinutes)))
            gauge("system.cpu.load_average.15m", "{thread}", "Average CPU Load over 15 minutes.", listOf(fraction(load.fifteenMinutes)))
        }

        snapshot.memory?.takeIf { it.totalBytes > 0 }?.let { memory ->
            val states: LinkedHashMap<String, Long> = linkedMapOf("used" to memory.usedBytes)
            val free: Long? = memory.freeBytes?.coerceIn(0L, memory.availableBytes)
            if (free != null) {
                states["free"] = free
                states["cached"] = (memory.availableBytes - free).coerceAtLeast(0L)
            } else {
                states["free"] = memory.availableBytes
            }
            sum(
                "system.memory.usage",
                "By",
                "Bytes of memory in use.",
                false,
                states.map { (state, bytes) -> whole(bytes, mapOf("state" to state)) },
            )
            gauge(
                "system.memory.utilization",
                "1",
                "Percentage of memory bytes in use.",
                states.map { (state, bytes) -> fraction(bytes.toDouble() / memory.totalBytes, mapOf("state" to state)) },
            )
        }

        val filesystems: List<FilesystemReading> = snapshot.filesystems.filter { it.totalBytes > 0 }
        sum(
            "system.filesystem.usage",
            "By",
            "Filesystem bytes used.",
            false,
            filesystems.flatMap { fs ->
                val labels: Map<String, String> =
                    mapOf("device" to fs.device, "mode" to fs.mode, "mountpoint" to fs.mountpoint, "type" to fs.type)
                listOf(
                    whole(fs.usedBytes, labels + ("state" to "used")),
                    whole(fs.availableBytes, labels + ("state" to "free")),
                    whole(fs.reservedBytes, labels + ("state" to "reserved")),
                )
            },
        )
        gauge(
            "system.filesystem.utilization",
            "1",
            "Fraction of filesystem bytes used.",
            filesystems.mapNotNull { fs ->
                val denominator: Long = fs.usedBytes + fs.availableBytes
                if (denominator <= 0) {
                    null
                } else {
                    fraction(
                        fs.usedBytes.toDouble() / denominator,
                        mapOf("device" to fs.device, "mode" to fs.mode, "mountpoint" to fs.mountpoint, "type" to fs.type),
                    )
                }
            },
        )

        snapshot.network?.let { network ->
            sum(
                "system.network.io",
                "By",
                "The number of bytes transmitted and received.",
                true,
                listOf(
                    whole(network.receivedBytes, mapOf("device" to ALL_INTERFACES, "direction" to "receive")),
                    whole(network.transmittedBytes, mapOf("device" to ALL_INTERFACES, "direction" to "transmit")),
                ),
            )
            if (network.receivedPackets != null && network.transmittedPackets != null) {
                sum(
                    "system.network.packets",
                    "{packet}",
                    "The number of packets transferred.",
                    true,
                    listOf(
                        whole(network.receivedPackets, mapOf("device" to ALL_INTERFACES, "direction" to "receive")),
                        whole(network.transmittedPackets, mapOf("device" to ALL_INTERFACES, "direction" to "transmit")),
                    ),
                )
            }
        }

        snapshot.battery?.let { battery ->
            gauge(
                "hw.battery.charge",
                "1",
                "Remaining fraction of battery charge.",
                listOf(fraction(battery.charge, mapOf("hw.id" to BATTERY_ID))),
            )
            battery.temperatureCelsius?.let { celsius ->
                gauge(
                    "hw.temperature",
                    "Cel",
                    "Temperature in degrees Celsius.",
                    listOf(fraction(celsius, mapOf("hw.id" to BATTERY_ID, "hw.sensor_location" to BATTERY_ID))),
                )
            }
            gauge(
                "android.battery.plugged",
                "1",
                "1 while the device is on external power, 0 while it runs on its battery.",
                listOf(
                    NumberPoint(
                        NumberValue.Whole(if (battery.plugged != null) 1L else 0L),
                        time,
                        attributes { text("android.battery.power_source", battery.plugged) },
                    ),
                ),
            )
        }

        snapshot.thermal?.let { thermal ->
            thermal.status?.let { status ->
                gauge(
                    "android.thermal.status",
                    "1",
                    "Android's thermal status: 0 none, 1 light, 2 moderate, 3 severe, 4 critical, 5 emergency, 6 shutdown.",
                    listOf(NumberPoint(NumberValue.Whole(status.toLong()), time)),
                )
            }
            thermal.headroom?.takeIf { it.isFinite() }?.let { headroom ->
                gauge(
                    "android.thermal.headroom",
                    "1",
                    "How close the device is to thermal throttling: 1.0 is throttling.",
                    listOf(fraction(headroom)),
                )
            }
        }

        // Sent every collection, 0 too: a monitor reads a steady device as healthy, not as no data.
        snapshot.bootsInLastHour?.takeIf { it >= 0 }?.let { boots ->
            gauge(
                "android.boot.recent_count",
                "{boot}",
                "The device's boots in the last hour: 3 or more is a restart loop.",
                listOf(NumberPoint(NumberValue.Whole(boots.toLong()), time)),
            )
        }

        return metrics
    }

    // TrafficStats counts every interface together: there is no per-interface figure an app may read.
    const val ALL_INTERFACES: String = "all"
    const val BATTERY_ID: String = "battery"
}
