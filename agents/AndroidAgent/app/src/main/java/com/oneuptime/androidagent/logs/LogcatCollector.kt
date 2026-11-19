package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.attributes
import com.oneuptime.androidagent.otlp.millisToNanos

/** What the agent can read of Logcat, and so what it sends. */
enum class LogcatState {
    // Switched off by the device manager (logcat_enabled = false).
    DISABLED,

    // READ_LOGS has not been granted: only the agent's own lines could be read, so nothing is sent.
    NOT_GRANTED,

    // Android 13 and later: crashes and ANRs from the events buffer only.
    CRASHES_AND_ANRS,

    // Android 12 and earlier: every app's lines at the chosen level, and crashes and ANRs.
    FULL,
}

/** Log records waiting for the next upload, up to [capacity]; any more are counted and dropped. */
class LogBuffer(private val capacity: Int = 10_000) {
    private val records: ArrayDeque<LogRecord> = ArrayDeque()
    private var dropped: Long = 0

    @Synchronized
    fun add(record: LogRecord): Boolean {
        if (records.size >= capacity) {
            dropped += 1
            return false
        }
        records.addLast(record)
        return true
    }

    @Synchronized
    fun drain(): List<LogRecord> {
        val all: List<LogRecord> = records.toList()
        records.clear()
        return all
    }

    @Synchronized
    fun size(): Int = records.size

    /** How many were dropped since the last call, and starts counting again. */
    @Synchronized
    fun takeDropped(): Long {
        val count: Long = dropped
        dropped = 0
        return count
    }
}

/** The app that owns a user id, or null when it is not one app's. */
fun interface PackageNameResolver {
    fun packageForUid(uid: Int): String?
}

/**
 * Runs the Logcat sessions the device allows and the settings ask for, and
 * turns what they read into log records in [buffer].
 *
 * Reading other apps' lines needs READ_LOGS, which only adb or a device
 * manager can grant. Android 13 then also asks the person at the device to
 * allow each Logcat session, and refuses outright when the app asking is not
 * on screen - so a background agent only gets the `events` buffer there,
 * which Android leaves out of that check. The agent reads that buffer for
 * crashes and ANRs on every version, and the main, system and crash buffers
 * as well up to Android 12.
 */
