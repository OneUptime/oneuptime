package com.oneuptime.androidagent.agent

/**
 * A grant the agent may still need before it reads every app's logs and
 * crash stacks, named as the adb command that gives it names it.
 */
enum class AgentGrant(val wire: String, val command: String) {
    READ_LOGS("READ_LOGS", AgentEvents.GRANT_COMMAND),

    // DropBox on Android 15 and later, where it asks for this instead of READ_LOGS.
    READ_DROPBOX_DATA("READ_DROPBOX_DATA", AgentEvents.GRANT_DROPBOX_COMMAND),

    // Usage access, which DropBox asks for as well; the person at the device can also allow it in Settings.
    USAGE_ACCESS("GET_USAGE_STATS", AgentEvents.USAGE_ACCESS_COMMAND),
}

/**
 * Which of its grants the agent still lacks on this device (#9967), for its
 * screen - the adb commands still to run - and for OneUptime: every report
 * carries them as the `oneuptime.agent.permissions.missing` resource
 * attribute, so Inventory lists the devices of a fleet that still need
 * them, by their names, serial numbers and device manager IDs, without
 * anyone visiting each device.
 *
 * No app or device policy can give these: READ_LOGS and READ_DROPBOX_DATA
 * are `signature|privileged|development` permissions and usage access an app
 * op, which only adb, the system or the person at the device in Settings
 * can grant. So the agent says what is missing, and how to grant it.
 *
 * The attribute is always sent, "none" once nothing is missing: OneUptime
 * keeps the last value an item was told and never forgets a key, so a
 * device that was granted everything must say so to stop being listed.
 */
object AgentPermissions {
    const val ATTRIBUTE: String = "oneuptime.agent.permissions.missing"
    const val NONE: String = "none"

    fun missing(
        logcatEnabled: Boolean,
        readLogsGranted: Boolean,
        // READ_DROPBOX_DATA exists on this device (Android 15 and later) and is not granted.
        readDropBoxDataMissing: Boolean,
        usageAccessGranted: Boolean,
    ): List<AgentGrant> {
        // The device manager switched off what reads them: nothing to grant.
        if (!logcatEnabled) {
            return emptyList()
        }
        return buildList {
            if (!readLogsGranted) add(AgentGrant.READ_LOGS)
            if (readDropBoxDataMissing) add(AgentGrant.READ_DROPBOX_DATA)
            if (!usageAccessGranted) add(AgentGrant.USAGE_ACCESS)
        }
    }

    /** "READ_LOGS GET_USAGE_STATS", or "none". */
    fun attributeValue(missing: List<AgentGrant>): String = if (missing.isEmpty()) NONE else missing.joinToString(" ") { it.wire }
}
