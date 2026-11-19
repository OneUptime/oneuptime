package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.config.AgentConfig
import com.oneuptime.androidagent.config.ConfigResolver
import com.oneuptime.androidagent.config.EndpointProblem
import com.oneuptime.androidagent.config.LocalSettings
import com.oneuptime.androidagent.config.ManagedConfigParser
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.testing.kioskFacts
import com.oneuptime.androidagent.transport.UploadProblem
import com.oneuptime.androidagent.transport.UploadStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentStatusTextTest {
    private fun config(vararg managed: Pair<String, Any?>): AgentConfig =
        ConfigResolver.resolve(ManagedConfigParser.parse(managed.toMap()), LocalSettings(), kioskFacts())

    @Test
    fun `without a key it says it is not set up, and what to do`() {
        val status: AgentStatus = AgentStatusText.of(config(), UploadStatus(), 0)

        assertEquals(Health.NOT_SET_UP, status.health)
        assertEquals("Not set up yet", status.headline)
        assertTrue(status.detail.contains("oneuptime_token"))
    }

    @Test
    fun `a URL that cannot be used is the reason it is not set up`() {
        val status: AgentStatus = AgentStatusText.of(config("oneuptime_url" to "http://example.com", "oneuptime_token" to "k"), UploadStatus(), 0)

        assertEquals(Health.NOT_SET_UP, status.health)
        assertTrue(status.detail.contains("https://"))
    }

    @Test
    fun `set up and not sent yet is starting, then reporting once something got through`() {
        val ready: AgentConfig = config("oneuptime_token" to "k", "device_name" to "kiosk-02")

        assertEquals(Health.STARTING, AgentStatusText.of(ready, UploadStatus(), 0).health)
        val reporting: AgentStatus = AgentStatusText.of(ready, UploadStatus(lastSuccessAtMillis = 1L), 0)
        assertEquals(Health.REPORTING, reporting.health)
        assertEquals("Reporting to OneUptime", reporting.headline)
        assertEquals("As kiosk-02", reporting.detail)
    }

    @Test
    fun `each failure says what is wrong, and that telemetry is kept`() {
        val ready: AgentConfig = config("oneuptime_token" to "k")
        fun failing(problem: UploadProblem, status: Int? = null): AgentStatus =
            AgentStatusText.of(ready, UploadStatus(lastProblem = problem, lastProblemStatus = status, consecutiveFailures = 2), 2_048)

        assertEquals("Can't reach OneUptime", failing(UploadProblem.UNREACHABLE).headline)
        assertEquals("OneUptime refused the ingestion key", failing(UploadProblem.KEY_REFUSED, 403).headline)
        assertTrue(failing(UploadProblem.KEY_REFUSED, 403).detail.contains("403"))
        assertEquals("No OneUptime at this address", failing(UploadProblem.NOT_FOUND, 404).headline)
        assertTrue(failing(UploadProblem.NOT_FOUND, 404).detail.contains("https://oneuptime.com/otlp"))
        assertEquals("OneUptime is not accepting telemetry right now", failing(UploadProblem.SERVER_ERROR, 503).headline)
        UploadProblem.entries.forEach { problem ->
            val status: AgentStatus = failing(problem)
            assertEquals(Health.FAILING, status.health)
            assertTrue(status.detail.endsWith("Telemetry is kept on the device until it can be sent."))
        }
    }

    @Test
    fun `a refused batch after which uploads succeed is not a failure`() {
        val status: AgentStatus =
            AgentStatusText.of(
                config("oneuptime_token" to "k"),
                UploadStatus(lastSuccessAtMillis = 1L, lastProblem = UploadProblem.BATCH_REFUSED, consecutiveFailures = 0),
                0,
            )

        assertEquals(Health.REPORTING, status.health)
    }

    @Test
    fun `every address problem has a sentence`() {
        EndpointProblem.entries.forEach { assertTrue(AgentStatusText.addressProblem(it).isNotBlank()) }
    }

    @Test
    fun `every Logcat state has a sentence, and the one for no permission says how to grant it`() {
        LogcatState.entries.forEach { state ->
            assertTrue(AgentStatusText.logcat(state).isNotBlank())
            assertTrue(AgentEvents.logcatSentence(state).isNotBlank())
        }
        assertTrue(AgentEvents.logcatSentence(LogcatState.NOT_GRANTED).contains("pm grant com.oneuptime.androidagent android.permission.READ_LOGS"))
    }
}
