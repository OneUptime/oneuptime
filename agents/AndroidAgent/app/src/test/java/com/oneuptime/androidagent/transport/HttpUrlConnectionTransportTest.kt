package com.oneuptime.androidagent.transport

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.ServerSocket
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/* The real HTTP client against a local server: what goes on the wire. */
class HttpUrlConnectionTransportTest {
    private lateinit var server: HttpServer
    private val received: MutableList<Map<String, String?>> = mutableListOf()
    private var bodies: MutableList<ByteArray> = mutableListOf()
    private var status: Int = 200
    private var retryAfter: String? = null

    @Before
    fun startServer() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange: HttpExchange ->
            received.add(
                mapOf(
                    "method" to exchange.requestMethod,
                    "path" to exchange.requestURI.path,
                    "token" to exchange.requestHeaders.getFirst("x-oneuptime-token"),
                    "content-type" to exchange.requestHeaders.getFirst("Content-Type"),
                    "content-encoding" to exchange.requestHeaders.getFirst("Content-Encoding"),
                    "user-agent" to exchange.requestHeaders.getFirst("User-Agent"),
                ),
            )
            bodies.add(exchange.requestBody.readBytes())
            retryAfter?.let { exchange.responseHeaders.add("Retry-After", it) }
            val response: ByteArray = "{\"partialSuccess\":{}}".toByteArray()
            exchange.sendResponseHeaders(status, response.size.toLong())
            exchange.responseBody.use { it.write(response) }
        }
        server.start()
    }

    @After
    fun stopServer() {
        server.stop(0)
    }

    private fun url(path: String = "/otlp/v1/metrics"): String = "http://127.0.0.1:${server.address.port}$path"

    private val transport = HttpUrlConnectionTransport(userAgent = "OneUptimeAndroidAgent/17.0.12 (Android 14; API 34)")

    @Test
    fun `a request carries the key in its header, gzipped JSON in its body, and says who sent it`() {
        val body: ByteArray = Outbox.gzip("{\"resourceMetrics\":[]}".toByteArray())

        val result: TransportResult = transport.post(url(), "the-key", body)

        assertEquals(TransportResult.Answered(200, null, "{\"partialSuccess\":{}}"), result)
        val request: Map<String, String?> = received.single()
        assertEquals("POST", request["method"])
        assertEquals("/otlp/v1/metrics", request["path"])
        assertEquals("the-key", request["token"])
        assertEquals("application/json", request["content-type"])
        assertEquals("gzip", request["content-encoding"])
        assertEquals("OneUptimeAndroidAgent/17.0.12 (Android 14; API 34)", request["user-agent"])
        assertEquals("{\"resourceMetrics\":[]}", String(Outbox.gunzip(bodies.single())))
    }

    @Test
    fun `an error answer is reported with its status and Retry-After`() {
        status = 429
        retryAfter = "30"

        val result: TransportResult = transport.post(url(), "k", Outbox.gzip("{}".toByteArray()))

        assertEquals(429, (result as TransportResult.Answered).status)
        assertEquals(30_000L, result.retryAfterMillis)
    }

    @Test
    fun `a refused key is a 401`() {
        status = 401

        assertEquals(401, (transport.post(url(), "wrong", Outbox.gzip("{}".toByteArray())) as TransportResult.Answered).status)
    }

    @Test
    fun `no server at the address is unreachable, never an exception`() {
        val closedPort: Int = ServerSocket(0).use { it.localPort }

        val result: TransportResult = HttpUrlConnectionTransport("ua", connectTimeoutMillis = 2_000).post("http://127.0.0.1:$closedPort/otlp/v1/logs", "k", byteArrayOf())

        assertTrue(result is TransportResult.Unreachable)
    }
}
