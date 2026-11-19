package com.oneuptime.androidagent.transport

import com.oneuptime.androidagent.testing.FakeClock
import java.io.File
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class OutboxTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val clock = FakeClock(now = 1_795_000_000_000L)

    private fun outbox(maxBytes: Long = Outbox.DEFAULT_MAX_BYTES, maxAgeMillis: Long = Outbox.DEFAULT_MAX_AGE_MILLIS): Outbox =
        Outbox(File(folder.root, "outbox"), clock, maxBytes, maxAgeMillis)

    @Test
    fun `batches are kept gzipped on disk and read back oldest first`() {
        val box: Outbox = outbox()
        box.add(Signal.METRICS, "{\"resourceMetrics\":[1]}")
        clock.advance(1_000)
        box.add(Signal.LOGS, "{\"resourceLogs\":[2]}")
        clock.advance(1_000)
        box.add(Signal.METRICS, "{\"resourceMetrics\":[3]}")

        val all: List<Outbox.Item> = box.pending()
        assertEquals(listOf(Signal.METRICS, Signal.LOGS, Signal.METRICS), all.map { it.signal })
        assertEquals(listOf("{\"resourceMetrics\":[1]}", "{\"resourceMetrics\":[3]}"), box.pending(Signal.METRICS).map { box.read(it) })
        assertEquals(0x1f.toByte(), box.readGzipped(all.first())!![0])
        assertEquals(all.sumOf { it.sizeBytes }, box.totalBytes())
    }

    @Test
    fun `batches written in the same millisecond keep their order`() {
        val box: Outbox = outbox()
        (1..5).forEach { box.add(Signal.LOGS, "{\"resourceLogs\":[$it]}") }

        assertEquals((1..5).map { "{\"resourceLogs\":[$it]}" }, box.pending().map { box.read(it) })
    }

    @Test
    fun `sent batches are removed`() {
        val box: Outbox = outbox()
        box.add(Signal.LOGS, "{}")
        box.add(Signal.LOGS, "{}")

        box.remove(box.pending().take(1))

        assertEquals(1, box.pending().size)
    }

    @Test
    fun `past the size limit the oldest batches are dropped and counted`() {
        val big: String = "{\"resourceLogs\":[\"" + (1..4_000).joinToString("") { (it * 7919 % 10007).toString(36) } + "\"]}"
        val size: Long = Outbox.gzip(big.toByteArray()).size.toLong()
        val box: Outbox = outbox(maxBytes = size * 2 + size / 2)

        box.add(Signal.LOGS, big)
        clock.advance(1)
        box.add(Signal.LOGS, big)
        clock.advance(1)
        box.add(Signal.METRICS, big)

        val kept: List<Outbox.Item> = box.pending()
        assertEquals(2, kept.size)
        assertEquals(listOf(Signal.LOGS, Signal.METRICS), kept.map { it.signal })
        assertEquals(1L, box.takeDroppedBatches())
        assertEquals(0L, box.takeDroppedBatches())
    }

    @Test
    fun `batches older than the age limit are dropped, and one stamped in the future is kept`() {
        val start: Long = clock.now
        val box: Outbox = outbox(maxAgeMillis = 60_000L)
        // Written while the clock was two minutes fast...
        clock.now = start + 120_000L
        box.add(Signal.METRICS, "{}")
        // ...and after it was set right.
        clock.now = start
        box.add(Signal.METRICS, "{}")

        // A minute later the second batch is 61 seconds old, and the first still 59 seconds in the future.
        clock.now = start + 61_000L

        assertEquals(1, box.prune())
        assertEquals(listOf(start + 120_000L), box.pending().map { it.createdMillis })
    }

    @Test
    fun `a write cut short by a power loss leaves a temporary file, cleared the next time the outbox opens`() {
        val directory = File(folder.root, "outbox")
        directory.mkdirs()
        File(directory, "1795000000000-000001.logs.json.gz.tmp").writeText("half")
        File(directory, "unrelated.txt").writeText("x")

        val box: Outbox = outbox()

        assertFalse(File(directory, "1795000000000-000001.logs.json.gz.tmp").exists())
        assertTrue(box.pending().isEmpty())
    }

    @Test
    fun `file names are ASCII whatever the device's language`() {
        val previous: Locale = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ar-EG"))
            val item: Outbox.Item = outbox().add(Signal.LOGS, "{}")!!

            assertTrue(item.file.name, item.file.name.matches(Regex("^\\d{13}-\\d{6}\\.logs\\.json\\.gz$")))
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test
    fun `a file that is not a batch is ignored, and an unreadable one reads as nothing`() {
        val box: Outbox = outbox()
        val item: Outbox.Item = box.add(Signal.LOGS, "{}")!!
        item.file.writeBytes(byteArrayOf(1, 2, 3))

        assertEquals(null, box.read(item))
        assertNotNull(box.readGzipped(item))
    }

    @Test
    fun `gzip round trips`() {
        val text = "{\"résumé\": \"日本語\"}"

        assertEquals(text, String(Outbox.gunzip(Outbox.gzip(text.toByteArray())), Charsets.UTF_8))
    }
}
