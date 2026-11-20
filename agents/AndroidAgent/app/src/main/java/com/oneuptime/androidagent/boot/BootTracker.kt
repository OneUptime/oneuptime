package com.oneuptime.androidagent.boot

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.config.KeyValueStore
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.otlp.attributes
import com.oneuptime.androidagent.otlp.millisToNanos

/** The boot the device is in. */
data class BootInfo(
    // /proc/sys/kernel/random/boot_id: new at every boot. Null where it cannot be read.
    val bootId: String?,
    // Settings.Global.BOOT_COUNT, Android 7 and later. Null where unknown.
    val bootCount: Int?,
    // When it booted, by the wall clock.
    val bootTimeMillis: Long,
)

enum class PreviousShutdown(val value: String) {
    // The device announced it was shutting down (ACTION_SHUTDOWN) before it went.
    CLEAN("clean"),

    // The agent was running and saw no shutdown: power lost, a crash, a forced reset.
    UNEXPECTED("unexpected"),

    // The agent was not running when the device went down, so it cannot tell.
    UNKNOWN("unknown"),
}

/**
 * What Android kept of why the device rebooted (DropBox's SYSTEM_LAST_KMSG,
 * which the agent reads with READ_LOGS and usage access).
 */
data class RebootFacts(
    // The reason the bootloader passed the kernel: "reboot,shell", "kernel_panic", "watchdog", "shutdown,battery".
    val reason: String?,
    // "Kernel panic - not syncing: ...", when the kernel's last log has one.
    val kernelPanic: String?,
    // The kernel's last lines before the reboot, redacted.
    val lastKernelLines: List<String>,
)

/** A boot the agent has not reported yet, and what it knows of the one before. */
data class BootEvent(
    val boot: BootInfo,
    val previousUptimeSeconds: Long?,
    // From when the previous boot was last seen running to this boot: an upper bound.
    val offlineSeconds: Long?,
    val previousShutdown: PreviousShutdown,
    // Boots in the hour up to this one, this one included: 3 or more is a restart loop.
    val bootsInLastHour: Int,
)

/**
 * Notices each boot of the device, and remembers enough of the boot before
 * it to say how long the device had been up, how it went down and how long
 * it stayed down.
 *
 * A boot is recognised by the kernel's boot id, which changes at every boot
 * and nothing else changes; where that cannot be read, by Android's boot
 * count; failing both, by the boot time moving. So a boot is reported once,
 * whether the agent hears of it from BOOT_COMPLETED or only notices it when
 * it next runs.
 */
class BootTracker(private val store: KeyValueStore, private val clock: Clock) {
    /**
     * Compares [current] with the boot last recorded, records it, and returns
     * the event to report when it is a new one. The very first boot the agent
     * sees is recorded, not reported: it does not know the device just started.
     */
    @Synchronized
    fun observe(current: BootInfo): BootEvent? {
        val storedId: String? = store.getString(KEY_BOOT_ID)
        val firstEver: Boolean = isFirstEver()
        val isNewBoot: Boolean = isNew(current)

        if (!firstEver && !isNewBoot) {
            return null
        }

        val event: BootEvent? = if (isNewBoot) eventFor(current, storedId) else null

        val recent: List<Long> =
            (recentBoots() + current.bootTimeMillis).filter { current.bootTimeMillis - it < RECENT_WINDOW_MILLIS }.takeLast(MAX_RECENT)
        store.edit {
            putString(KEY_BOOT_ID, current.bootId)
            putLong(KEY_BOOT_COUNT, current.bootCount?.toLong())
            putLong(KEY_BOOT_TIME, current.bootTimeMillis)
            putString(KEY_RECENT_BOOTS, recent.joinToString(","))
            putLong(KEY_LAST_ALIVE_AT, null)
            putLong(KEY_LAST_UPTIME_MILLIS, null)
            putLong(KEY_LAST_ALIVE_BY_SERVICE, null)
        }
        return event?.copy(bootsInLastHour = recent.size)
    }

    /**
     * Whether [current] is a boot the agent has not reported yet, without
     * recording it: [observe] records it. The very first boot the agent sees
     * is not one, as [observe] does not report it either.
     */
    @Synchronized
    fun isNew(current: BootInfo): Boolean {
        if (isFirstEver()) {
            return false
        }
        val storedId: String? = store.getString(KEY_BOOT_ID)
        val storedCount: Long? = store.getLong(KEY_BOOT_COUNT)
        val storedTime: Long? = store.getLong(KEY_BOOT_TIME)
        return when {
            current.bootId != null && storedId != null -> current.bootId != storedId
            current.bootCount != null && storedCount != null -> current.bootCount.toLong() != storedCount
            storedTime != null -> kotlin.math.abs(current.bootTimeMillis - storedTime) > BOOT_TIME_TOLERANCE_MILLIS
            else -> false
        }
    }

