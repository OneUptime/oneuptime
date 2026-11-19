package com.oneuptime.androidagent.logs

import com.oneuptime.androidagent.Clock
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.util.TimeZone

/** Starts a process: `logcat` on a device, a fake one in a test. */
fun interface ProcessLauncher {
    fun start(command: List<String>): Process

    companion object {
        val SYSTEM: ProcessLauncher =
            ProcessLauncher { command -> ProcessBuilder(command).redirectErrorStream(true).start() }
    }
}

/** Where a session resumes from: the last entry it passed on, and the boot that entry was in. */
data class ResumePoint(val bootId: String?, val timeUnixNano: Long)

/**
 * One `logcat` process, kept running: read line by line, each entry handed
 * to [onEntry], and started again when it ends.
 *
 * [commands] are the forms to try, most capable first, each given the time
 * to resume from (`-T`), or null to read the whole buffer. A form that ends
 * at once having printed nothing it could read (an older Logcat that does
 * not know `-v uid`) gives way to the next.
 *
 * Resuming: after a restart within the same boot, the session asks Logcat
 * for the entries since the last one it passed on, and skips any it is
 * given again. After a reboot Logcat's buffers hold only the new boot, so it
 * reads them whole: the boot's first minutes are often what explains why the
 * device restarted, and a device whose clock was wrong when it booted would
 * have them stamped earlier than the last entry of the boot before.
 */
class LogcatSession(
    private val name: String,
    private val commands: List<(String?) -> List<String>>,
    private val launcher: ProcessLauncher,
    private val clock: Clock,
    private val currentBootId: () -> String?,
    initialResume: ResumePoint?,
    private val onEntry: (line: LogcatLine, buffer: String?) -> Unit,
    private val sleeper: (Long) -> Unit = { Thread.sleep(it) },
) {
    @Volatile
    private var stopped: Boolean = false

    @Volatile
    private var process: Process? = null

    private var thread: Thread? = null

    @Volatile
    var resumePoint: ResumePoint? = initialResume
        private set

    @Volatile
    var linesRead: Long = 0
        private set

    /** Which of [commands] is in use: 0 for the first. */
    @Volatile
    var commandIndex: Int = 0
        private set

    val isRunning: Boolean get() = thread?.isAlive == true

    @Synchronized
    fun start() {
        if (thread?.isAlive == true) {
            return
        }
        stopped = false
        thread =
            Thread({ runLoop() }, "oneuptime-logcat-$name").apply {
                isDaemon = true
                start()
            }
    }

    @Synchronized
    fun stop() {
        stopped = true
        process?.destroy()
        thread?.interrupt()
        thread = null
    }

    /** Runs the session on the calling thread until [stop] is called. */
    fun runLoop() {
        var failures = 0
        while (!stopped) {
            val startedAt: Long = clock.elapsedRealtimeMillis()
            val parsedLines: Int = runOnce()
            if (stopped) {
                break
            }
            val ranFor: Long = clock.elapsedRealtimeMillis() - startedAt
            if (parsedLines == 0 && ranFor < QUICK_EXIT_MILLIS && commandIndex < commands.size - 1) {
                commandIndex += 1
                continue
            }
            failures = if (ranFor > STABLE_MILLIS) 0 else failures + 1
            try {
                sleeper(backoffMillis(failures))
            } catch (_: InterruptedException) {
                break
            }
        }
    }

    private fun runOnce(): Int {
        val bootId: String? = currentBootId()
        val resume: ResumePoint? = resumePoint?.takeIf { it.bootId != null && it.bootId == bootId }
        val since: String? = resume?.let { formatSince(it.timeUnixNano + 1_000_000L) }
        val started: Process =
            try {
                launcher.start(commands[commandIndex](since))
            } catch (_: IOException) {
                return 0
            }
        process = started
        var parsed = 0
        // Entries at or before the resume point are ones passed on before; skip them until a newer one arrives.
        var replaying: Boolean = resume != null
        var buffer: String? = null
        try {
            BufferedReader(InputStreamReader(started.inputStream, Charsets.UTF_8)).use { reader ->
                while (!stopped) {
                    val raw: String = reader.readLine() ?: break
                    when (val parsedLine: LogcatParse = LogcatLineParser.parse(raw, clock.nowMillis(), TimeZone.getDefault())) {
                        is LogcatParse.Divider -> buffer = parsedLine.buffer
                        is LogcatParse.Entry -> {
                            parsed += 1
                            linesRead += 1
                            val line: LogcatLine = parsedLine.line
                            if (replaying && resume != null && line.timeUnixNano <= resume.timeUnixNano) {
                                continue
                            }
                            replaying = false
                            resumePoint = ResumePoint(bootId, line.timeUnixNano)
                            onEntry(line, buffer)
                        }
                        LogcatParse.Unrecognized -> Unit
                    }
                }
            }
        } catch (_: IOException) {
            // The process was stopped or died: started again below unless stopping.
        } finally {
            started.destroy()
            process = null
        }
        return parsed
    }

    companion object {
        private const val QUICK_EXIT_MILLIS: Long = 5_000
        private const val STABLE_MILLIS: Long = 60_000
        private const val MAX_BACKOFF_MILLIS: Long = 5 * 60_000

        fun backoffMillis(failures: Int): Long =
            (1_000L shl failures.coerceIn(0, 9)).coerceAtMost(MAX_BACKOFF_MILLIS)

        /** `-T`'s epoch form: seconds since the epoch, to the millisecond. */
        fun formatSince(timeUnixNano: Long): String {
            val millis: Long = timeUnixNano / 1_000_000L
            return "${millis / 1000}.${(millis % 1000).toString().padStart(3, '0')}"
        }
    }
}
