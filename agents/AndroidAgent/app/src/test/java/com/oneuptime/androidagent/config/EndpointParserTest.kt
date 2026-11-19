package com.oneuptime.androidagent.config

import org.junit.Assert.assertEquals
import org.junit.Test

class EndpointParserTest {
    private fun valid(input: String): String =
        when (val result: EndpointResult = EndpointParser.parse(input)) {
            is EndpointResult.Valid -> result.endpoint.base
            is EndpointResult.Invalid -> throw AssertionError("$input was refused: ${result.problem}")
        }

    private fun problem(input: String?): EndpointProblem =
        when (val result: EndpointResult = EndpointParser.parse(input)) {
            is EndpointResult.Valid -> throw AssertionError("$input was accepted as ${result.endpoint.base}")
            is EndpointResult.Invalid -> result.problem
        }

    @Test
    fun `every way the docs write OneUptime's address is the same endpoint`() {
        listOf(
            "oneuptime.com",
            "https://oneuptime.com",
            "https://oneuptime.com/",
            "https://oneuptime.com/otlp",
            "https://oneuptime.com/otlp/",
            "https://oneuptime.com/otlp/v1/metrics",
            "https://oneuptime.com/otlp/v1/logs",
            "https://oneuptime.com/otlp/v1/traces",
            "  HTTPS://OneUptime.com/otlp  ",
        ).forEach { input -> assertEquals(input, "https://oneuptime.com/otlp", valid(input)) }
    }

    @Test
    fun `the signal paths come from the endpoint`() {
        val endpoint = OtlpEndpoint("https://oneuptime.com/otlp")

        assertEquals("https://oneuptime.com/otlp/v1/metrics", endpoint.metricsUrl)
        assertEquals("https://oneuptime.com/otlp/v1/logs", endpoint.logsUrl)
    }

    @Test
    fun `a self-hosted OneUptime keeps its port and its path`() {
        assertEquals("https://status.example.com:8443/otlp", valid("https://status.example.com:8443"))
        assertEquals("https://example.com/oneuptime/otlp", valid("https://example.com/oneuptime"))
        assertEquals("https://example.com/oneuptime/otlp", valid("https://example.com/oneuptime/otlp/v1"))
    }

    @Test
    fun `http is refused, except for an address that never leaves the machine`() {
        assertEquals(EndpointProblem.NOT_HTTPS, problem("http://oneuptime.com"))
        assertEquals(EndpointProblem.NOT_HTTPS, problem("http://192.168.1.10:3002"))
        assertEquals("http://localhost:3002/otlp", valid("http://localhost:3002"))
        assertEquals("http://10.0.2.2:3002/otlp", valid("http://10.0.2.2:3002"))
        assertEquals("http://127.0.0.1/otlp", valid("http://127.0.0.1"))
        assertEquals("http://[::1]:3002/otlp", valid("http://[::1]:3002"))
    }

    @Test
    fun `what cannot be an OTLP endpoint is refused, saying why`() {
        assertEquals(EndpointProblem.EMPTY, problem(null))
        assertEquals(EndpointProblem.EMPTY, problem("   "))
        assertEquals(EndpointProblem.NOT_A_URL, problem("https://"))
        assertEquals(EndpointProblem.NOT_A_URL, problem("ftp://oneuptime.com"))
        assertEquals(EndpointProblem.NOT_A_URL, problem("https://one uptime.com"))
        assertEquals(EndpointProblem.HAS_QUERY_OR_FRAGMENT, problem("https://oneuptime.com/otlp?token=abc"))
        assertEquals(EndpointProblem.HAS_QUERY_OR_FRAGMENT, problem("https://oneuptime.com/#otlp"))
        assertEquals(EndpointProblem.HAS_CREDENTIALS, problem("https://user:secret@oneuptime.com"))
    }
}
