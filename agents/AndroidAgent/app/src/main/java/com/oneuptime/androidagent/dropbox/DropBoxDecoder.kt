package com.oneuptime.androidagent.dropbox

import com.oneuptime.androidagent.logs.Redactor
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.otlp.attributes
import com.oneuptime.androidagent.otlp.millisToNanos

/** One DropBox entry: its tag, when Android added it, and its text, as much of it as the agent read. */
data class DropBoxEntry(val tag: String, val timeMillis: Long, val text: String)

/** What the agent reads of an entry: how many bytes, and from its start or its end. */
data class DropBoxTextSpan(val maxBytes: Int, val fromEnd: Boolean)

/** The tags the agent reads, and how much of each. Every other entry is passed over unread. */
object DropBoxTags {
    // An app's uncaught Java exception: a user app's, a system app's, the system server's.
    val JAVA_CRASH: Set<String> = setOf("data_app_crash", "system_app_crash", "system_server_crash")

    // An app stopped responding: the traces of its threads.
    val ANR: Set<String> = setOf("data_app_anr", "system_app_anr", "system_server_anr")

    // An app's native crash, as ActivityManager files it, with the app's own headers.
    val NATIVE_CRASH: Set<String> = setOf("data_app_native_crash", "system_app_native_crash", "system_server_native_crash")

    // Any process's native crash, apps' and the system's own daemons', as debuggerd wrote it.
    const val TOMBSTONE: String = "SYSTEM_TOMBSTONE"

    // The system server hung, and its watchdog killed it: the device's apps all restart.
    const val WATCHDOG: String = "system_server_watchdog"

    // The system server started again without the device rebooting.
    const val SYSTEM_RESTART: String = "SYSTEM_RESTART"

    // The device booted (written once per boot, a few seconds after it).
    const val SYSTEM_BOOT: String = "SYSTEM_BOOT"

    // The kernel's log from before the reboot, with the reboot's reason.
    const val LAST_KERNEL_LOG: String = "SYSTEM_LAST_KMSG"

    val ALL: Set<String> = JAVA_CRASH + ANR + NATIVE_CRASH + setOf(TOMBSTONE, WATCHDOG, SYSTEM_RESTART, SYSTEM_BOOT, LAST_KERNEL_LOG)

    /*
     * An entry can be hundreds of kilobytes - an ANR holds every thread's
     * stack, a watchdog every thread of the system server - and only its
     * start says what failed. The kernel's log is the other way round: its
     * last lines say why the device stopped.
     */
    fun spanOf(tag: String): DropBoxTextSpan? =
        when (tag) {
            in JAVA_CRASH, in NATIVE_CRASH, TOMBSTONE -> DropBoxTextSpan(64 * 1024, fromEnd = false)
            in ANR -> DropBoxTextSpan(256 * 1024, fromEnd = false)
            WATCHDOG -> DropBoxTextSpan(512 * 1024, fromEnd = false)
            LAST_KERNEL_LOG -> DropBoxTextSpan(64 * 1024, fromEnd = true)
            SYSTEM_RESTART, SYSTEM_BOOT -> DropBoxTextSpan(4 * 1024, fromEnd = false)
            else -> null
        }
}

/** What one entry came to. */
sealed interface DropBoxFinding {
    /** A crash, a native crash, an ANR or a watchdog kill: an exception in OneUptime. */
    data class Fault(val record: LogRecord, val nativeCrashPid: Long? = null) : DropBoxFinding

    /** Something that happened to the device: the system server restarting. */
    data class Event(val record: LogRecord) : DropBoxFinding

    /** The device booted; with what the kernel's log says of the reboot before, when Android kept it. */
    data class Boot(val timeMillis: Long, val kernelLog: LastKernelLog?) : DropBoxFinding
}

/**
 * Turns the DropBox entries the agent reads into what OneUptime files under
 * the device's host: every app's crash with its whole stack, its ANRs with
 * the main thread's stack, native crashes with their backtrace, and the
 * system server's hangs - as exceptions, the same events and attributes the
 * Logcat decoder (EventLogDecoder) and OpenTelemetry Android send, so they
 * group by their stack in Exceptions. Every text an app wrote goes through
 * the [Redactor] first, and is cut to a size OneUptime keeps.
 */
object DropBoxDecoder {
    const val MAX_STACK_TRACE_LENGTH: Int = 32 * 1024
    const val MAX_BODY_LENGTH: Int = 8 * 1024
    const val MAX_MESSAGE_LENGTH: Int = 1_000
    const val MAX_KERNEL_LINES: Int = 30