    /** The device's boots in the hour up to [nowMillis], the current one included once it is recorded. */
    @Synchronized
    fun bootsInLastHour(nowMillis: Long): Int = recentBoots().count { nowMillis - it in 0 until RECENT_WINDOW_MILLIS }

    private fun isFirstEver(): Boolean =
        store.getString(KEY_BOOT_ID) == null && store.getLong(KEY_BOOT_COUNT) == null && store.getLong(KEY_BOOT_TIME) == null

    /** Called at each collection: the device is up, and has been for this long. */
    @Synchronized
    fun recordAlive(byService: Boolean) {
        store.edit {
            putLong(KEY_LAST_ALIVE_AT, clock.nowMillis())
            putLong(KEY_LAST_UPTIME_MILLIS, clock.elapsedRealtimeMillis())
            putLong(KEY_LAST_ALIVE_BY_SERVICE, if (byService) 1L else 0L)
        }
    }

    /** Called on ACTION_SHUTDOWN: the device is going down cleanly. */
    @Synchronized
    fun recordShutdown(): LogRecord {
        val now: Long = clock.nowMillis()
        val uptimeSeconds: Long = clock.elapsedRealtimeMillis() / 1000
        store.edit {
            putLong(KEY_SHUTDOWN_AT, now)
            putString(KEY_SHUTDOWN_BOOT_ID, store.getString(KEY_BOOT_ID))
            putLong(KEY_LAST_UPTIME_MILLIS, clock.elapsedRealtimeMillis())
        }
        return LogRecord(
            timeUnixNano = millisToNanos(now),
            observedTimeUnixNano = millisToNanos(now),
            severity = Severity.INFO,
            body = "Device shutting down after ${formatDuration(uptimeSeconds)} up.",
            attributes =
                attributes {
                    text("event.name", "device.shutdown")
                    int("android.boot.uptime", uptimeSeconds)
                },
        )
    }

    private fun eventFor(current: BootInfo, previousBootId: String?): BootEvent {
        val lastAliveAt: Long? = store.getLong(KEY_LAST_ALIVE_AT)
        val lastUptime: Long? = store.getLong(KEY_LAST_UPTIME_MILLIS)
        val aliveByService: Boolean = store.getLong(KEY_LAST_ALIVE_BY_SERVICE) == 1L
        val shutdownAt: Long? = store.getLong(KEY_SHUTDOWN_AT)
        val shutdownBootId: String? = store.getString(KEY_SHUTDOWN_BOOT_ID)

        val cleanShutdown: Boolean =
            shutdownAt != null && (previousBootId == null || shutdownBootId == previousBootId) &&
                (lastAliveAt == null || shutdownAt >= lastAliveAt - SHUTDOWN_SLACK_MILLIS)

        val previousShutdown: PreviousShutdown =
            when {
                cleanShutdown -> PreviousShutdown.CLEAN
                aliveByService -> PreviousShutdown.UNEXPECTED
                else -> PreviousShutdown.UNKNOWN
            }

        val lastSeenUp: Long? = if (cleanShutdown) shutdownAt else lastAliveAt
        val offlineSeconds: Long? = lastSeenUp?.let { (current.bootTimeMillis - it) / 1000 }?.takeIf { it >= 0 }

        store.edit {
            putLong(KEY_SHUTDOWN_AT, null)
            putString(KEY_SHUTDOWN_BOOT_ID, null)
        }

        return BootEvent(
            boot = current,
            previousUptimeSeconds = lastUptime?.let { it / 1000 },
            offlineSeconds = offlineSeconds,
            previousShutdown = previousShutdown,
            bootsInLastHour = 1,
        )
    }

    private fun recentBoots(): List<Long> =
        store.getString(KEY_RECENT_BOOTS).orEmpty().split(',').mapNotNull { it.trim().toLongOrNull() }

