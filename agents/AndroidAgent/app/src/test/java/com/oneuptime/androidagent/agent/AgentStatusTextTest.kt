package com.oneuptime.androidagent.agent

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oneuptime.androidagent.config.AgentConfig
import com.oneuptime.androidagent.config.ConfigResolver
import com.oneuptime.androidagent.config.EndpointProblem
import com.oneuptime.androidagent.config.LocalSettings
import com.oneuptime.androidagent.config.ManagedConfigParser
import com.oneuptime.androidagent.dropbox.DropBoxState
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.testing.kioskFacts
import com.oneuptime.androidagent.transport.UploadProblem
import com.oneuptime.androidagent.transport.UploadStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The status line, read from the agent's string resources: English by default, the device's language otherwise. */
@RunWith(AndroidJUnit4::class)
class AgentStatusTextTest {
    private val strings: StringSource = ContextStrings(ApplicationProvider.getApplicationContext<Context>())

    private fun config(vararg managed: Pair<String, Any?>): AgentConfig =
        ConfigResolver.resolve(ManagedConfigParser.parse(managed.toMap()), LocalSettings(), kioskFacts())

    @Test
    fun `without a key it says it is not set up, and what to do`() {
        val status: AgentStatus = AgentStatusText.of(strings, config(), UploadStatus(), 0)

        assertEquals(Health.NOT_SET_UP, status.health)
        assertEquals("Not set up yet", status.headline)
        assertTrue(status.detail.contains("oneuptime_token"))
    }

    @Test
    fun `a URL that cannot be used is the reason it is not set up`() {
        val status: AgentStatus =
            AgentStatusText.of(strings, config("oneuptime_url" to "http://example.com", "oneuptime_token" to "k"), UploadStatus(), 0)

        assertEquals(Health.NOT_SET_UP, status.health)
        assertTrue(status.detail.contains("https://"))
    }

    @Test
    fun `set up and not sent yet is starting, then reporting once something got through`() {
        val ready: AgentConfig = config("oneuptime_token" to "k", "device_name" to "kiosk-02")

        assertEquals(Health.STARTING, AgentStatusText.of(strings, ready, UploadStatus(), 0).health)
        assertEquals(
            "As kiosk-02. The first report goes out within a minute.",
            AgentStatusText.of(strings, ready, UploadStatus(), 0).detail,
        )
        val reporting: AgentStatus = AgentStatusText.of(strings, ready, UploadStatus(lastSuccessAtMillis = 1L), 0)
        assertEquals(Health.REPORTING, reporting.health)
        assertEquals("Reporting to OneUptime", reporting.headline)
        assertEquals("As kiosk-02", reporting.detail)
    }

    @Test
    fun `each failure says what is wrong, and that telemetry is kept`() {
        val ready: AgentConfig = config("oneuptime_token" to "k")
        fun failing(problem: UploadProblem, status: Int? = null): AgentStatus =
            AgentStatusText.of(strings, ready, UploadStatus(lastProblem = problem, lastProblemStatus = status, consecutiveFailures = 2), 2_048)

        assertEquals("Can't reach OneUptime", failing(UploadProblem.UNREACHABLE).headline)
        assertEquals("OneUptime refused the ingestion key", failing(UploadProblem.KEY_REFUSED, 403).headline)
        assertTrue(failing(UploadProblem.KEY_REFUSED, 403).detail.contains("403"))
        assertTrue(failing(UploadProblem.KEY_REFUSED).detail.contains("401"))
        assertEquals("No OneUptime at this address", failing(UploadProblem.NOT_FOUND, 404).headline)
        assertTrue(failing(UploadProblem.NOT_FOUND, 404).detail.contains("https://oneuptime.com/otlp"))
        assertEquals("OneUptime is not accepting telemetry right now", failing(UploadProblem.SERVER_ERROR, 503).headline)
        assertTrue(failing(UploadProblem.SERVER_ERROR, 503).detail.startsWith("OneUptime answered 503."))
        assertTrue(failing(UploadProblem.SERVER_ERROR).detail.startsWith("OneUptime answered with an error."))
        UploadProblem.entries.forEach { problem ->
            val status: AgentStatus = failing(problem)
            assertEquals(Health.FAILING, status.health)
            assertTrue(status.detail.endsWith("Telemetry is kept on the device until it can be sent."))
        }
    }

    @Test
    fun `nothing waiting to be sent, it does not say that telemetry is kept`() {
        val status: AgentStatus =
            AgentStatusText.of(
                strings,
                config("oneuptime_token" to "k"),
                UploadStatus(lastProblem = UploadProblem.UNREACHABLE, consecutiveFailures = 1),
                0,
            )

        assertEquals("Check the device's network. The agent tries again on its own.", status.detail)
    }

    @Test
    fun `a refused batch after which uploads succeed is not a failure`() {
        val status: AgentStatus =
            AgentStatusText.of(
                strings,
                config("oneuptime_token" to "k"),
                UploadStatus(lastSuccessAtMillis = 1L, lastProblem = UploadProblem.BATCH_REFUSED, consecutiveFailures = 0),
                0,
            )

        assertEquals(Health.REPORTING, status.health)
    }

    @Test
    fun `every address problem has a sentence`() {
        EndpointProblem.entries.forEach { assertTrue(AgentStatusText.addressProblem(strings, it).isNotBlank()) }
    }

    @Test
    fun `every Logcat and DropBox state has a sentence, and the ones for a missing grant say how to grant it`() {
        LogcatState.entries.forEach { state ->
            assertTrue(AgentStatusText.logcat(strings, state).isNotBlank())
            assertTrue(AgentEvents.logcatSentence(state).isNotBlank())
        }
        assertTrue(AgentStatusText.logcat(strings, null).isNotBlank())
        assertTrue(AgentEvents.logcatSentence(LogcatState.NOT_GRANTED).contains("pm grant com.oneuptime.androidagent android.permission.READ_LOGS"))

        DropBoxState.entries.forEach { state -> assertTrue(AgentEvents.dropBoxSentence(state).isNotBlank()) }
        assertTrue(AgentEvents.dropBoxSentence(DropBoxState.NOT_GRANTED).contains(AgentEvents.GRANT_COMMAND))
        assertTrue(AgentEvents.dropBoxSentence(DropBoxState.NOT_GRANTED).contains(AgentEvents.GRANT_DROPBOX_COMMAND))
        assertTrue(AgentEvents.dropBoxSentence(DropBoxState.NO_USAGE_ACCESS).contains(AgentEvents.USAGE_ACCESS_COMMAND))
    }

    @Test
    @Config(qualifiers = "de")
    fun `on a device set to German, the status line is German`() {
        val german: StringSource = ContextStrings(ApplicationProvider.getApplicationContext<Context>())
        val status: AgentStatus = AgentStatusText.of(german, config(), UploadStatus(), 0)

        assertEquals(Health.NOT_SET_UP, status.health)
        assertNotEquals("Not set up yet", status.headline)
        // The key a device manager sends is never translated.
        assertTrue(status.detail.contains("oneuptime_token"))
    }
}
