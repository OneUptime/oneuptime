package com.oneuptime.androidagent.otlp

import com.oneuptime.androidagent.config.DeviceIdentity
import com.oneuptime.androidagent.device.DeviceFacts

/**
 * The OpenTelemetry resource every metric and log the agent sends carries:
 * who the device is.
 *
 * It is what makes the device a host in OneUptime (Hosts, and one Inventory
 * item), the same way a server's OpenTelemetry Collector does:
 *
 *   - `host.name` is the device's name and its identity in Hosts and
 *     Inventory. An app on the same device that names it the same way (the
 *     Android Setup guide's `host.name`) joins the same Inventory item.
 *   - `os.type` is "linux", what OpenTelemetry calls Android's kernel; with
 *     `host.name` it tells OneUptime this is a machine's own telemetry.
 *   - `device.manufacturer`, `device.model.name`, `device.firmware.version`,
 *     `host.serial_number`, `host.ip`, `os.name`, `os.version`,
 *     `device.type` and `device.location` fill the host's asset details.
 *
 * And it deliberately leaves out three things:
 *
 *   - `device.id` and `device.model.identifier`, which mark a mobile app's
 *     own (RUM) telemetry: OneUptime would file the device's metrics under a
 *     RUM application, and never make it a host.
 *   - `service.name`, which would make every device in a fleet one
 *     "service" in Services, instead of each its own host.
 */
object DeviceResource {
    // Attributes the resource must never carry, for the reasons above.
    val NEVER_SENT: Set<String> = setOf("device.id", "device.model.identifier", "service.name")

    fun build(
        facts: DeviceFacts,
        identity: DeviceIdentity,
        ipAddresses: List<String>,
        agentVersion: String,
    ): List<Attribute> =
        attributes {
            text("host.name", identity.name)
            text("host.id", facts.androidId)
            text("host.arch", facts.hostArch)
            textList("host.ip", ipAddresses)
            text("host.serial_number", identity.serial)
            text("os.type", "linux")
            text("os.name", "Android")
            text("os.version", facts.androidRelease)
            text("os.build_id", facts.buildId)
            text("os.description", facts.osDescription)
            text("android.os.api_level", facts.sdkInt.toString())
            text("android.os.security_patch", facts.securityPatch)
            text("device.manufacturer", facts.manufacturer)
            text("device.model.name", facts.model)
            text("device.firmware.version", facts.buildDisplay)
            text("device.type", identity.type)
            text("device.location", identity.location)
            text("oneuptime.agent.version", agentVersion)
            identity.labels.forEach { (name, value) -> text("oneuptime.label.$name", value) }
        }.filter { it.key !in NEVER_SENT }
}
