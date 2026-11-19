package com.oneuptime.androidagent.dropbox

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.config.KeyValueStore
import com.oneuptime.androidagent.logs.RateLimiter
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.otlp.attributes
import com.oneuptime.androidagent.otlp.millisToNanos

/** What the agent can read of DropBox, and so whether it sends every app's crash stacks. */
enum class DropBoxState {
    // Switched off by the device manager (logcat_enabled = false, which covers every app's crashes and logs).
    DISABLED,

    // READ_LOGS (READ_DROPBOX_DATA on Android 15 and later) has not been granted.
    NOT_GRANTED,

    // Granted, but not usage access, which Android also asks of an app reading DropBox.
    NO_USAGE_ACCESS,

    // Reading every app's crashes, native crashes, ANRs and the reboots' reasons.
    READING,
}

/** Where DropBox's entries come from: Android's DropBoxManager, or a list in a test. */
interface DropBoxSource {
    /**
     * The first entry Android added after [afterMillis], of any tag, with
     * the text [span] says to read of it, or null when there is none. An
     * entry [span] returns null for comes back with empty text, unread.
     * Throws SecurityException when the agent may not read DropBox.
     */
    fun next(afterMillis: Long, span: (tag: String) -> DropBoxTextSpan?): DropBoxEntry?

    /** Whether Android keeps entries with this tag at all: a device's settings can turn a tag off. */
    fun isTagEnabled(tag: String): Boolean
}

/** What Android lets the agent do, read without touching DropBox. */
interface DropBoxAccess {
    // READ_LOGS, or READ_DROPBOX_DATA on Android 15 and later.
    fun permissionGranted(): Boolean

    // The GET_USAGE_STATS app op, or the PACKAGE_USAGE_STATS permission it falls back to.
    fun usageAccessGranted(): Boolean
}

/** One cycle's reading. */
data class DropBoxRead(
    val state: DropBoxState,
    val records: List<LogRecord>,
    val boots: List<DropBoxFinding.Boot>,
)

/**
 * Reads the entries Android's DropBoxManager has added since the last read:
 * every app's crash with its whole stack, native crashes, ANRs with their
 * traces, the system server's hangs and restarts, and what the kernel's log
 * says of the last reboot (DropBoxDecoder).
 *
 * DropBox is a system service, not Logcat: Android 13's consent dialog for
 * Logcat does not apply to it, so the agent reads it in the background on
 * every version - with READ_LOGS (READ_DROPBOX_DATA from Android 15) and
 * usage access, which only adb or the person at the device can grant.
 *
 * Where it got to is kept in the agent's state, so every entry is sent once,
 * across restarts and reboots. The first read goes back an hour, not over
 * everything a device has kept for days. Each read stops after
 * [MAX_ENTRIES_PER_READ] entries and goes on at the next, and crashes are
 * rate-limited as Logcat's are, so an app crashing in a loop is bounded.
 */
