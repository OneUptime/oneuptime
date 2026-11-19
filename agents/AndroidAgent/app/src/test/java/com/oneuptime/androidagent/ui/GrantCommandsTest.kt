package com.oneuptime.androidagent.ui

import com.oneuptime.androidagent.agent.AgentEvents
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GrantCommandsTest {
    @Test
    fun `every grant still missing, at once, in the order to run them`() {
        assertEquals(
            listOf(AgentEvents.GRANT_COMMAND, AgentEvents.GRANT_DROPBOX_COMMAND, AgentEvents.USAGE_ACCESS_COMMAND),
            GrantCommands.missing(logcatEnabled = true, readLogsGranted = false, readDropBoxDataMissing = true, usageAccessGranted = false),
        )
    }

    @Test
    fun `only what is missing`() {
        assertEquals(
            listOf(AgentEvents.USAGE_ACCESS_COMMAND),
            GrantCommands.missing(logcatEnabled = true, readLogsGranted = true, readDropBoxDataMissing = false, usageAccessGranted = false),
        )
        assertTrue(GrantCommands.missing(logcatEnabled = true, readLogsGranted = true, readDropBoxDataMissing = false, usageAccessGranted = true).isEmpty())
    }

    @Test
    fun `with Logcat switched off there is nothing to grant`() {
        assertTrue(GrantCommands.missing(logcatEnabled = false, readLogsGranted = false, readDropBoxDataMissing = true, usageAccessGranted = false).isEmpty())
    }

    @Test
    fun `the commands are the ones adb takes`() {
        assertEquals("adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS", AgentEvents.GRANT_COMMAND)
        assertEquals("adb shell pm grant com.oneuptime.androidagent android.permission.READ_DROPBOX_DATA", AgentEvents.GRANT_DROPBOX_COMMAND)
        assertEquals("adb shell appops set com.oneuptime.androidagent GET_USAGE_STATS allow", AgentEvents.USAGE_ACCESS_COMMAND)
        assertEquals(
            "adb shell dpm set-device-owner com.oneuptime.androidagent/.admin.AgentDeviceAdminReceiver",
            AgentEvents.DEVICE_OWNER_COMMAND,
        )
    }
}