class LogcatCollector(
    private val clock: Clock,
    private val sdkInt: Int,
    private val launcher: ProcessLauncher,
    private val packages: PackageNameResolver,
    private val currentBootId: () -> String?,
    private val buffer: LogBuffer,
    private val resumePoints: ResumePointStore,
) {
    // A text line costs one token: bursts of 2,000, then 10 lines a second (600 a minute).
    private val textLimiter = RateLimiter(capacity = 2_000.0, perSecond = 10.0, elapsedMillis = clock::elapsedRealtimeMillis)

    // Crashes and ANRs: bursts of 60, then one a second, so an app crashing in a loop is still bounded.
    private val eventLimiter = RateLimiter(capacity = 60.0, perSecond = 1.0, elapsedMillis = clock::elapsedRealtimeMillis)

    private var eventsSession: LogcatSession? = null
    private var textSession: LogcatSession? = null
    private var textLevel: LogcatLevel? = null
    private var droppedLines: Long = 0

    @Volatile
    var state: LogcatState = LogcatState.DISABLED
        private set

    /** Starts or stops sessions to match the settings and whether READ_LOGS is granted. */
    @Synchronized
    fun update(enabled: Boolean, granted: Boolean, minLevel: LogcatLevel): LogcatState {
        val wanted: LogcatState =
            when {
                !enabled -> LogcatState.DISABLED
                !granted -> LogcatState.NOT_GRANTED
                sdkInt >= ANDROID_13 -> LogcatState.CRASHES_AND_ANRS
                else -> LogcatState.FULL
            }

        if (wanted == LogcatState.DISABLED || wanted == LogcatState.NOT_GRANTED) {
            stopAll()
        } else {
            if (eventsSession == null) {
                eventsSession = session(EVENTS, LogcatCommands.events()).also { it.start() }
            }
            if (wanted == LogcatState.FULL) {
                if (textSession != null && textLevel != minLevel) {
                    textSession?.stop()
                    textSession = null
                }
                if (textSession == null) {
                    textLevel = minLevel
                    textSession = session(TEXT, LogcatCommands.text(minLevel)).also { it.start() }
                }
            } else {
                textSession?.stop()
                textSession = null
            }
        }
        state = wanted
        return wanted
    }

    @Synchronized
    fun stopAll() {
        eventsSession?.stop()
        textSession?.stop()
        eventsSession = null
        textSession = null
    }

    /** Saves where each session got to, so a restart resumes there. */
    @Synchronized
    fun saveResumePoints() {
        eventsSession?.resumePoint?.let { resumePoints.save(EVENTS, it) }
        textSession?.resumePoint?.let { resumePoints.save(TEXT, it) }
    }

    /**
     * A record saying how many lines were left out since the last call because
     * apps logged more than the agent sends, or null when none were.
     */
    @Synchronized
    fun takeDroppedLinesRecord(): LogRecord? {
        val count: Long = droppedLines
        if (count == 0L) {
            return null
        }
        droppedLines = 0
        val now: Long = millisToNanos(clock.nowMillis())
        return LogRecord(
            timeUnixNano = now,
            observedTimeUnixNano = now,
            severity = com.oneuptime.androidagent.otlp.Severity.WARN,
            body = "Left out $count Logcat lines: apps logged more than the agent sends (600 lines a minute, in bursts of up to 2,000).",
            attributes =
                attributes {
                    text("event.name", "oneuptime.agent.logcat.dropped")
                    int("oneuptime.agent.logcat.dropped_lines", count)
                },
        )
    }

    private fun session(name: String, commands: List<(String?) -> List<String>>): LogcatSession =
        LogcatSession(
            name = name,
            commands = commands,
            launcher = launcher,
            clock = clock,
            currentBootId = currentBootId,
            initialResume = resumePoints.load(name),
            onEntry = { line, logBuffer -> if (name == EVENTS) onEvent(line) else onText(line, logBuffer) },
        )

    private fun onEvent(line: LogcatLine) {
        val record: LogRecord = EventLogDecoder.decode(line, millisToNanos(clock.nowMillis())) ?: return
        if (eventLimiter.tryAcquire()) {
            buffer.add(record)
        }
    }

    private fun onText(line: LogcatLine, logBuffer: String?) {
        if (!textLimiter.tryAcquire()) {
            synchronized(this) { droppedLines += 1 }
            return
        }
        buffer.add(textRecord(line, logBuffer, millisToNanos(clock.nowMillis()), packages))
    }

    companion object {
        const val EVENTS: String = "events"
        const val TEXT: String = "text"
        const val ANDROID_13: Int = 33
        const val MAX_MESSAGE_LENGTH: Int = 8_192

        fun textRecord(
            line: LogcatLine,
            logBuffer: String?,
            observedUnixNano: Long,
            packages: PackageNameResolver,
        ): LogRecord =
            LogRecord(
                timeUnixNano = line.timeUnixNano,
                observedTimeUnixNano = observedUnixNano,
                severity = line.severity,
                body = if (line.message.length > MAX_MESSAGE_LENGTH) line.message.take(MAX_MESSAGE_LENGTH) + "…" else line.message,
                attributes =
                    attributes {
                        text("android.log.tag", line.tag)
                        int("process.pid", line.pid.toLong())
                        int("thread.id", line.tid.toLong())
                        text("android.log.buffer", logBuffer)
                        text("android.package.name", LogcatUid.appUid(line.uid)?.let { packages.packageForUid(it) })
                    },
            )
    }
}

/** The Logcat command lines the sessions run, each with the simpler forms to fall back to. */
object LogcatCommands {
    private val FORMAT: List<String> = listOf("-v", "threadtime", "-v", "epoch", "-v", "uid", "-v", "printable")
    private val FORMAT_WITHOUT_UID: List<String> = listOf("-v", "threadtime", "-v", "epoch")
    private val FORMAT_PLAIN: List<String> = listOf("-v", "threadtime")

    /** The events buffer, crashes and ANRs only: `am_crash:I am_anr:I *:S`. */
    fun events(): List<(String?) -> List<String>> {
        val filter: List<String> = EventLogDecoder.TAGS.map { "$it:I" } + "*:S"
        val buffers: List<String> = listOf("-b", "events")
        return listOf(
            { since -> command(buffers, FORMAT, since) + filter },
            { since -> command(buffers, FORMAT_WITHOUT_UID, since) + filter },
            { _ -> command(buffers, FORMAT_PLAIN, null) + filter },
        )
    }

    /** The main, system and crash buffers, every tag at [minLevel] and above. */
    fun text(minLevel: LogcatLevel): List<(String?) -> List<String>> {
        val filter: List<String> = listOf("*:${minLevel.letter}")
        val buffers: List<String> = listOf("-b", "main", "-b", "system", "-b", "crash")
        return listOf(
            { since -> command(buffers, FORMAT, since) + filter },
            { since -> command(buffers, FORMAT_WITHOUT_UID, since) + filter },
            { _ -> command(buffers, FORMAT_PLAIN, null) + filter },
        )
    }

    private fun command(buffers: List<String>, format: List<String>, since: String?): List<String> =
        listOf("logcat") + buffers + format + (if (since != null) listOf("-T", since) else emptyList())
}

/** Where each Logcat session got to, kept across restarts. */
interface ResumePointStore {
    fun load(session: String): ResumePoint?

    fun save(session: String, point: ResumePoint)
}