    fun decode(entry: DropBoxEntry, observedUnixNano: Long): DropBoxFinding? =
        when (entry.tag) {
            in DropBoxTags.JAVA_CRASH -> javaCrash(entry, observedUnixNano)
            in DropBoxTags.ANR -> anr(entry, observedUnixNano)
            in DropBoxTags.NATIVE_CRASH, DropBoxTags.TOMBSTONE -> nativeCrash(entry, observedUnixNano)
            DropBoxTags.WATCHDOG -> watchdog(entry, observedUnixNano)
            DropBoxTags.SYSTEM_RESTART -> systemRestart(entry, observedUnixNano)
            DropBoxTags.SYSTEM_BOOT -> DropBoxFinding.Boot(entry.timeMillis, null)
            DropBoxTags.LAST_KERNEL_LOG -> DropBoxFinding.Boot(entry.timeMillis, LastKernelLogParser.parse(entry.text, MAX_KERNEL_LINES))
            else -> null
        }

    private fun javaCrash(entry: DropBoxEntry, observedUnixNano: Long): DropBoxFinding? {
        val headers: DropBoxHeaders = DropBoxHeaderParser.parse(entry.text)
        val process: DropBoxProcess = DropBoxProcessParser.parse(headers) ?: systemServer(entry.tag) ?: return null
        val throwable: JavaThrowable = JavaStackParser.parse(headers.body, MAX_STACK_TRACE_LENGTH) ?: return null
        val message: String = clip(Redactor.redact(throwable.message), MAX_MESSAGE_LENGTH)
        return DropBoxFinding.Fault(
            LogRecord(
                timeUnixNano = millisToNanos(entry.timeMillis),
                observedTimeUnixNano = observedUnixNano,
                severity = Severity.FATAL,
                body =
                    clip(
                        buildString {
                            append(process.processName).append(" crashed: ").append(throwable.type)
                            if (message.isNotEmpty()) append(": ").append(message)
                        },
                        MAX_BODY_LENGTH,
                    ),
                attributes =
                    attributes {
                        text("event.name", "app.crash")
                        text("exception.type", throwable.type)
                        text("exception.message", if (message.isEmpty()) "${process.processName} crashed" else "${process.processName}: $message")
                        text("exception.stacktrace", Redactor.redact(throwable.stackTrace))
                        bool("exception.escaped", true)
                        all(processAttributes(process, entry.tag))
                    },
            ),
        )
    }

    private fun anr(entry: DropBoxEntry, observedUnixNano: Long): DropBoxFinding? {
        val headers: DropBoxHeaders = DropBoxHeaderParser.parse(entry.text)
        val process: DropBoxProcess = DropBoxProcessParser.parse(headers) ?: systemServer(entry.tag) ?: return null
        val subject: String = clip(Redactor.redact(headers["Subject"].orEmpty()), MAX_MESSAGE_LENGTH)
        // "Input dispatching timed out (8b3b1a2 ... Waited 5001ms ...)": the kind, without what changes each time.
        val kind: String = subject.substringBefore('(').trim().ifEmpty { "Application Not Responding" }
        val mainThread: String? = ThreadTraceParser.thread(headers.body, "main", MAX_STACK_TRACE_LENGTH)
        return DropBoxFinding.Fault(
            LogRecord(
                timeUnixNano = millisToNanos(entry.timeMillis),
                observedTimeUnixNano = observedUnixNano,
                severity = Severity.ERROR,
                body =
                    clip(
                        if (subject.isEmpty()) "${process.processName} is not responding" else "${process.processName} is not responding: $subject",
                        MAX_BODY_LENGTH,
                    ),
                attributes =
                    attributes {
                        text("event.name", "device.anr")
                        text("exception.type", "ANR")
                        text("exception.message", "${process.processName}: $kind")
                        text("exception.stacktrace", mainThread?.let { Redactor.redact(it) })
                        bool("exception.escaped", true)
                        text("android.anr.reason", subject)
                        all(processAttributes(process, entry.tag))
                    },
            ),
        )
    }

