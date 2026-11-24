package com.oneuptime.androidagent.ui

import com.oneuptime.androidagent.agent.AgentGrant
import com.oneuptime.androidagent.agent.AgentPermissions

/**
 * The adb commands still to run before the agent reads every app's logs and
 * crash stacks on this device: all of them at once, so whoever is at the
 * device (or at Esper's Secure Remote ADB) runs them in one go rather than
 * finding the next one after the last. The grants they give are the ones
 * every report tells OneUptime are missing (AgentPermissions).
 */
object GrantCommands {
    fun missing(
        logcatEnabled: Boolean,
        readLogsGranted: Boolean,
        // READ_DROPBOX_DATA exists on this device (Android 15 and later) and is not granted.
        readDropBoxDataMissing: Boolean,
        usageAccessGranted: Boolean,
    ): List<String> =
        AgentPermissions.missing(logcatEnabled, readLogsGranted, readDropBoxDataMissing, usageAccessGranted)
            .map { grant: AgentGrant -> grant.command }
}
