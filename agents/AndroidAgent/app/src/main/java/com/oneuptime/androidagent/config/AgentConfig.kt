package com.oneuptime.androidagent.config

import com.oneuptime.androidagent.device.DefaultDeviceName
import com.oneuptime.androidagent.device.DeviceFacts

/** Where the ingestion key came from. */
enum class ConfigSource {
    // The device manager's managed configuration.
    MANAGED,

    // Someone entered it on the device, on the agent's setup screen.
    LOCAL,

    // Nobody has given one yet.
    NONE,
}

/** How the device describes itself in OneUptime. */
data class DeviceIdentity(
    // host.name: the device's name in Hosts and Inventory, and its identity there.
    val name: String,
    val serial: String?,
    val type: String,
    val location: String?,
    val labels: Map<String, String>,
)

/** What a person entered on the setup screen; each null when not entered. */
data class LocalSettings(
    val oneUptimeUrl: String? = null,
    val token: String? = null,
    val deviceName: String? = null,
)

/** The settings the agent runs with, every one resolved to a value. */
data class AgentConfig(
    val endpoint: OtlpEndpoint?,
    // Why the address cannot be used, when it cannot.
    val endpointProblem: EndpointProblem?,
    val token: String?,
    val identity: DeviceIdentity,
    val collectionIntervalSeconds: Int,
    val logcatEnabled: Boolean,
    val logcatMinLevel: LogcatLevel,
    val installedAppsEnabled: Boolean,
    // The settings the device manager set, which the setup screen shows as locked.
    val managedKeys: Set<String>,
    val problems: List<ConfigProblem>,
) {
    /** Whether there is somewhere to send telemetry and a key to send it with. */
    val isReady: Boolean get() = endpoint != null && !token.isNullOrBlank()

    val source: ConfigSource
        get() =
            when {
                ManagedConfigKeys.ONEUPTIME_TOKEN in managedKeys -> ConfigSource.MANAGED
                !token.isNullOrBlank() -> ConfigSource.LOCAL
                else -> ConfigSource.NONE
            }
}

/**
 * Merges the device manager's settings, the setup screen's and the defaults,
 * one setting at a time: a setting the device manager set wins, then one
 * entered on the device, then the default. So a fleet can push the key and
 * the URL, and still leave each device's name to whoever sets it up.
 */
object ConfigResolver {
    const val DEFAULT_INTERVAL_SECONDS: Int = 60
    const val DEFAULT_DEVICE_TYPE: String = "Android device"
    val DEFAULT_LOGCAT_LEVEL: LogcatLevel = LogcatLevel.WARN

    fun resolve(managed: ManagedSettings, local: LocalSettings, facts: DeviceFacts): AgentConfig {
        val url: String = managed.oneUptimeUrl ?: local.oneUptimeUrl?.takeIf { it.isNotBlank() } ?: EndpointParser.DEFAULT_URL
        val endpointResult: EndpointResult = EndpointParser.parse(url)

        val identity =
            DeviceIdentity(
                name = managed.deviceName ?: local.deviceName?.trim()?.takeIf { it.isNotEmpty() } ?: DefaultDeviceName.of(facts),
                serial = managed.deviceSerial ?: facts.buildSerial,
                type = managed.deviceType ?: DEFAULT_DEVICE_TYPE,
                location = managed.deviceLocation,
                labels = managed.labels.orEmpty(),
            )

        return AgentConfig(
            endpoint = (endpointResult as? EndpointResult.Valid)?.endpoint,
            endpointProblem = (endpointResult as? EndpointResult.Invalid)?.problem,
            token = managed.token ?: local.token?.trim()?.takeIf { it.isNotEmpty() },
            identity = identity,
            collectionIntervalSeconds = managed.collectionIntervalSeconds ?: DEFAULT_INTERVAL_SECONDS,
            logcatEnabled = managed.logcatEnabled ?: true,
            logcatMinLevel = managed.logcatMinLevel ?: DEFAULT_LOGCAT_LEVEL,
            installedAppsEnabled = managed.installedAppsEnabled ?: true,
            managedKeys = managed.presentKeys,
            problems = managed.problems,
        )
    }
}
