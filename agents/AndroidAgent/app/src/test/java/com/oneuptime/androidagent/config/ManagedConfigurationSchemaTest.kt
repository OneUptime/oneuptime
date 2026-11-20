package com.oneuptime.androidagent.config

import android.content.Context
import android.content.RestrictionEntry
import android.content.RestrictionsManager
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.XmlResourceParser
import android.os.Bundle
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oneuptime.androidagent.R
import com.oneuptime.androidagent.config.ConfigRepository.Companion.toMap
import com.oneuptime.androidagent.testing.kioskFacts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.xmlpull.v1.XmlPullParser

/*
 * res/xml/app_restrictions.xml is what device managers show and push; the
 * parser is what reads it. They must name the same keys, with the types the
 * parser expects, or a setting a fleet pushes is silently ignored.
 */
@RunWith(AndroidJUnit4::class)
class ManagedConfigurationSchemaTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    // The type is compiled to RestrictionEntry's TYPE_ numbers.
    private data class Restriction(val key: String, val type: Int, val title: Int, val description: Int, val defaultValue: String?)

    private fun restrictions(): List<Restriction> {
        val parser: XmlResourceParser = context.resources.getXml(R.xml.app_restrictions)
        val found: MutableList<Restriction> = mutableListOf()
        val android = "http://schemas.android.com/apk/res/android"
        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            if (parser.eventType == XmlPullParser.START_TAG && parser.name == "restriction") {
                found.add(
                    Restriction(
                        key = parser.getAttributeValue(android, "key"),
                        type = parser.getAttributeIntValue(android, "restrictionType", -1),
                        title = parser.getAttributeResourceValue(android, "title", 0),
                        description = parser.getAttributeResourceValue(android, "description", 0),
                        defaultValue = parser.getAttributeValue(android, "defaultValue"),
                    ),
                )
            }
        }
        return found
    }

    @Test
    fun `the schema declares exactly the keys the agent reads`() {
        assertEquals(ManagedConfigKeys.ALL, restrictions().map { it.key })
    }

    /*
     * Device managers, and managed Google Play, which shows the settings in
     * every device manager's console straight from the app it lists, find
     * the schema through the manifest: the application's
     * android.content.APP_RESTRICTIONS meta-data, naming the XML. Without it
     * no console shows a single setting.
     */
    @Test
    fun `the manifest names the schema, where device managers and managed Google Play look for it`() {
        val info: ApplicationInfo = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)

        // The name AndroidManifest.xml gives the meta-data.
        assertEquals("android.content.APP_RESTRICTIONS", RestrictionsManager.META_DATA_APP_RESTRICTIONS)
        assertEquals(R.xml.app_restrictions, info.metaData.getInt(RestrictionsManager.META_DATA_APP_RESTRICTIONS))
    }

    @Test
    fun `Android reads every key of the schema from the manifest, as a device manager does`() {
        val manager: RestrictionsManager = context.getSystemService(RestrictionsManager::class.java)

        assertEquals(ManagedConfigKeys.ALL, manager.getManifestRestrictions(context.packageName).map { it.key })
    }

    @Test
    fun `every setting has a title and a description a device manager can show`() {
        restrictions().forEach { restriction ->
            assertTrue(restriction.key, context.getString(restriction.title).isNotBlank())
            assertTrue(restriction.key, context.getString(restriction.description).isNotBlank())
        }
    }

    @Test
    fun `each setting's type is one the parser reads, and its default is the agent's own`() {
        val byKey: Map<String, Restriction> = restrictions().associateBy { it.key }

        assertEquals(RestrictionEntry.TYPE_INTEGER, byKey.getValue(ManagedConfigKeys.COLLECTION_INTERVAL_SECONDS).type)
        assertEquals(ConfigResolver.DEFAULT_INTERVAL_SECONDS.toString(), byKey.getValue(ManagedConfigKeys.COLLECTION_INTERVAL_SECONDS).defaultValue)
        assertEquals(RestrictionEntry.TYPE_BOOLEAN, byKey.getValue(ManagedConfigKeys.LOGCAT_ENABLED).type)
        assertEquals(RestrictionEntry.TYPE_BOOLEAN, byKey.getValue(ManagedConfigKeys.INSTALLED_APPS_ENABLED).type)
        assertEquals(RestrictionEntry.TYPE_CHOICE, byKey.getValue(ManagedConfigKeys.LOGCAT_MIN_LEVEL).type)
        assertEquals(ConfigResolver.DEFAULT_LOGCAT_LEVEL, LogcatLevel.parse(byKey.getValue(ManagedConfigKeys.LOGCAT_MIN_LEVEL).defaultValue))
        assertEquals(EndpointParser.DEFAULT_URL, byKey.getValue(ManagedConfigKeys.ONEUPTIME_URL).defaultValue)
        listOf(
            ManagedConfigKeys.ONEUPTIME_URL,
            ManagedConfigKeys.ONEUPTIME_TOKEN,
            ManagedConfigKeys.DEVICE_NAME,
            ManagedConfigKeys.DEVICE_SERIAL,
            ManagedConfigKeys.DEVICE_TYPE,
            ManagedConfigKeys.DEVICE_LOCATION,
            ManagedConfigKeys.LABELS,
        ).forEach { assertEquals(it, RestrictionEntry.TYPE_STRING, byKey.getValue(it).type) }
    }

    @Test
    fun `every Logcat level the device manager can choose is one the agent reads`() {
        val values: Array<String> = context.resources.getStringArray(R.array.logcat_level_values)
        val labels: Array<String> = context.resources.getStringArray(R.array.logcat_level_entries)

        assertEquals(LogcatLevel.entries.size, values.size)
        assertEquals(values.size, labels.size)
        assertEquals(LogcatLevel.entries.toList(), values.map { LogcatLevel.parse(it) })
    }

    @Test
    fun `the repository reads what a device manager pushed`() {
        val manager: RestrictionsManager = context.getSystemService(RestrictionsManager::class.java)
        val bundle =
            Bundle().apply {
                putString("oneuptime_token", "managed-key")
                putString("device_name", "store-0412-kiosk-02")
                putInt("collection_interval_seconds", 90)
                putBoolean("logcat_enabled", false)
            }
        shadowOf(manager).setApplicationRestrictions(bundle)

        val store = MemoryKeyValueStore()
        val local = LocalSettingsStore(store, TokenVault(store, AesGcmSecretCipher { javax.crypto.KeyGenerator.getInstance("AES").apply { init(256) }.generateKey() }))
        val config: AgentConfig = ConfigRepository(context, local, kioskFacts()).load()

        assertEquals("managed-key", config.token)
        assertEquals("store-0412-kiosk-02", config.identity.name)
        assertEquals(90, config.collectionIntervalSeconds)
        assertEquals(false, config.logcatEnabled)
        assertEquals(ConfigSource.MANAGED, config.source)
        assertNotNull(config.endpoint)
    }

    @Test
    fun `a bundle reads as a map of its values`() {
        val bundle =
            Bundle().apply {
                putString("a", "x")
                putInt("b", 2)
                putBoolean("c", true)
            }

        assertEquals(mapOf("a" to "x", "b" to 2, "c" to true), bundle.toMap())
    }
}
