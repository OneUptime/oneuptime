package com.oneuptime.androidagent.config

import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

/**
 * Where the agent sends its telemetry: OneUptime's OTLP endpoint,
 * `https://oneuptime.com/otlp`, or a self-hosted OneUptime's.
 */
data class OtlpEndpoint(val base: String) {
    val metricsUrl: String get() = "$base/v1/metrics"
    val logsUrl: String get() = "$base/v1/logs"
}

enum class EndpointProblem {
    // Nothing was given.
    EMPTY,

    // It does not read as a web address.
    NOT_A_URL,

    // It is http://, which would send the ingestion key in the clear.
    NOT_HTTPS,

    // It has ?query or #fragment parts, which an OTLP endpoint never has.
    HAS_QUERY_OR_FRAGMENT,

    // It has user:password@ in it.
    HAS_CREDENTIALS,
}

sealed interface EndpointResult {
    data class Valid(val endpoint: OtlpEndpoint) : EndpointResult

    data class Invalid(val problem: EndpointProblem) : EndpointResult
}

/**
 * Reads what a person or a device manager typed as the OneUptime address.
 *
 * People write it every way the docs show it, so each of these is the same
 * endpoint, `https://oneuptime.com/otlp`:
 *
 *   oneuptime.com
 *   https://oneuptime.com/
 *   https://oneuptime.com/otlp
 *   https://oneuptime.com/otlp/v1/metrics
 *
 * A self-hosted OneUptime under a path keeps it: `https://example.com/oneuptime`
 * is `https://example.com/oneuptime/otlp`.
 *
 * Only https is accepted, because every request carries the ingestion key.
 * The exception is an address on the device itself or the emulator's host
 * (localhost, 127.0.0.1, ::1, 10.0.2.2), which never leaves the machine and
 * which the network security config lets through for testing.
 */
object EndpointParser {
    const val DEFAULT_URL: String = "https://oneuptime.com"

    private val LOCAL_HOSTS: Set<String> = setOf("localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2")

    private val SIGNAL_PATH: Regex = Regex("/v1(/(metrics|logs|traces|profiles))?$")

    fun parse(input: String?): EndpointResult {
        val text: String = input?.trim().orEmpty()
        if (text.isEmpty()) {
            return EndpointResult.Invalid(EndpointProblem.EMPTY)
        }

        val withScheme: String = if (text.contains("://")) text else "https://$text"

        val uri: URI =
            try {
                URI(withScheme)
            } catch (_: URISyntaxException) {
                return EndpointResult.Invalid(EndpointProblem.NOT_A_URL)
            }

        val host: String = uri.host?.lowercase(Locale.ROOT).orEmpty()
        if (host.isEmpty()) {
            return EndpointResult.Invalid(EndpointProblem.NOT_A_URL)
        }

        val scheme: String = uri.scheme?.lowercase(Locale.ROOT).orEmpty()
        val secure: Boolean = scheme == "https" || (scheme == "http" && host in LOCAL_HOSTS)
        if (scheme != "https" && scheme != "http") {
            return EndpointResult.Invalid(EndpointProblem.NOT_A_URL)
        }
        if (!secure) {
            return EndpointResult.Invalid(EndpointProblem.NOT_HTTPS)
        }

        if (uri.rawUserInfo != null) {
            return EndpointResult.Invalid(EndpointProblem.HAS_CREDENTIALS)
        }
        if (uri.rawQuery != null || uri.rawFragment != null) {
            return EndpointResult.Invalid(EndpointProblem.HAS_QUERY_OR_FRAGMENT)
        }

        var path: String = uri.rawPath.orEmpty().trimEnd('/')
        path = path.replace(SIGNAL_PATH, "").trimEnd('/')
        if (!path.endsWith("/otlp")) {
            path = "$path/otlp"
        }

        val port: String = if (uri.port == -1) "" else ":${uri.port}"
        val hostPart: String = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        return EndpointResult.Valid(OtlpEndpoint("$scheme://$hostPart$port$path"))
    }
}
