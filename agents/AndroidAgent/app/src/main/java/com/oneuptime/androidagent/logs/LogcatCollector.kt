package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.logsession.LogSessionUnavailable
import com.oneuptime.androidagent.logsession.SessionLogcat
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
    // The agent's own uid and pid: a line from anyone else in a log session says Android allowed it.
    private val myUid: Int = -1,
    private val myPid: Int = -1,
    // Whether READ_LOGS is granted now, for a log session asked for between two cycles.
    private val isGranted: () -> Boolean = { true },
    // DropBox has every app's crashes, or ANRs, with their stacks: the events buffer's copies are not sent.
    private val crashesCoveredElsewhere: () -> Boolean = { false },
    private val anrsCoveredElsewhere: () -> Boolean = { false },
) : SessionLogcat {
    // A text line costs one token: bursts of 2,000, then 10 lines a second (600 a minute).
    private val textLimiter = RateLimiter(capacity = 2_000.0, perSecond = 10.0, elapsedMillis = clock::elapsedRealtimeMillis)

    // Crashes and ANRs: bursts of 60, then one a second, so an app crashing in a loop is still bounded.
    private val eventLimiter = RateLimiter(capacity = 60.0, perSecond = 1.0, elapsedMillis = clock::elapsedRealtimeMillis)

    private var eventsSession: LogcatSession? = null
    private var textSession: LogcatSession? = null
    private var textLevel: LogcatLevel? = null
    private var droppedLines: Long = 0

    // A log session's own logcat, and the session it reads for (LogSessionManager).
    private var logSession: LogcatSession? = null

    @Volatile
    private var logSessionId: String? = null

    @Volatile
    private var lastOtherAppLine: Long? = null

    @Volatile
    private var enabledNow: Boolean = true

    @Volatile
    var state: LogcatState = LogcatState.DISABLED
        private set

    /** Starts or stops sessions to match the settings and whether READ_LOGS is granted. */
    @Synchronized
    fun update(enabled: Boolean, granted: Boolean, minLevel: LogcatLevel): LogcatState {
        enabledNow = enabled
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
        stop()
    }

    override fun unavailable(): LogSessionUnavailable? =
        when {
            !enabledNow -> LogSessionUnavailable.LOGCAT_DISABLED
            !isGranted() -> LogSessionUnavailable.NOT_GRANTED
            else -> null
        }

    /**
     * Starts a log session's own `logcat`: every app's main, system and crash
     * lines at [level], from now on. On Android 13 and later it must start
     * while the agent's screen is in front: that is when Android asks the
     * person at the device to allow it, and it keeps the answer for this one
     * process. While it runs, the regular text session (Android 12 and
     * earlier) sends nothing, so no line is sent twice.
     */
    @Synchronized
    override fun start(sessionId: String, level: LogcatLevel) {
        logSession?.stop()
        lastOtherAppLine = null
        logSessionId = sessionId
        // Any id the session keeps to itself will do where the kernel's is not readable: it only has to resume from now.
        val bootId: String = currentBootId() ?: "log-session"
        logSession =
            LogcatSession(
                name = SESSION,
                commands = LogcatCommands.text(level),
                launcher = launcher,
                clock = clock,
                currentBootId = { bootId },
                // From this moment: a session sends what happens while it runs, not what came before.
                initialResume = ResumePoint(bootId, millisToNanos(clock.nowMillis())),
                onEntry = { line, logBuffer -> onSessionText(line, logBuffer) },
            ).also { it.start() }
    }

    @Synchronized
    override fun stop() {
        logSession?.stop()
        logSession = null
        logSessionId = null
    }

    override val isRunning: Boolean
        get() = logSession?.isRunning == true

    override val lastOtherAppLineElapsedMillis: Long?
        get() = lastOtherAppLine

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
        // DropBox has the same crash with its whole stack: sending this copy too would file it twice.
        when (line.tag) {
            EventLogDecoder.TAG_CRASH -> if (crashesCoveredElsewhere()) return
            EventLogDecoder.TAG_ANR -> if (anrsCoveredElsewhere()) return
        }
        val record: LogRecord = EventLogDecoder.decode(line, millisToNanos(clock.nowMillis())) ?: return
        if (eventLimiter.tryAcquire()) {
            buffer.add(record)
        }
    }

    private fun onText(line: LogcatLine, logBuffer: String?) {
        // A log session reads the same lines, and more: it sends them, tagged with the session.
        if (logSessionId != null) {
            return
        }
        if (!textLimiter.tryAcquire()) {
            synchronized(this) { droppedLines += 1 }
            return
        }
        buffer.add(textRecord(line, logBuffer, millisToNanos(clock.nowMillis()), packages = packages))
    }

    private fun onSessionText(line: LogcatLine, logBuffer: String?) {
        val sessionId: String = logSessionId ?: return
        if (isFromAnotherApp(line)) {
            lastOtherAppLine = clock.elapsedRealtimeMillis()
        }
        if (!textLimiter.tryAcquire()) {
            synchronized(this) { droppedLines += 1 }
            return
        }
        buffer.add(textRecord(line, logBuffer, millisToNanos(clock.nowMillis()), logSessionId = sessionId, packages = packages))
    }

    /*
     * Until Android allows a session, logd gives it the agent's own lines
     * only: a line from another uid (or, in the format without uids, another
     * process) is the sign it was allowed.
     */
    private fun isFromAnotherApp(line: LogcatLine): Boolean {
        val uid: Int? = LogcatUid.numeric(line.uid)
        return if (uid != null) uid != myUid else line.pid != myPid
    }

    companion object {
        const val EVENTS: String = "events"
        const val TEXT: String = "text"
        const val SESSION: String = "session"
        const val ANDROID_13: Int = 33
        const val MAX_MESSAGE_LENGTH: Int = 8_192
        const val LOG_SESSION_ATTRIBUTE: String = "oneuptime.agent.log_session.id"

        fun textRecord(
            line: LogcatLine,
            logBuffer: String?,
            observedUnixNano: Long,
            logSessionId: String? = null,
            packages: PackageNameResolver,
        ): LogRecord {
            val message: String = Redactor.redact(line.message)
            return LogRecord(
                timeUnixNano = line.timeUnixNano,
                observedTimeUnixNano = observedUnixNano,
                severity = line.severity,
                body = if (message.length > MAX_MESSAGE_LENGTH) message.take(MAX_MESSAGE_LENGTH) + "…" else message,
                attributes =
                    attributes {
                        text("android.log.tag", line.tag)
                        int("process.pid", line.pid.toLong())
                        int("thread.id", line.tid.toLong())
                        text("android.log.buffer", logBuffer)
                        text("android.package.name", LogcatUid.appUid(line.uid)?.let { packages.packageForUid(it) })
                        text(LOG_SESSION_ATTRIBUTE, logSessionId)
                    },
            )
        }
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