    companion object {
        private const val KEY_BOOT_ID: String = "boot.id"
        private const val KEY_BOOT_COUNT: String = "boot.count"
        private const val KEY_BOOT_TIME: String = "boot.time"
        private const val KEY_RECENT_BOOTS: String = "boot.recent"
        private const val KEY_LAST_ALIVE_AT: String = "boot.last_alive_at"
        private const val KEY_LAST_UPTIME_MILLIS: String = "boot.last_uptime_millis"
        private const val KEY_LAST_ALIVE_BY_SERVICE: String = "boot.last_alive_by_service"
        private const val KEY_SHUTDOWN_AT: String = "boot.shutdown_at"
        private const val KEY_SHUTDOWN_BOOT_ID: String = "boot.shutdown_boot_id"

        private const val BOOT_TIME_TOLERANCE_MILLIS: Long = 2 * 60_000
        private const val RECENT_WINDOW_MILLIS: Long = 60 * 60_000
        private const val MAX_RECENT: Int = 20
        private const val SHUTDOWN_SLACK_MILLIS: Long = 5 * 60_000

        // Before this, the clock was not set when the device booted: the record is stamped when it is read instead.
        private const val PLAUSIBLE_TIME_MILLIS: Long = 1_577_836_800_000L // 2020-01-01

        fun record(event: BootEvent, nowMillis: Long, reboot: RebootFacts? = null): LogRecord {
            val time: Long = if (event.boot.bootTimeMillis >= PLAUSIBLE_TIME_MILLIS) event.boot.bootTimeMillis else nowMillis
            val loop: Boolean = event.bootsInLastHour >= RESTART_LOOP_BOOTS
            val panicked: Boolean = reboot?.kernelPanic != null
            return LogRecord(
                timeUnixNano = millisToNanos(time),
                observedTimeUnixNano = millisToNanos(nowMillis),
                severity = if (loop || panicked || event.previousShutdown == PreviousShutdown.UNEXPECTED) Severity.WARN else Severity.INFO,
                body = describe(event, reboot),
                attributes =
                    attributes {
                        text("event.name", "device.boot")
                        text("android.boot.id", event.boot.bootId)
                        int("android.boot.count", event.boot.bootCount?.toLong())
                        int("android.boot.previous_uptime", event.previousUptimeSeconds)
                        int("android.boot.offline_duration", event.offlineSeconds)
                        text("android.boot.previous_shutdown", event.previousShutdown.value)
                        int("android.boot.recent_count", event.bootsInLastHour.toLong())
                        text("android.boot.reason", reboot?.reason)
                        text("android.boot.kernel_panic", reboot?.kernelPanic)
                        text("android.boot.last_kernel_log", reboot?.lastKernelLines?.joinToString("\n")?.takeIf { it.isNotBlank() })
                    },
            )
        }

        const val RESTART_LOOP_BOOTS: Int = 3

        /** The record's body: "Device started (boot 42). It had been up for 3d 4h 10m, and shut down cleanly. ..." */
        fun describe(event: BootEvent, reboot: RebootFacts? = null): String {
            val sentences: MutableList<String> = mutableListOf()
            sentences.add("Device started" + (event.boot.bootCount?.let { " (boot $it)" } ?: "") + ".")

            val uptime: String? = event.previousUptimeSeconds?.let { "It had been up for ${formatDuration(it)}" }
            val ending: String? =
                when (event.previousShutdown) {
                    PreviousShutdown.CLEAN -> "shut down cleanly"
                    PreviousShutdown.UNEXPECTED -> "went down without shutting down: power lost, a crash or a forced reset"
                    PreviousShutdown.UNKNOWN -> null
                }
            when {
                uptime != null && ending != null -> sentences.add("$uptime, and $ending.")
                uptime != null -> sentences.add("$uptime.")
                ending != null -> sentences.add("It $ending.")
            }

            event.offlineSeconds?.let { seconds ->
                // A clean shutdown says when the device went down; otherwise it was last seen up then.
                val bound: String = if (event.previousShutdown == PreviousShutdown.CLEAN) "" else "at most "
                sentences.add("It was off for $bound${formatDuration(seconds)}.")
            }
            reboot?.kernelPanic?.let { sentences.add("The kernel panicked: $it.") }
            reboot?.reason?.let { sentences.add("Android gives the reboot's reason as $it.") }
            if (event.bootsInLastHour >= RESTART_LOOP_BOOTS) {
                sentences.add("It has started ${event.bootsInLastHour} times in the last hour.")
            }
            return sentences.joinToString(" ")
        }

        /** "3d 4h 10m", "2m 5s", "45s". */
        fun formatDuration(totalSeconds: Long): String {
            val seconds: Long = totalSeconds.coerceAtLeast(0)
            val days: Long = seconds / 86_400
            val hours: Long = seconds % 86_400 / 3_600
            val minutes: Long = seconds % 3_600 / 60
            val rest: Long = seconds % 60
            return when {
                days > 0 -> "${days}d ${hours}h ${minutes}m"
                hours > 0 -> "${hours}h ${minutes}m"
                minutes > 0 -> "${minutes}m ${rest}s"
                else -> "${rest}s"
            }
        }
    }
}
