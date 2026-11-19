package com.oneuptime.androidagent.transport

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.config.OtlpEndpoint
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/** Why the last upload did not get through. */
enum class UploadProblem {
    // No network, or OneUptime did not answer.
    UNREACHABLE,

    // 401 or 403: the ingestion key is unknown, revoked, switched off or expired - or a Browser key.
    KEY_REFUSED,

    // 404: the address is not a OneUptime OTLP endpoint.
    NOT_FOUND,

    // 429 or 5xx: OneUptime is busy or failing; it is tried again.
    SERVER_ERROR,

    // 400, 413, 415, 422: OneUptime refused this batch for what it is, so it was dropped.
    BATCH_REFUSED,
}

data class UploadStatus(
    val lastSuccessAtMillis: Long? = null,
    val lastProblem: UploadProblem? = null,
    val lastProblemStatus: Int? = null,
    val lastProblemAtMillis: Long? = null,
    val consecutiveFailures: Int = 0,
    val nextAttemptAtElapsedMillis: Long? = null,
)

/**
 * Takes OneUptime's ingestion key and address from the caller, and sends what
 * the [Outbox] holds, oldest first.
 *
 * Batches of one signal are sent together, up to [maxBatchBytes] of JSON in
 * one request, so a device that comes back after a day offline catches up in
 * a few dozen requests instead of thousands. After a failure it waits
 * ([Backoff]) before trying again; a batch OneUptime refuses for what it is
 * (400, 413, 415, 422) is dropped, since sending it again would only be
 * refused again, and the next is sent. A refused key or a wrong address
 * keeps everything, so nothing is lost while someone fixes the settings.
 */
class Uploader(
    private val outbox: Outbox,
    private val transport: OtlpTransport,
    private val clock: Clock,
    private val backoff: Backoff = Backoff(),
    private val maxBatchBytes: Int = 512 * 1024,
    private val maxFilesPerRequest: Int = 100,
    private val maxRequestsPerDrain: Int = 50,
) {
    @Volatile
    var status: UploadStatus = UploadStatus()
        private set

    /** Forgets the wait after a failure, as when the settings changed and the next try may work. */
    @Synchronized
    fun resetBackoff() {
        status = status.copy(consecutiveFailures = 0, nextAttemptAtElapsedMillis = null)
    }

    /** Sends what is waiting. Returns false when it stopped at a failure or is still waiting after one. */
    @Synchronized
    fun drain(endpoint: OtlpEndpoint, token: String): Boolean {
        val waitUntil: Long? = status.nextAttemptAtElapsedMillis
        if (waitUntil != null && clock.elapsedRealtimeMillis() < waitUntil) {
            return false
        }

        var requests = 0
        for (signal in listOf(Signal.METRICS, Signal.LOGS)) {
            while (requests < maxRequestsPerDrain) {
                val batch: Batch = nextBatch(signal) ?: break
                requests += 1
                val url: String = if (signal == Signal.METRICS) endpoint.metricsUrl else endpoint.logsUrl
                when (val outcome: Outcome = classify(transport.post(url, token, batch.gzippedBody))) {
                    Outcome.Sent -> {
                        outbox.remove(batch.items)
                        status = UploadStatus(lastSuccessAtMillis = clock.nowMillis())
                    }
                    is Outcome.Dropped -> {
                        outbox.remove(batch.items)
                        outbox.countDropped(batch.items.size)
                        status =
                            status.copy(
                                lastProblem = UploadProblem.BATCH_REFUSED,
                                lastProblemStatus = outcome.status,
                                lastProblemAtMillis = clock.nowMillis(),
                            )
                    }
                    is Outcome.Retry -> {
                        val failures: Int = status.consecutiveFailures + 1
                        val wait: Long = backoff.delayMillis(failures, outcome.retryAfterMillis)
                        status =
                            status.copy(
                                lastProblem = outcome.problem,
                                lastProblemStatus = outcome.status,
                                lastProblemAtMillis = clock.nowMillis(),
                                consecutiveFailures = failures,
                                nextAttemptAtElapsedMillis = clock.elapsedRealtimeMillis() + wait,
                            )
                        return false
                    }
                }
            }
        }
        return true
    }

    private class Batch(val items: List<Outbox.Item>, val gzippedBody: ByteArray)

    private sealed interface Outcome {
        data object Sent : Outcome

        data class Dropped(val status: Int) : Outcome

        data class Retry(val problem: UploadProblem, val status: Int?, val retryAfterMillis: Long?) : Outcome
    }

    private fun classify(result: TransportResult): Outcome =
        when (result) {
            is TransportResult.Unreachable -> Outcome.Retry(UploadProblem.UNREACHABLE, null, null)
            is TransportResult.Answered ->
                when (result.status) {
                    in 200..299 -> Outcome.Sent
                    400, 413, 415, 422 -> Outcome.Dropped(result.status)
                    401, 403 -> Outcome.Retry(UploadProblem.KEY_REFUSED, result.status, result.retryAfterMillis)
                    404 -> Outcome.Retry(UploadProblem.NOT_FOUND, result.status, result.retryAfterMillis)
                    else -> Outcome.Retry(UploadProblem.SERVER_ERROR, result.status, result.retryAfterMillis)
                }
        }

    /**
     * The oldest batches of [signal] that fit in one request. One batch is
     * sent as it was stored; several are merged into one request with all
     * their resources. A batch that cannot be read back is dropped.
     */
    private fun nextBatch(signal: Signal): Batch? {
        val pending: List<Outbox.Item> = outbox.pending(signal)
        if (pending.isEmpty()) {
            return null
        }
        if (pending.size == 1) {
            val only: Outbox.Item = pending.first()
            val bytes: ByteArray = outbox.readGzipped(only) ?: return dropUnreadable(signal, only)
            return Batch(listOf(only), bytes)
        }

        val taken: MutableList<Outbox.Item> = mutableListOf()
        val resources: MutableList<JsonElement> = mutableListOf()
        var size = 0
        for (item in pending.take(maxFilesPerRequest)) {
            val json: String? = outbox.read(item)
            val itemResources: JsonArray? =
                json?.let {
                    try {
                        Json.parseToJsonElement(it).jsonObject[signal.resourceKey]?.jsonArray
                    } catch (_: Exception) {
                        null
                    }
                }
            if (itemResources == null) {
                // Unreadable: drop it and carry on with the rest.
                outbox.remove(listOf(item))
                outbox.countDropped(1)
                continue
            }
            if (taken.isNotEmpty() && size + json.length > maxBatchBytes) {
                break
            }
            taken.add(item)
            resources.addAll(itemResources)
            size += json.length
        }
        if (taken.isEmpty()) {
            return nextBatch(signal)
        }
        val merged: String =
            buildJsonObject {
                put(signal.resourceKey, buildJsonArray { resources.forEach { add(it) } })
            }.toString()
        return Batch(taken, Outbox.gzip(merged.toByteArray(Charsets.UTF_8)))
    }

    private fun dropUnreadable(signal: Signal, item: Outbox.Item): Batch? {
        outbox.remove(listOf(item))
        outbox.countDropped(1)
        return nextBatch(signal)
    }
}
