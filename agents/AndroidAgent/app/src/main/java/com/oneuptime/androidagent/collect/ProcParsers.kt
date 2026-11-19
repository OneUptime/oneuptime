package com.oneuptime.androidagent.collect

/*
 * Parsers for the kernel files the agent reads. Each takes the file's text
 * and never throws: a line it cannot read is skipped, and a file with
 * nothing it can use gives null or an empty result.
 *
 * Which files an app may read depends on the Android version: /proc/meminfo
 * and /proc/self/mounts always, /proc/stat and /proc/loadavg only up to
 * Android 7 (SELinux denies them to apps from 8.0).
 */

/** /proc/meminfo, as bytes by field name ("MemTotal", "MemAvailable", ...). */
object MemInfoParser {
    private val LINE: Regex = Regex("""^([A-Za-z0-9_()]+):\s+(\d+)(?:\s+kB)?\s*$""")

    fun parse(text: String): Map<String, Long> {
        val values: MutableMap<String, Long> = linkedMapOf()
        text.lineSequence().forEach { line ->
            val match: MatchResult = LINE.matchEntire(line.trim()) ?: return@forEach
            val number: Long = match.groupValues[2].toLongOrNull() ?: return@forEach
            val isKilobytes: Boolean = line.trimEnd().endsWith("kB")
            values[match.groupValues[1]] = if (isKilobytes) number * 1024L else number
        }
        return values
    }
}

/** One CPU's (or all CPUs') time in each state, in clock ticks, from /proc/stat. */
data class CpuTimes(
    val user: Long,
    val nice: Long,
    val system: Long,
    val idle: Long,
    val iowait: Long,
    val irq: Long,
    val softirq: Long,
    val steal: Long,
) {
    val total: Long get() = user + nice + system + idle + iowait + irq + softirq + steal
}

object CpuStatParser {
    /** The per-CPU lines ("cpu0", "cpu1", ...), and "cpu" for the total. */
    fun parse(text: String): Map<String, CpuTimes> {
        val result: MutableMap<String, CpuTimes> = linkedMapOf()
        text.lineSequence().forEach { line ->
            val fields: List<String> = line.trim().split(Regex("\\s+"))
            val name: String = fields.firstOrNull() ?: return@forEach
            if (!name.startsWith("cpu")) {
                return@forEach
            }
            val numbers: List<Long> = fields.drop(1).mapNotNull { it.toLongOrNull() }
            if (numbers.size < 4) {
                return@forEach
            }
            fun at(index: Int): Long = numbers.getOrNull(index) ?: 0L
            result[name] = CpuTimes(at(0), at(1), at(2), at(3), at(4), at(5), at(6), at(7))
        }
        return result
    }
}

/**
 * How busy each CPU was between two readings of /proc/stat, as the share of
 * the time spent in each state - the states and their names are the
 * OpenTelemetry hostmetrics receiver's, so OneUptime's host pages read them
 * as they read a server's.
 */
object CpuUtilization {
    fun between(previous: Map<String, CpuTimes>, current: Map<String, CpuTimes>): Map<String, Map<String, Double>> {
        val result: MutableMap<String, Map<String, Double>> = linkedMapOf()
        current.forEach { (name, now) ->
            // The aggregate line is the per-CPU lines summed: report each CPU.
            if (name == "cpu") {
                return@forEach
            }
            val before: CpuTimes = previous[name] ?: return@forEach
            val elapsed: Long = now.total - before.total
            if (elapsed <= 0) {
                return@forEach
            }
            fun share(nowValue: Long, beforeValue: Long): Double =
                ((nowValue - beforeValue).coerceAtLeast(0L).toDouble() / elapsed).coerceIn(0.0, 1.0)
            result[name] =
                linkedMapOf(
                    "user" to share(now.user, before.user),
                    "nice" to share(now.nice, before.nice),
                    "system" to share(now.system, before.system),
                    "idle" to share(now.idle, before.idle),
                    "wait" to share(now.iowait, before.iowait),
                    "interrupt" to share(now.irq, before.irq),
                    "softirq" to share(now.softirq, before.softirq),
                    "steal" to share(now.steal, before.steal),
                )
        }
        return result
    }
}

data class LoadAverage(val oneMinute: Double, val fiveMinutes: Double, val fifteenMinutes: Double)

object LoadAverageParser {
    fun parse(text: String): LoadAverage? {
        val fields: List<Double> = text.trim().split(Regex("\\s+")).take(3).mapNotNull { it.toDoubleOrNull() }
        if (fields.size < 3 || fields.any { !it.isFinite() || it < 0 }) {
            return null
        }
        return LoadAverage(fields[0], fields[1], fields[2])
    }
}

data class MountEntry(val device: String, val mountpoint: String, val type: String, val options: List<String>) {
    val mode: String get() = if ("ro" in options) "ro" else "rw"
}

/** /proc/self/mounts, whose spaces in names are written as `\040`. */
object MountsParser {
    fun parse(text: String): List<MountEntry> =
        text.lineSequence().mapNotNull { line ->
            val fields: List<String> = line.trim().split(Regex("\\s+"))
            if (fields.size < 4) {
                null
            } else {
                MountEntry(
                    device = unescape(fields[0]),
                    mountpoint = unescape(fields[1]),
                    type = fields[2],
                    options = fields[3].split(','),
                )
            }
        }.toList()

    /** The entry mounted at exactly [mountpoint], the last one when it is mounted more than once. */
    fun find(entries: List<MountEntry>, mountpoint: String): MountEntry? = entries.lastOrNull { it.mountpoint == mountpoint }

    private fun unescape(field: String): String =
        field.replace(Regex("""\\([0-7]{3})""")) { match -> match.groupValues[1].toInt(8).toChar().toString() }
}

/** /proc/sys/kernel/random/boot_id: a new random id at every boot. */
object BootIdParser {
    private val UUID: Regex = Regex("^[0-9a-fA-F-]{16,64}$")

    fun parse(text: String?): String? = text?.trim()?.takeIf { UUID.matches(it) }?.lowercase()
}