    private fun nativeCrash(entry: DropBoxEntry, observedUnixNano: Long): DropBoxFinding? {
        val headers: DropBoxHeaders = DropBoxHeaderParser.parse(entry.text)
        val crash: NativeCrash = TombstoneParser.parse(entry.text) ?: return null
        // A tombstone names its process itself; an app's native crash report says it in its headers too.
        val process: DropBoxProcess? = if (entry.tag == DropBoxTags.TOMBSTONE) null else DropBoxProcessParser.parse(headers)
        val processName: String = process?.processName ?: crash.processName ?: return null
        val pid: Long? = crash.pid ?: process?.pid
        val signal: String = crash.signalName ?: "Native crash"
        val abort: String? = crash.abortMessage?.let { clip(Redactor.redact(it), ABORT_IN_MESSAGE_LENGTH) }
        /*
         * The message names where it crashed, not the address it touched: a
         * fault address differs on every crash, while the frame - the first
         * one in the app's own code - is the bug, and is what groups the
         * crashes in Exceptions (their frames are not Java's, so OneUptime
         * groups them by this message).
         */
        val message: String =
            buildString {
                append(processName).append(": ").append(signal)
                crash.code?.takeIf { it.startsWith("SEGV_") || it.startsWith("BUS_") || it.startsWith("ILL_") || it.startsWith("FPE_") }?.let {
                    append(" (").append(it).append(')')
                }
                crash.topFrame?.let { append(" in ").append(it.label) }
                if (!abort.isNullOrEmpty()) append(": ").append(abort)
            }
        return DropBoxFinding.Fault(
            LogRecord(
                timeUnixNano = millisToNanos(entry.timeMillis),
                observedTimeUnixNano = observedUnixNano,
                severity = Severity.FATAL,
                body = clip("$processName crashed in native code: $signal" + (crash.topFrame?.let { " in ${it.label}" } ?: ""), MAX_BODY_LENGTH),
                attributes =
                    attributes {
                        text("event.name", "app.crash")
                        text("exception.type", signal)
                        text("exception.message", clip(message, MAX_MESSAGE_LENGTH))
                        text("exception.stacktrace", Redactor.redact(crash.report(MAX_STACK_TRACE_LENGTH)))
                        bool("exception.escaped", true)
                        text("android.native.signal", crash.signalName)
                        text("android.native.code", crash.code)
                        text("thread.name", crash.threadName)
                        int("thread.id", crash.tid)
                        if (process != null) {
                            all(processAttributes(process, entry.tag))
                        } else {
                            // A daemon is named by its path, which is no package.
                            text("android.package.name", processName.substringBefore(':').takeIf { !it.startsWith("/") && it.contains('.') })
                            text("android.process.name", processName)
                            int("process.pid", pid)
                            text("android.dropbox.tag", entry.tag)
                        }
                    },
            ),
            nativeCrashPid = pid,
        )
    }

    private fun watchdog(entry: DropBoxEntry, observedUnixNano: Long): DropBoxFinding? {
        val headers: DropBoxHeaders = DropBoxHeaderParser.parse(entry.text)
        val subject: String = clip(Redactor.redact(headers["Subject"].orEmpty()), MAX_MESSAGE_LENGTH).ifEmpty { "The system server stopped responding" }
        // "Blocked in handler on foreground thread (android.fg)": the thread that hung, whose stack says on what.
        val blockedThread: String? = Regex("""\(([^()]+)\)""").find(subject)?.groupValues?.get(1)
        val stack: String? =
            blockedThread?.let { ThreadTraceParser.thread(headers.body, it, MAX_STACK_TRACE_LENGTH) }
                ?: ThreadTraceParser.thread(headers.body, "main", MAX_STACK_TRACE_LENGTH)
        return DropBoxFinding.Fault(
            LogRecord(
                timeUnixNano = millisToNanos(entry.timeMillis),
                observedTimeUnixNano = observedUnixNano,
                severity = Severity.FATAL,
                body =
                    clip(
                        "Android's system server stopped responding, and its watchdog restarted it, with every app on the device: $subject",
                        MAX_BODY_LENGTH,
                    ),
                attributes =
                    attributes {
                        text("event.name", "device.watchdog")
                        text("exception.type", "Watchdog")
                        text("exception.message", "system_server: $subject")
                        text("exception.stacktrace", stack?.let { Redactor.redact(it) })
                        bool("exception.escaped", true)
                        text("android.process.name", "system_server")
                        text("android.dropbox.tag", entry.tag)
                    },
            ),
        )
    }

    private fun systemRestart(entry: DropBoxEntry, observedUnixNano: Long): DropBoxFinding =
        DropBoxFinding.Event(
            LogRecord(
                timeUnixNano = millisToNanos(entry.timeMillis),
                observedTimeUnixNano = observedUnixNano,
                severity = Severity.WARN,
                body = "Android's system server restarted without the device rebooting, so every app on it restarted.",
                attributes =
                    attributes {
                        text("event.name", "device.system_restart")
                        text("android.dropbox.tag", entry.tag)
                    },
            ),
        )

    private fun processAttributes(process: DropBoxProcess, tag: String) =
        attributes {
            text("android.package.name", process.packageName)
            text("android.process.name", process.processName)
            text("android.package.version", process.versionName)
            int("process.pid", process.pid)
            bool("android.app.foreground", process.foreground)
            int("android.dropbox.dropped_count", process.droppedCount?.takeIf { it > 0 })
            text("android.dropbox.tag", tag)
        }

    // The system server's own entries may name no process.
    private fun systemServer(tag: String): DropBoxProcess? =
        if (tag.startsWith("system_server")) {
            DropBoxProcess("system_server", null, 1000, null, null, null, null)
        } else {
            null
        }

    private fun clip(text: String, max: Int): String = if (text.length > max) text.take(max - 1) + "…" else text

    private const val ABORT_IN_MESSAGE_LENGTH: Int = 200
}
