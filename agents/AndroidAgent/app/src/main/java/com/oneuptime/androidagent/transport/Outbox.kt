package com.oneuptime.androidagent.transport

import com.oneuptime.androidagent.Clock
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.Locale
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/** The two kinds of telemetry the agent sends, and the OTLP path each goes to. */
enum class Signal(val fileTag: String, val resourceKey: String) {
    METRICS("metrics", "resourceMetrics"),
    LOGS("logs", "resourceLogs"),
}

/**
 * Telemetry waiting to be sent, on disk: one gzipped OTLP request per file,
 * named so the oldest sorts first. Everything collected goes here before it
 * is sent, so nothing is lost when the network is down, the request fails or
 * the agent is stopped; it is sent, oldest first, once OneUptime can be
 * reached.
 *
 * It is bounded: when it holds more than [maxBytes], or a batch is older than
 * [maxAgeMillis], the oldest batches are dropped and counted, so a device off
 * the network for weeks neither fills its storage nor sends a month of
 * telemetry at once when it comes back.
 *
 * A file is written to a temporary name and renamed into place, so a power
 * cut mid-write leaves a temporary file, deleted the next time the outbox
 * opens, and never half a batch.
 */
class Outbox(
    private val directory: File,
    private val clock: Clock,
    private val maxBytes: Long = DEFAULT_MAX_BYTES,
    private val maxAgeMillis: Long = DEFAULT_MAX_AGE_MILLIS,
) {
    data class Item(val file: File, val signal: Signal, val createdMillis: Long, val sizeBytes: Long)

    private var sequence: Long = 0
    private var droppedBatches: Long = 0

    init {
        directory.mkdirs()
        directory.listFiles()?.filter { it.name.endsWith(TEMP_SUFFIX) }?.forEach { it.delete() }
    }

    /** Stores one OTLP request body. Returns null when it could not be written. */
    @Synchronized
    fun add(signal: Signal, json: String): Item? {
        val created: Long = clock.nowMillis()
        val gzipped: ByteArray = gzip(json.toByteArray(Charsets.UTF_8))
        var target: File
        do {
            sequence += 1
            // Locale.ROOT: in some locales %d writes digits that are not ASCII.
            val name: String = String.format(Locale.ROOT, "%013d-%06d.%s%s", created.coerceAtLeast(0), sequence % 1_000_000, signal.fileTag, SUFFIX)
            target = File(directory, name)
        } while (target.exists())
        val temporary = File(directory, target.name + TEMP_SUFFIX)
        return try {
            temporary.writeBytes(gzipped)
            if (!temporary.renameTo(target)) {
                temporary.delete()
                return null
            }
            prune()
            Item(target, signal, created, gzipped.size.toLong())
        } catch (_: IOException) {
            temporary.delete()
            null
        }
    }

    /** The batches waiting, oldest first; only [signal]'s when given. */
    @Synchronized
    fun pending(signal: Signal? = null): List<Item> =
        (directory.listFiles() ?: emptyArray())
            .filter { it.isFile && it.name.endsWith(SUFFIX) }
            .mapNotNull { parse(it) }
            .filter { signal == null || it.signal == signal }
            .sortedBy { it.file.name }

    @Synchronized
    fun remove(items: List<Item>) {
        items.forEach { it.file.delete() }
    }

    @Synchronized
    fun totalBytes(): Long = pending().sumOf { it.sizeBytes }

    /** The batch's OTLP JSON, or null when the file cannot be read back. */
    fun read(item: Item): String? =
        try {
            String(gunzip(item.file.readBytes()), Charsets.UTF_8)
        } catch (_: IOException) {
            null
        }

    fun readGzipped(item: Item): ByteArray? =
        try {
            item.file.readBytes()
        } catch (_: IOException) {
            null
        }

    /** Drops what is past the limits, oldest first. Returns how many batches it dropped. */
    @Synchronized
    fun prune(): Int {
        val now: Long = clock.nowMillis()
        var items: List<Item> = pending()
        var dropped = 0
        // A batch stamped in the future (the clock went back) is kept: its age is unknown.
        items.filter { now - it.createdMillis > maxAgeMillis }.forEach {
            it.file.delete()
            dropped += 1
        }
        items = pending()
        var total: Long = items.sumOf { it.sizeBytes }
        for (item in items) {
            if (total <= maxBytes) {
                break
            }
            item.file.delete()
            total -= item.sizeBytes
            dropped += 1
        }
        droppedBatches += dropped
        return dropped
    }

    /** How many batches were dropped since the last call, and starts counting again. */
    @Synchronized
    fun takeDroppedBatches(): Long {
        val count: Long = droppedBatches
        droppedBatches = 0
        return count
    }

    @Synchronized
    fun countDropped(count: Int) {
        droppedBatches += count
    }

    private fun parse(file: File): Item? {
        val match: MatchResult = NAME.matchEntire(file.name) ?: return null
        val signal: Signal = Signal.entries.firstOrNull { it.fileTag == match.groupValues[3] } ?: return null
        return Item(file, signal, match.groupValues[1].toLong(), file.length())
    }

    companion object {
        const val DEFAULT_MAX_BYTES: Long = 20L * 1024 * 1024
        const val DEFAULT_MAX_AGE_MILLIS: Long = 7L * 24 * 60 * 60_000
        private const val SUFFIX: String = ".json.gz"
        private const val TEMP_SUFFIX: String = ".tmp"
        private val NAME: Regex = Regex("""^(\d{13})-(\d{6})\.([a-z]+)\.json\.gz$""")

        fun gzip(bytes: ByteArray): ByteArray {
            val output = ByteArrayOutputStream()
            GZIPOutputStream(output).use { it.write(bytes) }
            return output.toByteArray()
        }

        fun gunzip(bytes: ByteArray): ByteArray = GZIPInputStream(bytes.inputStream()).use { it.readBytes() }
    }
}
