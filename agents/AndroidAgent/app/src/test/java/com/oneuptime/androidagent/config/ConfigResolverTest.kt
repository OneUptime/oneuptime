package com.oneuptime.androidagent.config

import com.oneuptime.androidagent.testing.kioskFacts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigResolverTest {
    private val facts = kioskFacts()

    @Test
    fun `with nothing set, the defaults apply and there is nothing to send to`() {
        val config: AgentConfig = ConfigResolver.resolve(ManagedSettings.NONE, LocalSettings(), facts)

        assertEquals("https://oneuptime.com/otlp", config.endpoint?.base)
        assertNull(config.token)
        assertFalse(config.isReady)
        assertEquals(ConfigSource.NONE, config.source)
        assertEquals("elo-i3-15-3f2a9c1b", config.identity.name)
        assertEquals("Android device", config.identity.type)
        assertEquals(60, config.collectionIntervalSeconds)
        assertTrue(config.logcatEnabled)
        assertEquals(LogcatLevel.WARN, config.logcatMinLevel)
        assertTrue(config.installedAppsEnabled)
    }

    @Test
    fun `the setup screen's settings apply when the device manager sets none`() {
        val config: AgentConfig =
            ConfigResolver.resolve(
                ManagedSettings.NONE,
                LocalSettings("https://oneuptime.example.com", " key ", " front-desk "),
                facts,
            )

        assertEquals("https://oneuptime.example.com/otlp", config.endpoint?.base)
        assertEquals("key", config.token)
        assertEquals("front-desk", config.identity.name)
        assertTrue(config.isReady)
        assertEquals(ConfigSource.LOCAL, config.source)
    }

    @Test
    fun `the device manager's settings win, one setting at a time`() {
        val managed: ManagedSettings =
            ManagedConfigParser.parse(mapOf("oneuptime_token" to "managed-key", "device_type" to "kiosk"))
        val config: AgentConfig =
            ConfigResolver.resolve(managed, LocalSettings("https://oneuptime.example.com", "local-key", "front-desk"), facts)

        assertEquals("managed-key", config.token)
        assertEquals("kiosk", config.identity.type)
        // Not set by the device manager: what was entered on the device still applies.
        assertEquals("https://oneuptime.example.com/otlp", config.endpoint?.base)
        assertEquals("front-desk", config.identity.name)
        assertEquals(ConfigSource.MANAGED, config.source)
        assertEquals(setOf("oneuptime_token", "device_type"), config.managedKeys)
    }

    @Test
    fun `an address that cannot be used leaves the agent not ready, saying why`() {
        val config: AgentConfig =
            ConfigResolver.resolve(ManagedConfigParser.parse(mapOf("oneuptime_url" to "http://oneuptime.example.com", "oneuptime_token" to "k")), LocalSettings(), facts)

        assertNull(config.endpoint)
        assertEquals(EndpointProblem.NOT_HTTPS, config.endpointProblem)
        assertFalse(config.isReady)
    }

    @Test
    fun `the serial number is the device manager's, else what Android 7 still gives apps`() {
        val legacy = kioskFacts(sdkInt = 25, buildSerial = "R58M12345")

        assertEquals("R58M12345", ConfigResolver.resolve(ManagedSettings.NONE, LocalSettings(), legacy).identity.serial)
        assertEquals(
            "ELO123456",
            ConfigResolver.resolve(ManagedConfigParser.parse(mapOf("device_serial" to "ELO123456")), LocalSettings(), legacy).identity.serial,
        )
        assertNull(ConfigResolver.resolve(ManagedSettings.NONE, LocalSettings(), facts).identity.serial)
    }
}
