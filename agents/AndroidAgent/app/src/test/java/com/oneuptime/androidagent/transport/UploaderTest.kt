package com.oneuptime.androidagent.transport

import com.oneuptime.androidagent.config.OtlpEndpoint
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.parseJson
import java.io.File
import kotlin.random.Random
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class UploaderTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val clock = FakeClock(now = 1_795_000_000_000L, elapsed = 1_000_000L)
    private val endpoint = OtlpEndpoint("https://oneuptime.com/otlp")

    private class Request(val url: String, val token: String, val json: JsonObject)

    private val requests: MutableList<Request> = mutableListOf()
    private val answers: ArrayDeque<TransportResult> = ArrayDeque()

    private val transport =
        OtlpTransport { url, token, gzipped ->
            requests.add(Request(url, token, parseJson(String(Outbox.gunzip(gzipped), Charsets.UTF_8))))
            answers.removeFirstOrNull() ?: TransportResult.Answered(200)
        }

    private fun outbox(): Outbox = Outbox(File(folder.root, "outbox"), clock)

    private fun uploader(box: Outbox, maxBatchBytes: Int = 512 * 1024): Uploader =
        Uploader(box, transport, clock, Backoff(baseMillis = 10_000, maxMillis = 600_000, random = Random(7)), maxBatchBytes)

    private fun metrics(id: Int): String = "{\"resourceMetrics\":[{\"id\":$id}]}"

    private fun logs(id: Int): String = "{\"resourceLogs\":[{\"id\":$id}]}"

    private fun ids(request: Request, key: String): List<Int> =
        request.json.getValue(key).jsonArray.map { (it as JsonObject).getValue("id").jsonPrimitive.content.toInt() }

    @Test
    fun `waiting batches go out oldest first, metrics before logs, with the key, and are removed`() {
        val box: Outbox = outbox()
        box.add(Signal.LOGS, logs(1))
        clock.advance(1)
        box.add(Signal.METRICS, metrics(2))

        assertTrue(uploader(box).drain(endpoint, "the-key"))

        assertEquals(listOf("https://oneuptime.com/otlp/v1/metrics", "https://oneuptime.com/otlp/v1/logs"), requests.map { it.url })
        assertTrue(requests.all { it.token == "the-key" })
        assertTrue(box.pending().isEmpty())
    }

    @Test
    fun `a backlog goes out in a few merged requests, every resource kept`() {
        val box: Outbox = outbox()
        (1..30).forEach {
            box.add(Signal.METRICS, metrics(it))
            clock.advance(1)
        }
        val up: Uploader = uploader(box)

        assertTrue(up.drain(endpoint, "k"))

        assertEquals(1, requests.size)
        assertEquals((1..30).toList(), ids(requests.single(), "resourceMetrics"))
        assertEquals(clock.now, up.status.lastSuccessAtMillis)
    }

    @Test
    fun `a merged request stays under its size`() {
        val box: Outbox = outbox()
        (1..10).forEach {
            box.add(Signal.LOGS, logs(it))
            clock.advance(1)
        }

        // Each batch of the first nine is 27 bytes of JSON: three fit in 81.
        assertEquals(27, logs(1).length)
        assertTrue(uploader(box, maxBatchBytes = 81).drain(endpoint, "k"))

        assertEquals(listOf(listOf(1, 2, 3), listOf(4, 5, 6), listOf(7, 8, 9), listOf(10)), requests.map { ids(it, "resourceLogs") })
    }

    @Test
    fun `a batch OneUptime refuses for what it is is dropped, and the rest still go`() {
        val box: Outbox = outbox()
        box.add(Signal.METRICS, metrics(1))
        clock.advance(1)
        box.add(Signal.LOGS, logs(2))
        answers.add(TransportResult.Answered(200))
        answers.add(TransportResult.Answered(400, body = "bad"))
        val up: Uploader = uploader(box)

        assertTrue(up.drain(endpoint, "k"))

        assertEquals(2, requests.size)
        assertTrue(box.pending().isEmpty())
        assertEquals(1L, box.takeDroppedBatches())
        assertEquals(UploadProblem.BATCH_REFUSED, up.status.lastProblem)
    }

    @Test
    fun `a refused key keeps everything and waits before trying again`() {
        val box: Outbox = outbox()
        box.add(Signal.METRICS, metrics(1))
        answers.add(TransportResult.Answered(401))
        val up: Uploader = uploader(box)

        assertFalse(up.drain(endpoint, "wrong"))

        assertEquals(1, box.pending().size)
        assertEquals(UploadProblem.KEY_REFUSED, up.status.lastProblem)
        assertEquals(401, up.status.lastProblemStatus)
        assertEquals(1, up.status.consecutiveFailures)

        // Still waiting: nothing is sent.
        clock.advance(4_000)
        assertFalse(up.drain(endpoint, "wrong"))
        assertEquals(1, requests.size)

        // After the wait it tries again, and success clears the problem.
        clock.advance(10_000)
        assertTrue(up.drain(endpoint, "right"))
        assertTrue(box.pending().isEmpty())
        assertNull(up.status.lastProblem)
        assertEquals(0, up.status.consecutiveFailures)
    }

    @Test
    fun `new settings end the wait at once`() {
        val box: Outbox = outbox()
        box.add(Signal.METRICS, metrics(1))
        answers.add(TransportResult.Answered(404))
        val up: Uploader = uploader(box)
        assertFalse(up.drain(endpoint, "k"))
        assertEquals(UploadProblem.NOT_FOUND, up.status.lastProblem)

        up.resetBackoff()

        assertTrue(up.drain(OtlpEndpoint("https://oneuptime.example.com/otlp"), "k"))
        assertEquals("https://oneuptime.example.com/otlp/v1/metrics", requests.last().url)
    }

    @Test
    fun `waits grow with each failure in a row, and a server's Retry-After is honored`() {
        val box: Outbox = outbox()
        box.add(Signal.METRICS, metrics(1))
        val up: Uploader = uploader(box)

        answers.add(TransportResult.Unreachable("UnknownHostException"))
        up.drain(endpoint, "k")
        val first: Long = up.status.nextAttemptAtElapsedMillis!! - clock.elapsed
        assertEquals(UploadProblem.UNREACHABLE, up.status.lastProblem)
        assertNull(up.status.lastProblemStatus)

        clock.advance(first)
        answers.add(TransportResult.Answered(503, retryAfterMillis = 300_000L))
        up.drain(endpoint, "k")
        assertEquals(UploadProblem.SERVER_ERROR, up.status.lastProblem)
        assertEquals(2, up.status.consecutiveFailures)
        assertEquals(300_000L, up.status.nextAttemptAtElapsedMillis!! - clock.elapsed)

        clock.advance(300_000L)
        answers.add(TransportResult.Answered(429))
        up.drain(endpoint, "k")
        assertEquals(3, up.status.consecutiveFailures)
        assertTrue(up.status.nextAttemptAtElapsedMillis!! - clock.elapsed in 20_000L..40_000L)
    }

    @Test
    fun `a batch that cannot be read back is dropped, and the others still go`() {
        val box: Outbox = outbox()
        box.add(Signal.LOGS, logs(1))
        clock.advance(1)
        val broken: Outbox.Item = box.add(Signal.LOGS, logs(2))!!
        clock.advance(1)
        box.add(Signal.LOGS, logs(3))
        broken.file.writeText("not gzip")

        assertTrue(uploader(box).drain(endpoint, "k"))

        assertEquals(listOf(listOf(1, 3)), requests.map { ids(it, "resourceLogs") })
        assertEquals(1L, box.takeDroppedBatches())
    }

    @Test
    fun `a single batch is sent exactly as it was stored`() {
        val box: Outbox = outbox()
        box.add(Signal.METRICS, metrics(9))

        uploader(box).drain(endpoint, "k")

        assertEquals(parseJson(metrics(9)), requests.single().json)
    }
}
