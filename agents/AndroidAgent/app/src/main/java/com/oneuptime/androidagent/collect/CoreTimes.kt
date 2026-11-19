package com.oneuptime.androidagent.collect

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.HardwarePropertiesManager

/** One core's time since the device booted, in milliseconds, as HardwarePropertiesManager gives it. */
data class CoreTime(
    // Time the core spent running something.
    val activeMillis: Long,
    // Time the core was on, idle included.
    val totalMillis: Long,
)

/** What reading the cores came to. */
sealed interface CoreTimesResult {
    /** Each core's time, by its number; null for a core that is offline. */
    data class Read(val cores: List<CoreTime?>) : CoreTimesResult

    /** Android gives the cores' time only to the device owner, and the agent is not it. */
    data object NotDeviceOwner : CoreTimesResult

    /** The agent is the device owner, and this device does not report it. */
    data object NotSupported : CoreTimesResult
}

/** Reads the cores' time: HardwarePropertiesManager on a device, a list in a test. */
fun interface CoreTimesReader {
    fun read(): CoreTimesResult
}

/**
 * Where the agent read CPU use from. Android 7 lets an app read /proc/stat;
 * from Android 8 SELinux keeps it from apps, and the one way Android
 * documents to read CPU use after that is HardwarePropertiesManager's
 * getCpuUsages(), which only the device owner (or the VR service) may call.
 */
enum class CpuSource {
    PROC_STAT,
    HARDWARE_PROPERTIES,

    // Neither: see CpuUnavailable for why.
    NONE,
}

/** Why there is no CPU use to report on this device. */
enum class CpuUnavailable {
    // Android 8 and later, and the agent is not the device owner.
    NOT_DEVICE_OWNER,

    /*
     * The agent is the device owner, and the device reports no CPU use:
     * getCpuUsages() asks the thermal HAL, and on a device with the AIDL
     * thermal HAL Android 13 introduced, AOSP answers it with nothing (its
     * HardwarePropertiesManagerService reads CPU use only from the older
     * HIDL one).
     */
    NOT_SUPPORTED,
}

/**
 * How busy each core was between two readings of HardwarePropertiesManager:
 * the share of the time it was on that it was active.
 *
 * Android gives a core's active time as one figure, without splitting it
 * into user and kernel time as /proc/stat does, so the active share is
 * reported in the hostmetrics `user` state and the rest in `idle`. The busy
 * CPU OneUptime shows (user plus system) and `1 - idle` are then both the
 * active share.
 */
object CoreUtilization {
    fun between(previous: List<CoreTime?>, current: List<CoreTime?>): Map<String, Map<String, Double>> {
        val result: LinkedHashMap<String, Map<String, Double>> = linkedMapOf()
        current.forEachIndexed { index, now ->
            val before: CoreTime = previous.getOrNull(index) ?: return@forEachIndexed
            if (now == null) {
                return@forEachIndexed
            }
            val total: Long = now.totalMillis - before.totalMillis
            val active: Long = now.activeMillis - before.activeMillis
            // A core that was off the whole time, or counters that went back (a core taken offline and on again).
            if (total <= 0 || active < 0) {
                return@forEachIndexed
            }
            val busy: Double = (active.toDouble() / total).coerceIn(0.0, 1.0)
            result["cpu$index"] = linkedMapOf("user" to busy, "idle" to 1.0 - busy)
        }
        return result
    }
}

/** [CoreTimesReader] over HardwarePropertiesManager, for a device on which the agent is the device owner. */
class HardwarePropertiesCoreTimes(private val context: Context) : CoreTimesReader {
    override fun read(): CoreTimesResult {
        return try {
            val policy: DevicePolicyManager? = context.getSystemService(DevicePolicyManager::class.java)
            if (policy?.isDeviceOwnerApp(context.packageName) != true) {
                return CoreTimesResult.NotDeviceOwner
            }
            val hardware: HardwarePropertiesManager =
                context.getSystemService(HardwarePropertiesManager::class.java) ?: return CoreTimesResult.NotSupported
            // Null for each core that is unplugged; empty where the device does not report CPU use.
            val usages = hardware.cpuUsages
            if (usages.isEmpty()) {
                CoreTimesResult.NotSupported
            } else {
                CoreTimesResult.Read(usages.map { usage -> usage?.let { CoreTime(it.active, it.total) } })
            }
        } catch (_: SecurityException) {
            CoreTimesResult.NotDeviceOwner
        } catch (_: RuntimeException) {
            CoreTimesResult.NotSupported
        }
    }
}
