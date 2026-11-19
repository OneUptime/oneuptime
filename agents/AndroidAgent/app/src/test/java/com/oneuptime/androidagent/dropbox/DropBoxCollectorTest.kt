package com.oneuptime.androidagent.dropbox

import com.oneuptime.androidagent.config.MemoryKeyValueStore
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DropBoxCollectorTest {
    private val clock = FakeClock(now = 1_795_000_000_000L, elapsed = 600_000L)
    private val store = MemoryKeyValueStore()

    private class FakeSource(private val entries: MutableList<DropBoxEntry> = mutableListOf()) : DropBoxSource {
        var refuse: Boolean = false
        val disabledTags: MutableSet<String> = mutableSetOf()
        val textRead: MutableList<String> = mutableListOf()
        var calls: Int = 0

        fun add(tag: String, timeMillis: Long, text: String) {
            entries.add(DropBoxEntry(tag, timeMillis, text))
        }

        override fun next(afterMillis: Long, span: (tag: String) -> DropBoxTextSpan?): DropBoxEntry? {
            calls += 1
            if (refuse) throw SecurityException("READ_LOGS")
            val entry: DropBoxEntry = entries.filter { it.timeMillis > afterMillis }.minByOrNull { it.timeMillis } ?: return null
            return if (span(entry.tag) == null) {
                entry.copy(text = "")
            } else {
                textRead.add(entry.tag)
                entry
            }
        }

        override fun isTagEnabled(tag: String): Boolean = tag !in disabledTags
    }

    private class FakeAccess(var permission: Boolean = true, var usage: Boolean = true) : DropBoxAccess {
        override fun permissionGranted(): Boolean = permission

        override fun usageAccessGranted(): Boolean = usage
    }

    private val source = FakeSource()
    private val access = FakeAccess()
    private val collector = DropBoxCollector(source, access, store, clock)

    @Test
    fun `without the grants it reads nothing, and says which is missing`() {
        assertEquals(DropBoxState.DISABLED, collector.read(enabled = false).state)

        access.permission = false
        assertEquals(DropBoxState.NOT_GRANTED, collector.read(enabled = true).state)

        access.permission = true
        access.usage = false
        assertEquals(DropBoxState.NO_USAGE_ACCESS, collector.read(enabled = true).state)

        assertEquals(0, source.calls)
        assertFalse(collector.coversCrashes)
    }

    @Test
    fun `the first read goes back an hour, not over everything Android kept`() {
        source.add("data_app_crash", clock.now - 2 * 60 * 60_000, DropBoxFixtures.JAVA_CRASH)
        source.add("data_app_crash", clock.now - 10 * 60_000, DropBoxFixtures.JAVA_CRASH)

        val read: DropBoxRead = collector.read(enabled = true)

        assertEquals(DropBoxState.READING, read.state)
        assertEquals(1, read.records.size)
        assertEquals(clock.now - 10 * 60_000, store.getLong(DropBoxCollector.KEY_CURSOR))
    }

    @Test
    fun `each entry is read once, across reads and across a restart of the agent`() {
        source.add("data_app_crash", clock.now - 60_000, DropBoxFixtures.JAVA_CRASH)
        assertEquals(1, collector.read(enabled = true).records.size)
        assertEquals(0, collector.read(enabled = true).records.size)

        source.add("data_app_anr", clock.now - 30_000, DropBoxFixtures.ANR)
        val restarted = DropBoxCollector(source, access, store, clock)
        val read: DropBoxRead = restarted.read(enabled = true)
        assertEquals(1, read.records.size)
        assertEquals("device.anr", read.records.single().attributes.toMap()["event.name"])
    }

    @Test
    fun `entries of other tags are passed over unread, but passed`() {
        source.add("netstats", clock.now - 3_000, "big binary blob")
        source.add("SYSTEM_TOMBSTONE_PROTO_WITH_HEADERS", clock.now - 2_000, "proto")
        source.add("data_app_crash", clock.now - 1_000, DropBoxFixtures.JAVA_CRASH)

        val read: DropBoxRead = collector.read(enabled = true)

        assertEquals(listOf("data_app_crash"), source.textRead)
        assertEquals(1, read.records.size)
        assertEquals(clock.now - 1_000, store.getLong(DropBoxCollector.KEY_CURSOR))
    }

    @Test
    fun `boot entries come back as boots, the system restarting as an event`() {
        source.add("SYSTEM_BOOT", clock.now - 3_000, DropBoxFixtures.SYSTEM_BOOT)
        source.add("SYSTEM_LAST_KMSG", clock.now - 2_000, DropBoxFixtures.LAST_KERNEL_LOG)
        source.add("SYSTEM_RESTART", clock.now - 1_000, DropBoxFixtures.SYSTEM_RESTART)

        val read: DropBoxRead = collector.read(enabled = true)

        assertEquals(2, read.boots.size)
        assertEquals("kernel_panic", read.boots.last().kernelLog!!.bootReason)
        assertEquals("device.system_restart", read.records.single().attributes.toMap()["event.name"])
    }

    @Test
    fun `a native crash Android files twice is sent once`() {
        source.add("data_app_native_crash", clock.now - 3_000, DropBoxFixtures.NATIVE_CRASH)
        source.add("SYSTEM_TOMBSTONE", clock.now - 2_000, DropBoxFixtures.NATIVE_CRASH.substringAfter("\n\n"))
        // Another process's tombstone is its own crash.
        source.add("SYSTEM_TOMBSTONE", clock.now - 1_000, DropBoxFixtures.TOMBSTONE)

        val records: List<LogRecord> = collector.read(enabled = true).records

        assertEquals(2, records.size)
        assertEquals("data_app_native_crash", records[0].attributes.toMap()["android.dropbox.tag"])
        assertEquals("SYSTEM_TOMBSTONE", records[1].attributes.toMap()["android.dropbox.tag"])
    }

    @Test
    fun `an app crashing in a loop is bounded, and the agent says how many it left out`() {
        repeat(100) { index -> source.add("data_app_crash", clock.now - 100_000 + index, DropBoxFixtures.JAVA_CRASH) }

        val records: List<LogRecord> = collector.read(enabled = true).records

        assertEquals(60, records.size)
        val dropped: LogRecord = collector.takeDroppedRecord()!!
        assertEquals(40L, dropped.attributes.toMap()["oneuptime.agent.dropbox.dropped_reports"])
        assertNull(collector.takeDroppedRecord())
    }

    @Test
    fun `a read stops after its limit and goes on at the next`() {
        repeat(DropBoxCollector.MAX_ENTRIES_PER_READ + 5) { index -> source.add("netstats", clock.now - 10_000 + index, "x") }

        collector.read(enabled = true)
        assertEquals(DropBoxCollector.MAX_ENTRIES_PER_READ, source.calls)

        collector.read(enabled = true)
        // Five more entries, then the call that finds none.
        assertEquals(DropBoxCollector.MAX_ENTRIES_PER_READ + 6, source.calls)
    }

    @Test
    fun `Android refusing the read, as on Android 15 without READ_DROPBOX_DATA, is not granted`() {
        source.refuse = true

        assertEquals(DropBoxState.NOT_GRANTED, collector.read(enabled = true).state)
        // The checks pass, the read did not: the screen says not granted too.
        assertEquals(DropBoxState.NOT_GRANTED, collector.peekState(enabled = true))

        source.refuse = false
        assertEquals(DropBoxState.READING, collector.read(enabled = true).state)
        assertEquals(DropBoxState.READING, collector.peekState(enabled = true))
    }

    @Test
    fun `reading, it covers crashes and ANRs, unless a device turned their tags off`() {
        collector.read(enabled = true)
        assertTrue(collector.coversCrashes)
        assertTrue(collector.coversAnrs)

        source.disabledTags.add("data_app_anr")
        collector.read(enabled = true)
        assertTrue(collector.coversCrashes)
        assertFalse(collector.coversAnrs)

        collector.read(enabled = false)
        assertFalse(collector.coversCrashes)
    }

    @Test
    fun `a cursor in the future, from a clock that was wrong, starts again from an hour ago`() {
        store.edit { putLong(DropBoxCollector.KEY_CURSOR, clock.now + 10L * 24 * 60 * 60_000) }
        source.add("data_app_crash", clock.now - 1_000, DropBoxFixtures.JAVA_CRASH)

        assertEquals(1, collector.read(enabled = true).records.size)
    }

    @Test
    fun `an entry the decoder cannot read is passed over`() {
        source.add("data_app_crash", clock.now - 2_000, "Process: x\n\nnothing")
        source.add("data_app_crash", clock.now - 1_000, DropBoxFixtures.JAVA_CRASH)

        val read: DropBoxRead = collector.read(enabled = true)

        assertEquals(1, read.records.size)
        assertNotNull(store.getLong(DropBoxCollector.KEY_CURSOR))
    }
}
