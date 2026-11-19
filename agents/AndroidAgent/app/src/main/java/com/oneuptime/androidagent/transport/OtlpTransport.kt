package com.oneuptime.androidagent.transport

import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** What one POST to OneUptime came to. */
sealed interface TransportResult {
    data class Answered(val status: Int, val retryAfterMillis: Long? = null, val body: String = "") : TransportResult

    // No answer: no network, DNS, TLS, a timeout.
    data class Unreachable(val reason: String) : TransportResult
}

/** Sends one gzipped OTLP/JSON request to OneUptime. */
fun interface OtlpTransport {
    fun post(url: String, token: String, gzippedJson: ByteArray): TransportResult
}

/** Sends one small, plain JSON request to OneUptime: the log sessions' exchange. */
fun interface JsonTransport {
    fun postJson(url: String, token: String, json: String): TransportResult
}

/**
 * [OtlpTransport] over HttpURLConnection, which Android implements with its
 * own TLS stack: no HTTP library to ship. The ingestion key goes in the
 * `x-oneuptime-token` header, as OneUptime's OTLP endpoint expects, and never
 * in the URL.
 */
class HttpUrlConnectionTransport(
    private val userAgent: String,
    private val connectTimeoutMillis: Int = 15_000,
    private val readTimeoutMillis: Int = 30_000,
) : OtlpTransport, JsonTransport {
    override fun post(url: String, token: String, gzippedJson: ByteArray): TransportResult = send(url, token, gzippedJson, gzipped = true)

    override fun postJson(url: String, token: String, json: String): TransportResult =
        send(url, token, json.toByteArray(Charsets.UTF_8), gzipped = false)

    private fun send(url: String, token: String, payload: ByteArray, gzipped: Boolean): TransportResult {
        var connection: HttpURLConnection? = null
        return try {
            connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = connectTimeoutMillis
            connection.readTimeout = readTimeoutMillis
            connection.doOutput = true
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.setFixedLengthStreamingMode(payload.size)
            connection.setRequestProperty("Content-Type", "application/json")
            if (gzipped) {
                connection.setRequestProperty("Content-Encoding", "gzip")
            }
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", userAgent)
            connection.setRequestProperty(TOKEN_HEADER, token)
            connection.outputStream.use { it.write(payload) }

            val status: Int = connection.responseCode
            val body: String = readLimited(if (status >= 400) connection.errorStream else connection.inputStream)
            TransportResult.Answered(
                status = status,
                retryAfterMillis = RetryAfter.parse(connection.getHeaderField("Retry-After"), System.currentTimeMillis()),
                body = body,
            )
        } catch (error: IOException) {
            TransportResult.Unreachable(error.javaClass.simpleName + (error.message?.let { ": $it" } ?: ""))
        } finally {
            connection?.disconnect()
        }
    }

    private fun readLimited(stream: InputStream?): String {
        if (stream == null) {
            return ""
        }
        return try {
            stream.use { input ->
                val bytes = ByteArray(MAX_BODY_BYTES)
                var total = 0
                while (total < bytes.size) {
                    val read: Int = input.read(bytes, total, bytes.size - total)
                    if (read < 0) {
                        break
                    }
                    total += read
                }
                String(bytes, 0, total, Charsets.UTF_8)
            }
        } catch (_: IOException) {
            ""
        }
    }

    companion object {
        const val TOKEN_HEADER: String = "x-oneuptime-token"
        // An OTLP answer or error is small; so is the log sessions' list, a few hundred bytes a session.
        private const val MAX_BODY_BYTES: Int = 16 * 1024
    }
}

/** A `Retry-After` header, in seconds or as an HTTP date, as milliseconds from [nowMillis]. */
object RetryAfter {
    fun parse(header: String?, nowMillis: Long): Long? {
        val value: String = header?.trim().orEmpty()
        if (value.isEmpty()) {
            return null
        }
        value.toLongOrNull()?.let { seconds -> return (seconds.coerceAtLeast(0)) * 1000 }
        return try {
            val format = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US)
            format.timeZone = TimeZone.getTimeZone("GMT")
            val date: Long = format.parse(value)?.time ?: return null
            (date - nowMillis).coerceAtLeast(0)
        } catch (_: ParseException) {
            null
        }
    }
}
