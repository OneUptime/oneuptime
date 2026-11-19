package com.oneuptime.androidagent.logsession

import com.oneuptime.androidagent.config.EndpointParser
import com.oneuptime.androidagent.config.EndpointResult
import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.config.OtlpEndpoint
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.parseJson
import com.oneuptime.androidagent.transport.JsonTransport
import com.oneuptime.androidagent.transport.TransportResult
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogSessionClientTest {
    private val clock = FakeClock()
    private val device = LogSessionDevice("store-0412-kiosk-02", 34, "17.0.20", canSendLogs = true)

    private class Recording(var answer: TransportResult) : JsonTransport {
        val sent: MutableList<Triple<String, String, String>> = mutableListOf()

        override fun postJson(url: String, token: String, json: String): TransportResult {
            sent.add(Triple(url, token, json))
            return answer
        }
    }

    private fun endpoint(url: String): OtlpEndpoint = (EndpointParser.parse(url) as EndpointResult.Valid).endpoint

    @Test
    fun `it asks the same OneUptime the telemetry goes to, beside OTLP`() {
        assertEquals("https://oneuptime.com/telemetry/android-agent/v1/log-sessions", LogSessionClient.urlFor(endpoint("oneuptime.com")))
        assertEquals(
            "https://example.com/oneuptime/telemetry/android-agent/v1/log-sessions",
            LogSessionClient.urlFor(endpoint("https://example.com/oneuptime")),
        )
    }

    @Test
    fun `it says who the device is and what became of its sessions, with the key in the header`() {
        val transport = Recording(TransportResult.Answered(200, body = """{"sessions":[]}"""))
        val reports =
            listOf(
                LogSessionReport("s1", LogSessionStatus.COLLECTING, null, 1_795_000_000_000L, 1_795_001_800_000L),
                LogSessionReport("s2", LogSessionStatus.DECLINED, "Declined on the device.", null, null),
            )

        LogSessionClient(transport, clock).exchange(endpoint("oneuptime.com"), "the-key", device, reports)

        val (url, token, json) = transport.sent.single()
        assertEquals("https://oneuptime.com/telemetry/android-agent/v1/log-sessions", url)
        assertEquals("the-key", token)
        val body: JsonObject = parseJson(json)
        assertEquals("store-0412-kiosk-02", body["hostName"]!!.jsonPrimitive.content)
        assertEquals("34", body["androidApiLevel"]!!.jsonPrimitive.content)
        assertEquals("true", body["canSendLogs"]!!.jsonPrimitive.content)
        val sessions = body["sessions"]!!.jsonArray
        assertEquals("Collecting", sessions[0].jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals("2026-11-18T11:06:40.000Z", sessions[0].jsonObject["startedAt"]!!.jsonPrimitive.content)
        assertEquals("Declined on the device.", sessions[1].jsonObject["statusMessage"]!!.jsonPrimitive.content)
        assertNull(sessions[1].jsonObject["startedAt"])
    }

    @Test
    fun `OneUptime's answer has each session it lists, a session it cannot read left out`() {
        val body =
            """
            {"sessions":[
              {"id":"s1","status":"Requested","durationMinutes":30,"minimumLevel":"debug",
               "requestedAt":"2026-11-19T14:02:00.000Z","requestedByName":"Jane Doe","expiresAt":"2026-11-19T15:02:00Z"},
              {"id":"s2","status":"Cancelled","durationMinutes":15},
              {"id":"","status":"Requested","durationMinutes":15},
              {"id":"s3","status":"Nonsense","durationMinutes":15},
              {"id":"s4","status":"Requested"},
              {"id":"s5","status":"Requested","durationMinutes":100000,"minimumLevel":"error"}
            ]}
            """.trimIndent()

        val sessions: List<LogSessionRequest> = LogSessionClient.parseSessions(body)

        assertEquals(listOf("s1", "s2", "s5"), sessions.map { it.id })
        val first: LogSessionRequest = sessions[0]
        assertEquals(LogSessionStatus.REQUESTED, first.status)
        assertEquals(30, first.durationMinutes)
        assertEquals(LogcatLevel.DEBUG, first.minimumLevel)
        assertEquals("Jane Doe", first.requestedBy)
        assertEquals(IsoTime.parse("2026-11-19T14:02:00Z"), first.requestedAtMillis)
        assertEquals(IsoTime.parse("2026-11-19T15:02:00Z"), first.expiresAtMillis)
        assertEquals(LogSessionStatus.CANCELLED, sessions[1].status)
        // Never longer than four hours, and never quieter than Info.
        assertEquals(LogSessionManager.MAX_DURATION_MINUTES, sessions[2].durationMinutes)
        assertEquals(LogcatLevel.INFO, sessions[2].minimumLevel)
    }

    @Test
    fun `an answer that is not JSON, or not the shape expected, has no sessions`() {
        assertTrue(LogSessionClient.parseSessions("<html>").isEmpty())
        assertTrue(LogSessionClient.parseSessions("[1,2]").isEmpty())
        assertTrue(LogSessionClient.parseSessions("""{"sessions":"no"}""").isEmpty())
        assertTrue(LogSessionClient.parseSessions("").isEmpty())
    }

    @Test
    fun `a OneUptime without log sessions is asked again an hour later, not every minute`() {
        val transport = Recording(TransportResult.Answered(404))
        val client = LogSessionClient(transport, clock)

        assertEquals(LogSessionExchange.NotSupported, client.exchange(endpoint("oneuptime.com"), "k", device, emptyList()))
        assertTrue(client.isPaused())

        clock.advance(LogSessionClient.NOT_SUPPORTED_PAUSE_MILLIS)
        assertFalse(client.isPaused())
    }

    @Test
    fun `a failure is a failure, and asks again next time`() {
        val client = LogSessionClient(Recording(TransportResult.Unreachable("timeout")), clock)
        assertEquals(LogSessionExchange.Failed("timeout"), client.exchange(endpoint("oneuptime.com"), "k", device, emptyList()))
        assertFalse(client.isPaused())

        val refused = LogSessionClient(Recording(TransportResult.Answered(401)), clock)
        assertEquals(LogSessionExchange.Failed("HTTP 401"), refused.exchange(endpoint("oneuptime.com"), "k", device, emptyList()))
    }
}
