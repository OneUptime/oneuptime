package com.oneuptime.androidagent.collect

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.TrafficStats
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import com.oneuptime.androidagent.Clock
import java.io.File
import java.net.Inet6Address
import java.net.InetAddress

/** Which readings the device let the agent take, for the setup screen. */
data class CollectorCapabilities(
    val cpuUtilization: Boolean = false,
    // Where CPU use comes from, and why there is none when there is none.
    val cpuSource: CpuSource = CpuSource.NONE,
    val cpuUnavailable: CpuUnavailable? = null,
    val loadAverage: Boolean = false,
    val memory: Boolean = false,
    val storage: Boolean = false,
    val network: Boolean = false,
    val battery: Boolean = false,
    val thermal: Boolean = false,
)

/**
 * Reads a [DeviceSnapshot] from the device. Each reading is taken on its own
 * and a failure leaves only that reading out: a device that refuses one file
 * still reports everything else.
 *
 * CPU utilization needs two readings, so the first collection after the
 * agent starts has none. It comes from /proc/stat where Android lets an app
 * read it (Android 7), and otherwise from HardwarePropertiesManager when the
 * agent is the device owner (CoreTimes): Android documents no other way for
 * an app to read the device's CPU use from Android 8.
 */
class SnapshotCollector(
    private val context: Context,
    private val clock: Clock,
    private val coreTimes: CoreTimesReader = HardwarePropertiesCoreTimes(context),
    private val readFile: (String) -> String? = ::readSmallFile,
) {
    private var previousCpuTimes: Map<String, CpuTimes>? = null
    private var previousCoreTimes: List<CoreTime?>? = null
    private var cpuSource: CpuSource = CpuSource.NONE
    private var cpuUnavailable: CpuUnavailable? = null

    @Volatile
    var capabilities: CollectorCapabilities = CollectorCapabilities()
        private set

    fun collect(): DeviceSnapshot {
        val now: Long = clock.nowMillis()
        val uptimeMillis: Long = clock.elapsedRealtimeMillis()

        val cpu: Map<String, Map<String, Double>>? = readCpuUtilization()
        val load: LoadAverage? = readFile(PROC_LOADAVG)?.let { LoadAverageParser.parse(it) }
        val memory: MemoryReading? = readMemory()
        val filesystems: List<FilesystemReading> = listOfNotNull(readDataFilesystem())
        val network: NetworkReading? = readNetwork()
        val battery: BatteryReading? = readBattery()
        val thermal: ThermalReading? = readThermal()

        capabilities =
            CollectorCapabilities(
                cpuUtilization = cpuSource != CpuSource.NONE,
                cpuSource = cpuSource,
                cpuUnavailable = cpuUnavailable,
                loadAverage = load != null,
                memory = memory != null,
                storage = filesystems.isNotEmpty(),
                network = network != null,
                battery = battery != null,
                thermal = thermal != null,
            )

        return DeviceSnapshot(
            timeMillis = now,
            bootTimeMillis = now - uptimeMillis,
            uptimeSeconds = uptimeMillis / 1000.0,
            logicalCpuCount = Runtime.getRuntime().availableProcessors(),
            cpuUtilization = cpu,
            loadAverage = load,
            memory = memory,
            filesystems = filesystems,
            network = network,
            battery = battery,
            thermal = thermal,
        )
    }

    private fun readCpuUtilization(): Map<String, Map<String, Double>>? {
        val current: Map<String, CpuTimes> = readFile(PROC_STAT)?.let { CpuStatParser.parse(it) }.orEmpty()
        if (current.isNotEmpty()) {
            cpuSource = CpuSource.PROC_STAT
            cpuUnavailable = null
            previousCoreTimes = null
            val previous: Map<String, CpuTimes>? = previousCpuTimes
            previousCpuTimes = current
            return previous?.let { CpuUtilization.between(it, current) }?.takeIf { it.isNotEmpty() }
        }
        previousCpuTimes = null
        return when (val cores: CoreTimesResult = coreTimes.read()) {
            is CoreTimesResult.Read -> {
                cpuSource = CpuSource.HARDWARE_PROPERTIES
                cpuUnavailable = null
                val previous: List<CoreTime?>? = previousCoreTimes
                previousCoreTimes = cores.cores
                previous?.let { CoreUtilization.between(it, cores.cores) }?.takeIf { it.isNotEmpty() }
            }
            CoreTimesResult.NotDeviceOwner -> noCpu(CpuUnavailable.NOT_DEVICE_OWNER)
            CoreTimesResult.NotSupported -> noCpu(CpuUnavailable.NOT_SUPPORTED)
        }
    }

    private fun noCpu(reason: CpuUnavailable): Map<String, Map<String, Double>>? {
        cpuSource = CpuSource.NONE
        cpuUnavailable = reason
        previousCoreTimes = null
        return null
    }

    private fun readMemory(): MemoryReading? {
        val info: Map<String, Long> = readFile(PROC_MEMINFO)?.let { MemInfoParser.parse(it) }.orEmpty()
        val total: Long? = info["MemTotal"]
        val available: Long? = info["MemAvailable"]
        if (total != null && total > 0 && available != null) {
            return MemoryReading(total, available.coerceIn(0L, total), info["MemFree"])
        }
        return try {
            val manager: ActivityManager = context.getSystemService(ActivityManager::class.java) ?: return null
            val memoryInfo = ActivityManager.MemoryInfo()
            manager.getMemoryInfo(memoryInfo)
            if (memoryInfo.totalMem <= 0) null else MemoryReading(memoryInfo.totalMem, memoryInfo.availMem, null)
        } catch (_: RuntimeException) {
            null
        }
    }

    private fun readDataFilesystem(): FilesystemReading? =
        try {
            val dataDirectory: File = Environment.getDataDirectory()
            val stat = StatFs(dataDirectory.path)
            val blockSize: Long = stat.blockSizeLong
            val mount: MountEntry? = readFile(PROC_SELF_MOUNTS)?.let { MountsParser.find(MountsParser.parse(it), dataDirectory.path) }
            FilesystemReading(
                device = mount?.device ?: "data",
                mountpoint = dataDirectory.path,
                type = mount?.type ?: "unknown",
                mode = mount?.mode ?: "rw",
                totalBytes = stat.blockCountLong * blockSize,
                freeBytes = stat.freeBlocksLong * blockSize,
                availableBytes = stat.availableBlocksLong * blockSize,
            ).takeIf { it.totalBytes > 0 }
        } catch (_: RuntimeException) {
            null
        }

    private fun readNetwork(): NetworkReading? {
        val received: Long = TrafficStats.getTotalRxBytes()
        val transmitted: Long = TrafficStats.getTotalTxBytes()
        if (received == TrafficStats.UNSUPPORTED.toLong() || transmitted == TrafficStats.UNSUPPORTED.toLong()) {
            return null
        }
        val receivedPackets: Long = TrafficStats.getTotalRxPackets()
        val transmittedPackets: Long = TrafficStats.getTotalTxPackets()
        val packetsKnown: Boolean = receivedPackets >= 0 && transmittedPackets >= 0
        return NetworkReading(
            receivedBytes = received,
            transmittedBytes = transmitted,
            receivedPackets = if (packetsKnown) receivedPackets else null,
            transmittedPackets = if (packetsKnown) transmittedPackets else null,
        )
    }

    private fun readBattery(): BatteryReading? {
        val intent: Intent =
            try {
                context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            } catch (_: RuntimeException) {
                null
            } ?: return null
        return BatteryReadings.from(
            present = intent.getBooleanExtra(BatteryManager.EXTRA_PRESENT, true),
            level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
            scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1),
            status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1),
            plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0),
            temperatureTenths = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE),
        )
    }

    private fun readThermal(): ThermalReading? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return null
        }
        return try {
            val power: PowerManager = context.getSystemService(PowerManager::class.java) ?: return null
            val headroom: Double? =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    power.getThermalHeadroom(0).toDouble().takeIf { it.isFinite() && it >= 0 }
                } else {
                    null
                }
            ThermalReading(status = power.currentThermalStatus, headroom = headroom)
        } catch (_: RuntimeException) {
            null
        }
    }

    companion object {
        const val PROC_STAT: String = "/proc/stat"
        const val PROC_LOADAVG: String = "/proc/loadavg"
        const val PROC_MEMINFO: String = "/proc/meminfo"
        const val PROC_SELF_MOUNTS: String = "/proc/self/mounts"

        /** The file's text, or null when it cannot be read: SELinux denies most of /proc to apps. */
        fun readSmallFile(path: String): String? =
            try {
                File(path).inputStream().use { input ->
                    String(input.readNBytesCompat(256 * 1024), Charsets.UTF_8)
                }
            } catch (_: Exception) {
                null
            }

        private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
            val buffer = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            while (buffer.size() < limit) {
                val read: Int = read(chunk, 0, minOf(chunk.size, limit - buffer.size()))
                if (read < 0) {
                    break
                }
                buffer.write(chunk, 0, read)
            }
            return buffer.toByteArray()
        }

        /**
         * The device's addresses on its active network, as `host.ip` lists
         * them: loopback and link-local addresses, which say nothing outside
         * the device, left out.
         */
        fun ipAddresses(context: Context): List<String> =
            try {
                val connectivity: ConnectivityManager = context.getSystemService(ConnectivityManager::class.java)
                val properties: LinkProperties? = connectivity?.activeNetwork?.let { connectivity.getLinkProperties(it) }
                properties?.linkAddresses.orEmpty().map { it.address }.let(::reportableAddresses)
            } catch (_: RuntimeException) {
                emptyList()
            }

        fun reportableAddresses(addresses: List<InetAddress>): List<String> =
            addresses
                .filter { !it.isLoopbackAddress && !it.isLinkLocalAddress && !it.isAnyLocalAddress }
                .sortedBy { if (it is Inet6Address) 1 else 0 }
                .mapNotNull { address -> if (address is Inet6Address) compressIpv6(address.address) else address.hostAddress }
                .distinct()

        /** An IPv6 address as RFC 5952 writes it, "2001:db8::40", whichever form the platform would print. */
        fun compressIpv6(bytes: ByteArray): String {
            if (bytes.size != 16) {
                return bytes.joinToString(":") { (it.toInt() and 0xff).toString(16) }
            }
            val groups: List<Int> = (0 until 8).map { ((bytes[it * 2].toInt() and 0xff) shl 8) or (bytes[it * 2 + 1].toInt() and 0xff) }
            // The longest run of two or more zero groups, the first when two are as long.
            var bestStart = -1
            var bestLength = 0
            var index = 0
            while (index < 8) {
                if (groups[index] == 0) {
                    var end: Int = index
                    while (end < 8 && groups[end] == 0) {
                        end += 1
                    }
                    if (end - index > bestLength && end - index >= 2) {
                        bestStart = index
                        bestLength = end - index
                    }
                    index = end
                } else {
                    index += 1
                }
            }
            if (bestStart < 0) {
                return groups.joinToString(":") { it.toString(16) }
            }
            val head: String = groups.subList(0, bestStart).joinToString(":") { it.toString(16) }
            val tail: String = groups.subList(bestStart + bestLength, 8).joinToString(":") { it.toString(16) }
            return "$head::$tail"
        }
    }
}

/** Battery readings from ACTION_BATTERY_CHANGED's extras, kept apart from Android to be tested on their own. */
object BatteryReadings {
    fun from(
        present: Boolean,
        level: Int,
        scale: Int,
        status: Int,
        plugged: Int,
        temperatureTenths: Int,
    ): BatteryReading? {
        // A kiosk on mains power often has no battery at all.
        if (!present || level < 0 || scale <= 0) {
            return null
        }
        return BatteryReading(
            charge = (level.toDouble() / scale).coerceIn(0.0, 1.0),
            state =
                when (status) {
                    BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
                    BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
                    BatteryManager.BATTERY_STATUS_FULL -> "full"
                    BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
                    else -> "unknown"
                },
            plugged =
                when (plugged) {
                    BatteryManager.BATTERY_PLUGGED_AC -> "ac"
                    BatteryManager.BATTERY_PLUGGED_USB -> "usb"
                    BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
                    8 -> "dock" // BatteryManager.BATTERY_PLUGGED_DOCK, Android 14.
                    0 -> null
                    else -> "other"
                },
            temperatureCelsius = if (temperatureTenths == Int.MIN_VALUE) null else temperatureTenths / 10.0,
        )
    }
}
