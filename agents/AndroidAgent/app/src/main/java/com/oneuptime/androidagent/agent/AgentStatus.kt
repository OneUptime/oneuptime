package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.config.AgentConfig
import com.oneuptime.androidagent.config.EndpointProblem
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.transport.UploadProblem
import com.oneuptime.androidagent.transport.UploadStatus

/** The agent's state in one line, as the notification and the setup screen show it. */
enum class Health {
    // Nothing to send to yet: no ingestion key, or no address OneUptime can be reached at.
    NOT_SET_UP,

    // Collecting, and OneUptime has accepted what it sent.
    REPORTING,

    // Collecting, and waiting for its first upload to go through.
    STARTING,

    // Collecting and keeping it, but the last upload failed.
    FAILING,
}

data class AgentStatus(
    val health: Health,
    val headline: String,
    val detail: String,
)

/** Works out the status line from the settings and the last upload. */
object AgentStatusText {
    fun of(config: AgentConfig, upload: UploadStatus, pendingBytes: Long): AgentStatus {
        if (!config.isReady) {
            val detail: String =
                when {
                    config.endpointProblem != null -> addressProblem(config.endpointProblem)
                    else -> "Enter the ingestion key, or send it from your device manager as oneuptime_token."
                }
            return AgentStatus(Health.NOT_SET_UP, "Not set up yet", detail)
        }

        val problem: UploadProblem? = upload.lastProblem
        val failing: Boolean = problem != null && upload.consecutiveFailures > 0
        if (failing) {
            val waiting: String = if (pendingBytes > 0) " Telemetry is kept on the device until it can be sent." else ""
            val headline: String =
                when (problem) {
                    UploadProblem.UNREACHABLE -> "Can't reach OneUptime"
                    UploadProblem.KEY_REFUSED -> "OneUptime refused the ingestion key"
                    UploadProblem.NOT_FOUND -> "No OneUptime at this address"
                    UploadProblem.SERVER_ERROR -> "OneUptime is not accepting telemetry right now"
                    UploadProblem.BATCH_REFUSED, null -> "Sending failed"
                }
            val detail: String =
                when (problem) {
                    UploadProblem.UNREACHABLE -> "Check the device's network. The agent tries again on its own."
                    UploadProblem.KEY_REFUSED ->
                        "Use a Server ingestion key that is on and not expired (HTTP ${upload.lastProblemStatus ?: 401})."
                    UploadProblem.NOT_FOUND -> "Check the OneUptime URL: ${config.endpoint?.base}."
                    UploadProblem.SERVER_ERROR -> "OneUptime answered ${upload.lastProblemStatus ?: "with an error"}. The agent tries again on its own."
                    UploadProblem.BATCH_REFUSED, null -> "The agent tries again on its own."
                }
            return AgentStatus(Health.FAILING, headline, detail + waiting)
        }

        return if (upload.lastSuccessAtMillis != null) {
            AgentStatus(Health.REPORTING, "Reporting to OneUptime", "As ${config.identity.name}")
        } else {
            AgentStatus(Health.STARTING, "Starting", "As ${config.identity.name}. The first report goes out within a minute.")
        }
    }

    fun addressProblem(problem: EndpointProblem): String =
        when (problem) {
            EndpointProblem.EMPTY -> "Enter your OneUptime URL."
            EndpointProblem.NOT_A_URL -> "The OneUptime URL is not a web address."
            EndpointProblem.NOT_HTTPS -> "The OneUptime URL must start with https://, so the ingestion key is never sent in the clear."
            EndpointProblem.HAS_QUERY_OR_FRAGMENT -> "Remove the ? or # part from the OneUptime URL."
            EndpointProblem.HAS_CREDENTIALS -> "Remove the user name and password from the OneUptime URL."
        }

    fun logcat(state: LogcatState?): String =
        when (state) {
            null -> "Not started"
            LogcatState.DISABLED -> "Off: switched off by your device manager"
            LogcatState.NOT_GRANTED -> "Off: READ_LOGS has not been granted"
            LogcatState.CRASHES_AND_ANRS -> "Crashes and ANRs of every app"
            LogcatState.FULL -> "Every app's logs, crashes and ANRs"
        }
}
