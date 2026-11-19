package com.oneuptime.androidagent.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ManagedConfigParserTest {
    @Test
    fun `a full configuration, as Esper sends it once it has filled in its placeholders`() {
        val settings: ManagedSettings =
            ManagedConfigParser.parse(
                mapOf(
                    "oneuptime_url" to "https://oneuptime.example.com",
                    "oneuptime_token" to " 4c1f2a9e-ingestion-key ",
                    "device_name" to "store-0412-kiosk-02",
                    "device_serial" to "ELO123456",
                    "device_type" to "kiosk",
                    "device_location" to "Store 0412",
                    "labels" to "store=0412, region=emea",
                    "collection_interval_seconds" to 120,
                    "logcat_enabled" to false,
                    "logcat_min_level" to "info",
                    "installed_apps_enabled" to true,
                ),
            )

        assertEquals("https://oneuptime.example.com", settings.oneUptimeUrl)
        assertEquals("4c1f2a9e-ingestion-key", settings.token)
        assertEquals("store-0412-kiosk-02", settings.deviceName)
        assertEquals("ELO123456", settings.deviceSerial)
        assertEquals("kiosk", settings.deviceType)
        assertEquals("Store 0412", settings.deviceLocation)
        assertEquals(mapOf("store" to "0412", "region" to "emea"), settings.labels)
        assertEquals(120, settings.collectionIntervalSeconds)
        assertEquals(false, settings.logcatEnabled)
        assertEquals(LogcatLevel.INFO, settings.logcatMinLevel)
        assertEquals(true, settings.installedAppsEnabled)
        assertEquals(ManagedConfigKeys.ALL.toSet(), settings.presentKeys)
        assertTrue(settings.problems.isEmpty())
    }

    @Test
    fun `nothing set is nothing managed`() {
        assertEquals(ManagedSettings.NONE, ManagedConfigParser.parse(emptyMap()))
    }

    @Test
    fun `a placeholder the device manager did not fill in is no value, and is reported`() {
        // Esper fills ${esper.deviceName} only on Esper Agent 8.00.0764 and later.
        val settings: ManagedSettings =
            ManagedConfigParser.parse(mapOf("device_name" to "\${esper.deviceName}", "device_serial" to "kiosk-\${esper.serialNumber}"))

        assertNull(settings.deviceName)
        assertNull(settings.deviceSerial)
        assertEquals(
            listOf(ConfigProblem.Kind.UNRESOLVED_PLACEHOLDER, ConfigProblem.Kind.UNRESOLVED_PLACEHOLDER),
            settings.problems.map { it.kind },
        )
        assertTrue(settings.presentKeys.isEmpty())
    }

    @Test
    fun `an integer or a switch sent as text is read the same`() {
        val settings: ManagedSettings =
            ManagedConfigParser.parse(
                mapOf("collection_interval_seconds" to " 90 ", "logcat_enabled" to "false", "installed_apps_enabled" to "1"),
            )

        assertEquals(90, settings.collectionIntervalSeconds)
        assertEquals(false, settings.logcatEnabled)
        assertEquals(true, settings.installedAppsEnabled)
    }

    @Test
    fun `the interval is kept between 30 seconds and 10 minutes`() {
        assertEquals(30, ManagedConfigParser.parse(mapOf("collection_interval_seconds" to 5)).collectionIntervalSeconds)
        assertEquals(600, ManagedConfigParser.parse(mapOf("collection_interval_seconds" to 3_600)).collectionIntervalSeconds)
    }

    @Test
    fun `values that cannot be used fall back to their defaults, and are reported`() {
        val settings: ManagedSettings =
            ManagedConfigParser.parse(
                mapOf(
                    "collection_interval_seconds" to "often",
                    "logcat_enabled" to "maybe",
                    "logcat_min_level" to "loud",
                    "labels" to "store=0412, bad name=1",
                ),
            )

        assertNull(settings.collectionIntervalSeconds)
        assertNull(settings.logcatEnabled)
        assertNull(settings.logcatMinLevel)
        assertEquals(mapOf("store" to "0412"), settings.labels)
        assertEquals(
            setOf("collection_interval_seconds", "logcat_enabled", "logcat_min_level", "labels"),
            settings.problems.map { it.key }.toSet(),
        )
        assertTrue(ManagedConfigKeys.LOGCAT_MIN_LEVEL !in settings.presentKeys)
    }

    @Test
    fun `blank values are as good as unset`() {
        val settings: ManagedSettings =
            ManagedConfigParser.parse(mapOf("oneuptime_token" to "  ", "collection_interval_seconds" to "", "logcat_enabled" to ""))

        assertNull(settings.token)
        assertNull(settings.collectionIntervalSeconds)
        assertNull(settings.logcatEnabled)
        assertTrue(settings.problems.isEmpty())
        assertTrue(settings.presentKeys.isEmpty())
    }

    @Test
    fun `Logcat levels are read by name or by Logcat's letter`() {
        assertEquals(LogcatLevel.VERBOSE, LogcatLevel.parse("V"))
        assertEquals(LogcatLevel.DEBUG, LogcatLevel.parse("debug"))
        assertEquals(LogcatLevel.WARN, LogcatLevel.parse("Warning"))
        assertEquals(LogcatLevel.ERROR, LogcatLevel.parse(" e "))
        assertEquals(LogcatLevel.FATAL, LogcatLevel.parse("assert"))
        assertNull(LogcatLevel.parse("silent"))
        assertEquals(listOf('V', 'D', 'I', 'W', 'E', 'F'), LogcatLevel.entries.map { it.letter })
    }
}
