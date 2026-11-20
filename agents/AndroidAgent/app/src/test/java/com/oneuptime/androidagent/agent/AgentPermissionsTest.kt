package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.config.DeviceIdentity
import com.oneuptime.androidagent.otlp.DeviceResource
import com.oneuptime.androidagent.testing.kioskFacts
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * Which grants the agent still lacks on a device (#9967), as every report
 * tells OneUptime, so Inventory lists the devices of a fleet that need them.
 */
class AgentPermissionsTest {
    @Test
    fun `everything granted is none missing, said as none`() {
        val missing: List<AgentGrant> = AgentPermissions.missing(true, true, false, true)

        assertTrue(missing.isEmpty())
        assertEquals("none", AgentPermissions.attributeValue(missing))
    }

    @Test
    fun `each grant still to give is named as its adb command names it, in the order they are run`() {
        val missing: List<AgentGrant> = AgentPermissions.missing(true, false, true, false)

        assertEquals(listOf(AgentGrant.READ_LOGS, AgentGrant.READ_DROPBOX_DATA, AgentGrant.USAGE_ACCESS), missing)
        assertEquals("READ_LOGS READ_DROPBOX_DATA GET_USAGE_STATS", AgentPermissions.attributeValue(missing))
        assertEquals(
            listOf(
                "adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS",
                "adb shell pm grant com.oneuptime.androidagent android.permission.READ_DROPBOX_DATA",
                "adb shell appops set com.oneuptime.androidagent GET_USAGE_STATS allow",
            ),
            missing.map { it.command },
        )
    }

    @Test
    fun `only usage access missing, as on a device where READ_LOGS was granted and Settings was not visited`() {
        assertEquals("GET_USAGE_STATS", AgentPermissions.attributeValue(AgentPermissions.missing(true, true, false, false)))
    }

    @Test
    fun `with Logcat switched off by the device manager nothing reads them, so none is missing`() {
        assertTrue(AgentPermissions.missing(false, false, true, false).isEmpty())
    }

    @Test
    fun `the screen's commands are the grants every report says are missing`() {
        assertEquals(
            AgentPermissions.missing(true, false, false, false).map { it.command },
            com.oneuptime.androidagent.ui.GrantCommands.missing(
                logcatEnabled = true,
                readLogsGranted = false,
                readDropBoxDataMissing = false,
                usageAccessGranted = false,
            ),
        )
    }

    @Test
    fun `the resource carries them when the cycle knows them, and nothing when it does not`() {
        val identity = DeviceIdentity(name = "store-0412-kiosk-02", serial = null, type = "kiosk", location = null, labels = emptyMap())
        val told: Map<String, Any> =
            DeviceResource.build(kioskFacts(), identity, emptyList(), "17.0.12", listOf(AgentGrant.READ_LOGS)).toMap()
        val granted: Map<String, Any> = DeviceResource.build(kioskFacts(), identity, emptyList(), "17.0.12", emptyList()).toMap()
        val unknown: Map<String, Any> = DeviceResource.build(kioskFacts(), identity, emptyList(), "17.0.12").toMap()

        assertEquals("READ_LOGS", told[AgentPermissions.ATTRIBUTE])
        assertEquals("none", granted[AgentPermissions.ATTRIBUTE])
        assertFalse(unknown.containsKey(AgentPermissions.ATTRIBUTE))
    }
}
