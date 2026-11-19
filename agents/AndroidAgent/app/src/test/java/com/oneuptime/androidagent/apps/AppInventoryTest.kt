package com.oneuptime.androidagent.apps

import com.oneuptime.androidagent.config.MemoryKeyValueStore
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppInventoryTest {
    private val clock = FakeClock(now = 1_795_000_000_000L)
    private val store = MemoryKeyValueStore()
    private val tracker = AppInventoryTracker(store, clock)

    private fun app(
        name: String,
        version: String? = "1.0",
        code: Long = 1,
        system: Boolean = false,
        updatedSystem: Boolean = false,
    ) = InstalledApp(
        packageName = name,
        versionName = version,
        versionCode = code,
        system = system,
        updatedSystem = updatedSystem,
        enabled = true,
        installer = "io.shoonya.shoonyadpc",
        firstInstallTimeMillis = 1_790_000_000_000L,
        lastUpdateTimeMillis = 1_794_000_000_000L,
    )

    private val kiosk = app("com.example.kiosk", "4.2.0", 420)
    private val webView = app("com.google.android.webview", "120.0", 120, system = true, updatedSystem = true)
    private val settings = app("com.android.settings", "14", 34, system = true)

    private fun eventNames(records: List<LogRecord>): List<String> = records.map { it.attributes.toMap()["event.name"] as String }

    @Test
    fun `installed apps and updated system apps are reported, untouched system apps are not`() {
        assertTrue(kiosk.isReported)
        assertTrue(webView.isReported)
        assertFalse(settings.isReported)
    }

    @Test
    fun `the first check reports every reported app once`() {
        val records: List<LogRecord> = tracker.check(listOf(settings, webView, kiosk))

        assertEquals(listOf("android.package.inventory", "android.package.inventory"), eventNames(records))
        assertEquals(listOf("com.example.kiosk 4.2.0 (420)", "com.google.android.webview 120.0 (120)"), records.map { it.body })

        val attributes: Map<String, Any> = records.first().attributes.toMap()
        assertEquals("com.example.kiosk", attributes["android.package.name"])
        assertEquals("4.2.0", attributes["android.package.version_name"])
        assertEquals(420L, attributes["android.package.version_code"])
        assertEquals("io.shoonya.shoonyadpc", attributes["android.package.installer"])
        assertEquals(false, attributes["android.package.system"])
        assertEquals(true, attributes["android.package.enabled"])
        assertEquals("2026-09-21T14:13:20Z", attributes["android.package.first_install_time"])
        assertEquals(Severity.INFO, records.first().severity)
    }

    @Test
    fun `later checks report what changed, and nothing when nothing did`() {
        tracker.check(listOf(kiosk, webView))
        clock.advance(15 * 60_000L)

        assertTrue(tracker.check(listOf(kiosk, webView)).isEmpty())

        val newer: InstalledApp = kiosk.copy(versionName = "4.3.0", versionCode = 430)
        val printer: InstalledApp = app("com.example.printer", "2.0", 20)
        val records: List<LogRecord> = tracker.check(listOf(newer, printer))

        assertEquals(listOf("android.package.updated", "android.package.installed", "android.package.removed"), eventNames(records))
        assertEquals(
            listOf(
                "Updated com.example.kiosk from 4.2.0 (420) to 4.3.0 (430)",
                "Installed com.example.printer 2.0 (20)",
                "Removed com.google.android.webview 120.0 (120)",
            ),
            records.map { it.body },
        )
        val updated: Map<String, Any> = records.first().attributes.toMap()
        assertEquals("4.2.0", updated["android.package.previous_version_name"])
        assertEquals(420L, updated["android.package.previous_version_code"])
    }

    @Test
    fun `a system app updated for the first time is reported as updated, not installed`() {
        tracker.check(listOf(kiosk))
        clock.advance(60_000L)

        val records: List<LogRecord> = tracker.check(listOf(kiosk, webView))

        assertEquals(listOf("android.package.updated"), eventNames(records))
        assertEquals("Updated com.google.android.webview to 120.0 (120)", records.single().body)
        assertNull(records.single().attributes.toMap()["android.package.previous_version_code"])
    }

    @Test
    fun `every app is reported again once a day`() {
        tracker.check(listOf(kiosk))
        clock.advance(AppInventoryTracker.SNAPSHOT_INTERVAL_MILLIS - 1)
        assertTrue(tracker.check(listOf(kiosk)).isEmpty())

        clock.advance(1)
        assertEquals(listOf("android.package.inventory"), eventNames(tracker.check(listOf(kiosk))))
    }

    @Test
    fun `what is stored reads back, and a store that cannot be read starts again`() {
        val known: Map<String, KnownVersion> = mapOf("a" to KnownVersion("1.0", 1), "b" to KnownVersion(null, 2))

        assertEquals(known, AppInventoryTracker.decode(AppInventoryTracker.encode(known)))
        assertTrue(AppInventoryTracker.decode("not json").isEmpty())
        assertTrue(AppInventoryTracker.decode("{\"a\": \"no\"}").isEmpty())
    }

    @Test
    fun `a version without a name is shown by its code`() {
        assertEquals("(7)", KnownVersion(null, 7).toString())
        assertEquals("(7)", KnownVersion(" ", 7).toString())
        assertEquals("1.2 (7)", KnownVersion("1.2", 7).toString())
    }

    @Test
    fun `times are written in UTC, and an unknown time not at all`() {
        val default: java.util.TimeZone = java.util.TimeZone.getDefault()
        try {
            // Whatever zone the device is in.
            java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("Asia/Kolkata"))
            assertEquals("2026-09-21T14:13:20Z", AppInventoryTracker.isoTime(1_790_000_000_000L))
        } finally {
            java.util.TimeZone.setDefault(default)
        }
        assertEquals("1970-01-01T00:00:01Z", AppInventoryTracker.isoTime(1_000L))
        assertNull(AppInventoryTracker.isoTime(0L))
    }
}
