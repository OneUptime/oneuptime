package com.oneuptime.androidagent.agent

import android.content.Context
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import com.oneuptime.androidagent.R
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

/**
 * The agent's words, from its string resources in the device's language
 * (res/values-<language>/strings.xml). An interface so a sentence is built
 * the same way on a device and in a test.
 */
interface StringSource {
    fun get(@StringRes id: Int, vararg args: Any): String

    fun plural(@PluralsRes id: Int, count: Int, vararg args: Any): String
}

class ContextStrings(private val context: Context) : StringSource {
    override fun get(id: Int, vararg args: Any): String = context.getString(id, *args)

    override fun plural(id: Int, count: Int, vararg args: Any): String = context.resources.getQuantityString(id, count, *args)
}

/** Works out the status line from the settings and the last upload. */
object AgentStatusText {
    fun of(strings: StringSource, config: AgentConfig, upload: UploadStatus, pendingBytes: Long): AgentStatus {
        if (!config.isReady) {
            val detail: String =
                when {
                    config.endpointProblem != null -> addressProblem(strings, config.endpointProblem)
                    else -> strings.get(R.string.status_not_set_up_detail)
                }
            return AgentStatus(Health.NOT_SET_UP, strings.get(R.string.status_not_set_up), detail)
        }

        val problem: UploadProblem? = upload.lastProblem
        val failing: Boolean = problem != null && upload.consecutiveFailures > 0
        if (failing) {
            val headline: String =
                when (problem) {
                    UploadProblem.UNREACHABLE -> strings.get(R.string.status_unreachable)
                    UploadProblem.KEY_REFUSED -> strings.get(R.string.status_key_refused)
                    UploadProblem.NOT_FOUND -> strings.get(R.string.status_not_found)
                    UploadProblem.SERVER_ERROR -> strings.get(R.string.status_server_error)
                    UploadProblem.BATCH_REFUSED, null -> strings.get(R.string.status_sending_failed)
                }
            val detail: String =
                when (problem) {
                    UploadProblem.UNREACHABLE -> strings.get(R.string.status_unreachable_detail)
                    UploadProblem.KEY_REFUSED -> strings.get(R.string.status_key_refused_detail, upload.lastProblemStatus ?: 401)
                    UploadProblem.NOT_FOUND -> strings.get(R.string.status_not_found_detail, config.endpoint?.base.orEmpty())
                    UploadProblem.SERVER_ERROR ->
                        upload.lastProblemStatus?.let { strings.get(R.string.status_server_error_detail, it) }
                            ?: strings.get(R.string.status_server_error_unknown_detail)
                    UploadProblem.BATCH_REFUSED, null -> strings.get(R.string.status_retrying)
                }
            val withWaiting: String =
                if (pendingBytes > 0) strings.get(R.string.status_detail_and_kept, detail, strings.get(R.string.status_kept)) else detail
            return AgentStatus(Health.FAILING, headline, withWaiting)
        }

        return if (upload.lastSuccessAtMillis != null) {
            AgentStatus(Health.REPORTING, strings.get(R.string.status_reporting), strings.get(R.string.status_as_device, config.identity.name))
        } else {
            AgentStatus(Health.STARTING, strings.get(R.string.status_starting), strings.get(R.string.status_starting_detail, config.identity.name))
        }
    }

    fun addressProblem(strings: StringSource, problem: EndpointProblem): String =
        when (problem) {
            EndpointProblem.EMPTY -> strings.get(R.string.address_empty)
            EndpointProblem.NOT_A_URL -> strings.get(R.string.address_not_a_url)
            EndpointProblem.NOT_HTTPS -> strings.get(R.string.address_not_https)
            EndpointProblem.HAS_QUERY_OR_FRAGMENT -> strings.get(R.string.address_query_or_fragment)
            EndpointProblem.HAS_CREDENTIALS -> strings.get(R.string.address_credentials)
        }

    fun logcat(strings: StringSource, state: LogcatState?): String =
        when (state) {
            null -> strings.get(R.string.logcat_not_started)
            LogcatState.DISABLED -> strings.get(R.string.setup_reading_off_by_manager)
            LogcatState.NOT_GRANTED -> strings.get(R.string.logcat_not_granted)
            LogcatState.CRASHES_AND_ANRS -> strings.get(R.string.logcat_crashes_and_anrs)
            LogcatState.FULL -> strings.get(R.string.logcat_full)
        }
}