class DropBoxCollector(
    private val source: DropBoxSource,
    private val access: DropBoxAccess,
    private val store: KeyValueStore,
    private val clock: Clock,
) {
    private val faultLimiter = RateLimiter(capacity = 60.0, perSecond = 1.0, elapsedMillis = clock::elapsedRealtimeMillis)

    // Native crashes Android reports twice (as the app's report and as a tombstone): their pids and times.
    private val recentNativeCrashes: ArrayDeque<Pair<Long, Long>> = ArrayDeque()
    private var droppedFaults: Long = 0

    @Volatile
    var state: DropBoxState = DropBoxState.DISABLED
        private set

    /**
     * Whether DropBox holds every app's crashes and ANRs with their stacks,
     * so the Logcat decoder's copies of them - the same crashes, without a
     * stack - are not sent too.
     */
    @Volatile
    var coversCrashes: Boolean = false
        private set

    @Volatile
    var coversAnrs: Boolean = false
        private set

    // Android refused the last read although the checks passed: READ_LOGS granted where Android 15 asks for READ_DROPBOX_DATA.
    @Volatile
    private var lastReadRefused: Boolean = false

    /** What the agent can read, for its screen, without reading anything: the checks, and how the last read went. */
    fun peekState(enabled: Boolean): DropBoxState {
        val checked: DropBoxState =
            when {
                !enabled -> DropBoxState.DISABLED
                !access.permissionGranted() -> DropBoxState.NOT_GRANTED
                !access.usageAccessGranted() -> DropBoxState.NO_USAGE_ACCESS
                else -> DropBoxState.READING
            }
        return if (checked == DropBoxState.READING && lastReadRefused) DropBoxState.NOT_GRANTED else checked
    }

    @Synchronized
    fun read(enabled: Boolean): DropBoxRead {
        val wanted: DropBoxState =
            when {
                !enabled -> DropBoxState.DISABLED
                !access.permissionGranted() -> DropBoxState.NOT_GRANTED
                !access.usageAccessGranted() -> DropBoxState.NO_USAGE_ACCESS
                else -> DropBoxState.READING
            }
        if (wanted != DropBoxState.READING) {
            return finish(wanted, emptyList(), emptyList())
        }

        val now: Long = clock.nowMillis()
        var cursor: Long = store.getLong(KEY_CURSOR) ?: (now - FIRST_READ_LOOKBACK_MILLIS)
        // A clock set back (a device whose time was wrong) would leave the cursor in the future for good.
        if (cursor > now + CLOCK_SLACK_MILLIS) {
            cursor = now - FIRST_READ_LOOKBACK_MILLIS
        }

        val records: MutableList<LogRecord> = mutableListOf()
        val boots: MutableList<DropBoxFinding.Boot> = mutableListOf()
        try {
            var read = 0
            while (read < MAX_ENTRIES_PER_READ) {
                val entry: DropBoxEntry = source.next(cursor) { tag -> DropBoxTags.spanOf(tag) } ?: break
                read += 1
                // Entries come in time order, each with its own time: the next read starts after this one.
                cursor = maxOf(cursor, entry.timeMillis)
                if (entry.text.isEmpty()) {
                    continue
                }
                when (val finding: DropBoxFinding? = decodeSafely(entry)) {
                    is DropBoxFinding.Fault -> if (keep(finding, entry.timeMillis)) records.add(finding.record)
                    is DropBoxFinding.Event -> records.add(finding.record)
                    is DropBoxFinding.Boot -> boots.add(finding)
                    null -> Unit
                }
            }
        } catch (_: SecurityException) {
            store.edit { putLong(KEY_CURSOR, cursor) }
            lastReadRefused = true
            return finish(DropBoxState.NOT_GRANTED, records, boots)
        }
        store.edit { putLong(KEY_CURSOR, cursor) }
        lastReadRefused = false
        return finish(DropBoxState.READING, records, boots)
    }

    /**
     * A record saying how many crash reports were left out since the last
     * call because apps crashed more often than the agent sends, or null.
     */
    @Synchronized
    fun takeDroppedRecord(): LogRecord? {
        val count: Long = droppedFaults
        if (count == 0L) {
            return null
        }
        droppedFaults = 0
        val now: Long = millisToNanos(clock.nowMillis())
        return LogRecord(
            timeUnixNano = now,
            observedTimeUnixNano = now,
            severity = Severity.WARN,
            body = "Left out $count crash reports: apps crashed more often than the agent sends (60 at once, then one a second).",
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.dropbox.dropped")
                    int("oneuptime.agent.dropbox.dropped_reports", count)
                },
        )
    }

    private fun finish(newState: DropBoxState, records: List<LogRecord>, boots: List<DropBoxFinding.Boot>): DropBoxRead {
        state = newState
        val reading: Boolean = newState == DropBoxState.READING
        coversCrashes = reading && DropBoxTags.JAVA_CRASH.all { source.isTagEnabledSafely(it) }
        coversAnrs = reading && DropBoxTags.ANR.all { source.isTagEnabledSafely(it) }
        return DropBoxRead(newState, records, boots)
    }

    private fun decodeSafely(entry: DropBoxEntry): DropBoxFinding? =
        try {
            DropBoxDecoder.decode(entry, millisToNanos(clock.nowMillis()))
        } catch (_: RuntimeException) {
            // An entry the decoder cannot read is passed over: the next one is read as usual.
            null
        }

    private fun keep(fault: DropBoxFinding.Fault, timeMillis: Long): Boolean {
        val pid: Long? = fault.nativeCrashPid
        if (pid != null) {
            while (recentNativeCrashes.isNotEmpty() && timeMillis - recentNativeCrashes.first().second > NATIVE_DUPLICATE_WINDOW_MILLIS) {
                recentNativeCrashes.removeFirst()
            }
            if (recentNativeCrashes.any { (seenPid, seenAt) -> seenPid == pid && kotlin.math.abs(timeMillis - seenAt) <= NATIVE_DUPLICATE_WINDOW_MILLIS }) {
                return false
            }
            recentNativeCrashes.addLast(pid to timeMillis)
            if (recentNativeCrashes.size > MAX_RECENT_NATIVE_CRASHES) {
                recentNativeCrashes.removeFirst()
            }
        }
        if (!faultLimiter.tryAcquire()) {
            droppedFaults += 1
            return false
        }
        return true
    }

    private fun DropBoxSource.isTagEnabledSafely(tag: String): Boolean =
        try {
            isTagEnabled(tag)
        } catch (_: RuntimeException) {
            true
        }

    companion object {
        const val KEY_CURSOR: String = "dropbox.cursor"
        const val MAX_ENTRIES_PER_READ: Int = 200
        const val FIRST_READ_LOOKBACK_MILLIS: Long = 60 * 60_000
        private const val CLOCK_SLACK_MILLIS: Long = 24 * 60 * 60_000
        private const val NATIVE_DUPLICATE_WINDOW_MILLIS: Long = 60_000
        private const val MAX_RECENT_NATIVE_CRASHES: Int = 64
    }
}
