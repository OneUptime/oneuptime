package com.oneuptime.androidagent.otlp

import com.oneuptime.androidagent.config.DeviceIdentity
import com.oneuptime.androidagent.device.DefaultDeviceName
import com.oneuptime.androidagent.device.DeviceFacts
import com.oneuptime.androidagent.testing.kioskFacts
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * The resource is the contract with OneUptime's ingest: it decides that the
 * device is a Host (host.name with os.type, no client marker), which
 * Inventory item it is (host.name), and the asset facts Inventory shows.
 */
class DeviceResourceTest {
    private val identity =
        DeviceIdentity(
            name = "store-0412-kiosk-02",
            serial = "ELO123456",
            type = "kiosk",
            location = "Store 0412",
            labels = linkedMapOf("store" to "0412", "region" to "emea"),
        )

    private fun build(
        facts: DeviceFacts = kioskFacts(),
        deviceIdentity: DeviceIdentity = identity,
        ips: List<String> = listOf("10.20.30.40", "fd00::40"),
    ): Map<String, Any> = DeviceResource.build(facts, deviceIdentity, ips, "17.0.12").toMap()

    @Test
    fun `the device describes itself the way a host does`() {
        val resource: Map<String, Any> = build()

        assertEquals("store-0412-kiosk-02", resource["host.name"])
        assertEquals("3f2a9c1b7d4e5a60", resource["host.id"])
        assertEquals("arm64", resource["host.arch"])
        assertEquals(listOf("10.20.30.40", "fd00::40"), resource["host.ip"])
        assertEquals("ELO123456", resource["host.serial_number"])
        assertEquals("linux", resource["os.type"])
        assertEquals("Android", resource["os.name"])
        assertEquals("14", resource["os.version"])
        assertEquals("UP1A.231005.007", resource["os.build_id"])
        assertEquals("34", resource["android.os.api_level"])
        assertEquals("2024-06-05", resource["android.os.security_patch"])
        assertEquals("Elo Touch Solutions", resource["device.manufacturer"])
        assertEquals("Elo-i3-15", resource["device.model.name"])
        assertEquals("ELO-I3-15-14.0.0-2024.06", resource["device.firmware.version"])
        assertEquals("kiosk", resource["device.type"])
        assertEquals("Store 0412", resource["device.location"])
        assertEquals("17.0.12", resource["oneuptime.agent.version"])
    }

    @Test
    fun `the OS is described exactly as OpenTelemetry Android describes it`() {
        // So a device running both the agent and an instrumented app keeps one description in Inventory.
        assertEquals("Android Version 14 (Build UP1A.231005.007 API level 34)", build()["os.description"])
    }

    @Test
    fun `labels become oneuptime label attributes`() {
        val resource: Map<String, Any> = build()

        assertEquals("0412", resource["oneuptime.label.store"])
        assertEquals("emea", resource["oneuptime.label.region"])
    }

    @Test
    fun `it never carries what would make the device a RUM app or a service`() {
        val resource: Map<String, Any> = build()

        DeviceResource.NEVER_SENT.forEach { key -> assertFalse("$key must not be sent", resource.containsKey(key)) }
        assertTrue(resource.keys.none { it.startsWith("browser.") })
        assertEquals(setOf("device.id", "device.model.identifier", "service.name"), DeviceResource.NEVER_SENT)
    }

    @Test
    fun `facts Android does not give are left out rather than sent empty`() {
        val facts: DeviceFacts = kioskFacts(androidId = null).copy(securityPatch = null, buildDisplay = "")
        val resource: Map<String, Any> =
            build(facts = facts, deviceIdentity = identity.copy(serial = null, location = null, labels = emptyMap()), ips = emptyList())

        listOf("host.id", "host.ip", "host.serial_number", "android.os.security_patch", "device.firmware.version", "device.location")
            .forEach { key -> assertNull("$key", resource[key]) }
        assertTrue(resource.keys.none { it.startsWith("oneuptime.label.") })
    }

    @Test
    fun `abis map to OpenTelemetry host arch values`() {
        assertEquals("arm64", DeviceFacts.hostArchOf("arm64-v8a"))
        assertEquals("arm32", DeviceFacts.hostArchOf("armeabi-v7a"))
        assertEquals("arm32", DeviceFacts.hostArchOf("armeabi"))
        assertEquals("amd64", DeviceFacts.hostArchOf("x86_64"))
        assertEquals("x86", DeviceFacts.hostArchOf("x86"))
        assertEquals("riscv64", DeviceFacts.hostArchOf("riscv64"))
        assertNull(DeviceFacts.hostArchOf(null))
        assertNull(DeviceFacts.hostArchOf(""))
    }

    @Test
    fun `Build SERIAL's placeholder is no serial`() {
        assertNull(DeviceFacts.usableSerial("unknown"))
        assertNull(DeviceFacts.usableSerial("UNKNOWN"))
        assertNull(DeviceFacts.usableSerial(" "))
        assertNull(DeviceFacts.usableSerial(null))
        assertEquals("R58M12345", DeviceFacts.usableSerial(" R58M12345 "))
    }

    @Test
    fun `an unnamed device is named after its model and Android ID, so a fleet of one model does not share a name`() {
        assertEquals("elo-i3-15-3f2a9c1b", DefaultDeviceName.of(kioskFacts()))
        assertEquals("elo-i3-15", DefaultDeviceName.of(kioskFacts(androidId = null)))
        assertEquals("android-3f2a9c1b", DefaultDeviceName.of(kioskFacts().copy(model = "  ")))
        assertEquals("sm-t510-ab12", DefaultDeviceName.of(kioskFacts(androidId = "AB12").copy(model = "SM-T510")))
    }
}
