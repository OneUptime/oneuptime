package com.oneuptime.androidagent.collect

/** Memory, in bytes. */
data class MemoryReading(
    val totalBytes: Long,
    // What the kernel says new work can have without swapping (MemAvailable).
    val availableBytes: Long,
    // Not used at all (MemFree), when the kernel says; at most [availableBytes].
    val freeBytes: Long?,
) {
    val usedBytes: Long get() = (totalBytes - availableBytes).coerceAtLeast(0L)
}

/** One filesystem, in bytes. */
data class FilesystemReading(
    val device: String,
    val mountpoint: String,
    val type: String,
    val mode: String,
    val totalBytes: Long,
    // Free for anyone, the space reserved for the system included.
    val freeBytes: Long,
    // Free for apps.
    val availableBytes: Long,
) {
    val usedBytes: Long get() = (totalBytes - freeBytes).coerceAtLeast(0L)
    val reservedBytes: Long get() = (freeBytes - availableBytes).coerceAtLeast(0L)
}

/** Bytes and packets through every network interface since boot. */
data class NetworkReading(
    val receivedBytes: Long,
    val transmittedBytes: Long,
    val receivedPackets: Long?,
    val transmittedPackets: Long?,
)

data class BatteryReading(
    // 0 to 1.
    val charge: Double,
    // "charging", "discharging", "full" or "not_charging".
    val state: String,
    // "ac", "usb", "wireless", "dock", or null when unplugged.
    val plugged: String?,
    val temperatureCelsius: Double?,
)

data class ThermalReading(
    // PowerManager's thermal status: 0 none to 6 shutdown. Android 10+.
    val status: Int?,
    // How close the device is to throttling, 1.0 being throttled. Android 11+.
    val headroom: Double?,
)

/**
 * Everything one collection read. A reading the device does not allow, or
 * does not have (a kiosk without a battery), is null and is sent as nothing.
 */
data class DeviceSnapshot(
    val timeMillis: Long,
    // When the device booted, by the wall clock: [timeMillis] less the uptime.
    val bootTimeMillis: Long,
    val uptimeSeconds: Double,
    val logicalCpuCount: Int,
    // CPU name ("cpu0") to state ("user") to share of the time since the last reading.
    val cpuUtilization: Map<String, Map<String, Double>>?,
    val loadAverage: LoadAverage?,
    val memory: MemoryReading?,
    val filesystems: List<FilesystemReading>,
    val network: NetworkReading?,
    val battery: BatteryReading?,
    val thermal: ThermalReading?,
    // Boots in the hour up to now, this one included (BootTracker): 3 or more is a restart loop.
    val bootsInLastHour: Int? = null,
    // Days since the security patch level's date (SecurityPatchAge): more than 90 is out of date.
    val securityPatchAgeDays: Int? = null,
)
