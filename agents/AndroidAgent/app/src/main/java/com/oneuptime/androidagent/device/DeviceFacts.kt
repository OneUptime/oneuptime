package com.oneuptime.androidagent.device

import java.util.Locale

/**
 * What the device says about itself, read once per process: none of it
 * changes while the agent runs (an OS update restarts the device, and the
 * agent with it).
 */
data class DeviceFacts(
    val manufacturer: String,
    val model: String,
    // Build.VERSION.RELEASE, "14".
    val androidRelease: String,
    val sdkInt: Int,
    // Build.ID, "UP1A.231005.007".
    val buildId: String,
    // Build.DISPLAY, the build number Settings shows: often the maker's firmware version.
    val buildDisplay: String,
    // Build.VERSION.SECURITY_PATCH, "2024-01-05".
    val securityPatch: String?,
    // Settings.Secure.ANDROID_ID: stable for this app on this device until a factory reset.
    val androidId: String?,
    val supportedAbis: List<String>,
    // Build.SERIAL, which Android stopped giving apps in 8.0.
    val buildSerial: String?,
    val logicalCpuCount: Int,
) {
    /** The OpenTelemetry `host.arch` of the device's primary ABI. */
    val hostArch: String?
        get() = hostArchOf(supportedAbis.firstOrNull())

    /**
     * Exactly as OpenTelemetry Android describes the OS, so a device that runs
     * both the agent and an instrumented app under one name keeps one
     * description in Inventory instead of two that take turns.
     */
    val osDescription: String
        get() = "Android Version $androidRelease (Build $buildId API level $sdkInt)"

    companion object {
        fun hostArchOf(abi: String?): String? =
            when (abi?.lowercase(Locale.ROOT)) {
                "arm64-v8a" -> "arm64"
                "armeabi-v7a", "armeabi" -> "arm32"
                "x86_64" -> "amd64"
                "x86" -> "x86"
                null, "" -> null
                else -> abi
            }

        /** Build.SERIAL, unless it is the placeholder Android gives instead. */
        fun usableSerial(serial: String?): String? {
            val trimmed: String = serial?.trim().orEmpty()
            return if (trimmed.isEmpty() || trimmed.equals("unknown", ignoreCase = true)) null else trimmed
        }
    }
}

/**
 * The name a device reports under when nobody has given it one: its model
 * and the start of its Android ID, "elo-i3-15-3f2a9c1b". A fleet of one model
 * would otherwise share a name, and devices that share a name are one host.
 */
object DefaultDeviceName {
    fun of(facts: DeviceFacts): String {
        val model: String = slug(facts.model).ifEmpty { "android" }
        val suffix: String = slug(facts.androidId.orEmpty()).take(8)
        return if (suffix.isEmpty()) model else "$model-$suffix"
    }

    private fun slug(text: String): String =
        text.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), "-").trim('-')
}
