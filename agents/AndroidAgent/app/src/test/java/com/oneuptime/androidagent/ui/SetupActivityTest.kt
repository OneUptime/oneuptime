package com.oneuptime.androidagent.ui

import android.app.Application
import android.content.Context
import android.content.RestrictionsManager
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.testing.WorkManagerTestInitHelper
import com.oneuptime.androidagent.R
import com.oneuptime.androidagent.agent.AgentRuntime
import com.oneuptime.androidagent.agent.AgentService
import com.oneuptime.androidagent.config.AesGcmSecretCipher
import com.oneuptime.androidagent.config.LocalSettings
import javax.crypto.KeyGenerator
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController

@RunWith(AndroidJUnit4::class)
class SetupActivityTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        AgentRuntime.secretCipher = { AesGcmSecretCipher { key } }
    }

    @After
    fun tearDown() {
        AgentRuntime.resetForTests()
    }

    private fun launch(): SetupActivity {
        val controller: ActivityController<SetupActivity> = Robolectric.buildActivity(SetupActivity::class.java).setup()
        return controller.get()
    }

    private fun SetupActivity.text(id: Int): String = findViewById<TextView>(id).text.toString()

    @Test
    fun `a device nobody has set up says so, and the agent starts`() {
        val activity: SetupActivity = launch()

        assertEquals("Not set up yet", activity.text(R.id.status_headline))
        assertEquals(View.GONE, activity.findViewById<View>(R.id.managed_notice).visibility)
        assertTrue(activity.findViewById<EditText>(R.id.token).isEnabled)
        assertEquals(
            AgentService::class.java.name,
            shadowOf(context as Application).nextStartedService?.component?.className,
        )
    }

    @Test
    fun `the device name field suggests the name the device reports under`() {
        val activity: SetupActivity = launch()

        assertTrue(activity.findViewById<EditText>(R.id.device_name).hint.isNotBlank())
    }

    @Test
    fun `an http URL is refused, saying why`() {
        val activity: SetupActivity = launch()
        activity.findViewById<EditText>(R.id.url).setText("http://oneuptime.example.com")
        activity.findViewById<EditText>(R.id.token).setText("key")

        activity.findViewById<Button>(R.id.save).performClick()

        assertNotNull(activity.findViewById<EditText>(R.id.url).error)
        assertEquals(LocalSettings(), AgentRuntime.get(context).localSettings.read())
    }

    @Test
    fun `saving without a key asks for one`() {
        val activity: SetupActivity = launch()

        activity.findViewById<Button>(R.id.save).performClick()

        assertEquals(activity.getString(R.string.setup_token_required), activity.findViewById<EditText>(R.id.token).error)
    }

    @Test
    fun `saving keeps the settings, the key sealed, and sends a report at once`() {
        val activity: SetupActivity = launch()
        shadowOf(context as Application).clearStartedServices()
        activity.findViewById<EditText>(R.id.url).setText("oneuptime.example.com")
        activity.findViewById<EditText>(R.id.token).setText(" the-key ")
        activity.findViewById<EditText>(R.id.device_name).setText("front-desk")

        activity.findViewById<Button>(R.id.save).performClick()

        assertEquals(
            LocalSettings("oneuptime.example.com", "the-key", "front-desk"),
            AgentRuntime.get(context).localSettings.read(),
        )
        assertEquals(activity.getString(R.string.setup_saved), activity.text(R.id.save_message))
        // The key field is cleared: the key is never shown again.
        assertEquals("", activity.findViewById<EditText>(R.id.token).text.toString())
        assertEquals(activity.getString(R.string.setup_token_stored_hint), activity.findViewById<EditText>(R.id.token).hint)
        assertEquals(AgentService.ACTION_COLLECT_NOW, shadowOf(context).nextStartedService?.action)
        assertEquals("Starting", activity.text(R.id.status_headline))
    }

    @Test
    fun `settings the device manager pushed are shown locked`() {
        val restrictions: RestrictionsManager = context.getSystemService(RestrictionsManager::class.java)
        shadowOf(restrictions).setApplicationRestrictions(
            Bundle().apply {
                putString("oneuptime_token", "managed")
                putString("device_name", "store-0412-kiosk-02")
            },
        )

        val activity: SetupActivity = launch()

        assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.managed_notice).visibility)
        assertFalse(activity.findViewById<EditText>(R.id.token).isEnabled)
        assertFalse(activity.findViewById<EditText>(R.id.device_name).isEnabled)
        assertEquals("store-0412-kiosk-02", activity.findViewById<EditText>(R.id.device_name).text.toString())
        assertTrue(activity.findViewById<EditText>(R.id.url).isEnabled)
        assertTrue(activity.findViewById<Button>(R.id.save).isEnabled)
        assertEquals("Starting", activity.text(R.id.status_headline))
    }

    @Test
    fun `a placeholder the device manager did not fill in, or a value it cannot use, is shown`() {
        val restrictions: RestrictionsManager = context.getSystemService(RestrictionsManager::class.java)
        shadowOf(restrictions).setApplicationRestrictions(
            Bundle().apply {
                putString("oneuptime_token", "managed")
                putString("device_name", "\${esper.deviceName}")
                putString("logcat_min_level", "loud")
            },
        )

        val activity: SetupActivity = launch()
        val problems: TextView = activity.findViewById(R.id.config_problems)

        assertEquals(View.VISIBLE, problems.visibility)
        assertEquals(
            listOf(
                "device_name: your device manager sent \${esper.deviceName} as it is, without filling it in.",
                "logcat_min_level: loud cannot be used, so the default applies.",
            ),
            problems.text.toString().split("\n").sorted(),
        )
    }

    @Test
    fun `no problems, no problem line`() {
        val activity: SetupActivity = launch()

        assertEquals(View.GONE, activity.findViewById<View>(R.id.config_problems).visibility)
    }

    @Test
    fun `it lists what the device lets the agent read, and every grant still missing`() {
        val activity: SetupActivity = launch()
        val readings: LinearLayout = activity.findViewById(R.id.readings)

        // CPU, memory, battery, temperature, Logcat, crash stacks, installed apps.
        assertEquals(7, readings.childCount)
        assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.grant_commands).visibility)
        val commands: List<String> = activity.text(R.id.grant_commands).split("\n")
        assertEquals("adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS", commands.first())
        val usageAccess: Boolean = com.oneuptime.androidagent.dropbox.AndroidDropBoxAccess(activity).usageAccessGranted()
        assertEquals(!usageAccess, commands.contains("adb shell appops set com.oneuptime.androidagent GET_USAGE_STATS allow"))
        assertEquals(if (usageAccess) View.GONE else View.VISIBLE, activity.findViewById<View>(R.id.usage_access).visibility)
        assertNull(activity.findViewById<EditText>(R.id.url).error)
    }

    @Test
    fun `with Logcat switched off by the device manager, nothing is to grant`() {
        val restrictions: RestrictionsManager = context.getSystemService(RestrictionsManager::class.java)
        shadowOf(restrictions).setApplicationRestrictions(Bundle().apply { putBoolean("logcat_enabled", false) })

        val activity: SetupActivity = launch()

        assertEquals(View.GONE, activity.findViewById<View>(R.id.grant_commands).visibility)
        assertEquals(View.GONE, activity.findViewById<View>(R.id.usage_access).visibility)
    }
}
