package com.oneuptime.androidagent.dropbox

/*
 * Parsers for the text of the DropBox entries the agent reads. Each takes the
 * entry's text and never throws: what it cannot find is null or empty.
 *
 * The formats are Android's own, as AOSP writes them:
 *
 *   - ActivityManagerService.addErrorToDropBox writes an app's crash, ANR,
 *     native crash and the system server's watchdog: "Name: value" headers
 *     (Process, PID, UID, Package, Subject, Dropped-Count, ...), a blank line,
 *     then the Java stack, the ANR's traces or the native crash's report.
 *   - debuggerd writes a tombstone, which BootReceiver copies in with the
 *     boot's headers in front: the signal, the abort message and a backtrace
 *     of the crashing thread, then registers, memory and logs.
 *   - BootReceiver writes SYSTEM_BOOT, SYSTEM_RESTART and SYSTEM_LAST_KMSG:
 *     the boot's headers, and for the last one the tail of the kernel's log
 *     from before the reboot, with "Last boot reason: ..." at its end.
 */

/** An entry's leading "Name: value" lines, and the text after the blank line that ends them. */
data class DropBoxHeaders(val values: Map<String, String>, val body: String) {
    operator fun get(name: String): String? = values[name]?.trim()?.takeIf { it.isNotEmpty() }
}

object DropBoxHeaderParser {
    // "Name: value", where a name is a word with dashes ("Process", "Dropped-Count", "isPrevious").
    private val HEADER: Regex = Regex("""^([A-Za-z][A-Za-z0-9_-]{0,40}): ?(.*)$""")

    fun parse(text: String): DropBoxHeaders {
        val values: LinkedHashMap<String, String> = linkedMapOf()
        val lines: List<String> = text.lines()
        var index = 0
        while (index < lines.size) {
            val line: String = lines[index]
            if (line.isBlank()) {
                index += 1
                break
            }
            val match: MatchResult = HEADER.matchEntire(line.trimEnd('\r')) ?: break
            // The first value wins: an entry names each header once, and a later line that looks like one is body.
            values.putIfAbsent(match.groupValues[1], match.groupValues[2].trim())
            index += 1
        }
        return DropBoxHeaders(values, lines.drop(index).joinToString("\n"))
    }
}

/** The process an ActivityManager entry is about. */
data class DropBoxProcess(
    val processName: String,
    val pid: Long?,
    val uid: Long?,
    // "com.example.kiosk v42 (4.2.0)": the package, its version code and its version name.
    val packageName: String?,
    val versionName: String?,
    val foreground: Boolean?,
    // How many entries of this process Android left out since the last one, because it crashed too often.
    val droppedCount: Long?,
)

object DropBoxProcessParser {
    private val PACKAGE: Regex = Regex("""^(\S+)(?:\s+v(\d+))?(?:\s+\((.*)\))?\s*$""")

    fun parse(headers: DropBoxHeaders): DropBoxProcess? {
        val process: String = headers["Process"] ?: return null
        val packageMatch: MatchResult? = headers["Package"]?.let { PACKAGE.matchEntire(it) }
        return DropBoxProcess(
            processName = process,
            pid = headers["PID"]?.toLongOrNull(),
            uid = headers["UID"]?.toLongOrNull(),
            packageName = packageMatch?.groupValues?.get(1)?.takeIf { it.isNotEmpty() } ?: process.substringBefore(':'),
            versionName = packageMatch?.groupValues?.get(3)?.takeIf { it.isNotEmpty() },
            foreground =
                when (headers["Foreground"]?.lowercase()) {
                    "yes" -> true
                    "no" -> false
                    else -> null
                },
            droppedCount = headers["Dropped-Count"]?.toLongOrNull(),
        )
    }
}

/** A Java exception as a crash's stack trace starts: "java.lang.IllegalStateException: Printer offline". */
data class JavaThrowable(val type: String, val message: String, val stackTrace: String)

object JavaStackParser {
    // A class name, optionally with a message after ": ".
    private val FIRST_LINE: Regex = Regex("""^([A-Za-z_$][\w$]*(?:\.[\w$]+)+)(?::\s?(.*))?$""")

    /**
     * The exception at the top of [body], and its stack: every line up to the
     * first blank line, or to the logcat lines Android appends to a crash on
     * a debug build ("--------- beginning of ..."), which are other apps'
     * lines and not the crash's.
     */
    fun parse(body: String, maxStackLength: Int): JavaThrowable? {
        val lines: List<String> = body.trimStart('\n', '\r').lines()
        val first: String = lines.firstOrNull()?.trim() ?: return null
        val match: MatchResult = FIRST_LINE.matchEntire(first) ?: return null
        val stack: StringBuilder = StringBuilder()
        for (line in lines) {
            if (line.isBlank() || line.startsWith("---------")) {
                break
            }
            if (stack.length + line.length + 1 > maxStackLength) {
                stack.append(TRUNCATED)
                break
            }
            if (stack.isNotEmpty()) {
                stack.append('\n')
            }
            stack.append(line.trimEnd('\r'))
        }
        return JavaThrowable(match.groupValues[1], match.groupValues[2].trim(), stack.toString())
    }

    const val TRUNCATED: String = "\n\t... (cut short by the OneUptime agent)"
}

/** One thread of an ANR's or a watchdog's traces: its header line and its frames. */
object ThreadTraceParser {
    private val THREAD_HEADER: Regex = Regex("""^"([^"]*)".*\btid=\d+.*$""")

    /**
     * The stack of the thread named [threadName] (the main thread's, `main`,
     * for an ANR): from its header line to the blank line after it.
     */
    fun thread(body: String, threadName: String, maxLength: Int): String? {
        val lines: List<String> = body.lines()
        val start: Int = lines.indexOfFirst { line -> THREAD_HEADER.matchEntire(line.trim())?.groupValues?.get(1) == threadName }
        if (start < 0) {
            return null
        }
        val stack: StringBuilder = StringBuilder()
        for (line in lines.subList(start, lines.size)) {
            if (line.isBlank()) {
                break
            }
            if (stack.length + line.length + 1 > maxLength) {
                stack.append(JavaStackParser.TRUNCATED)
                break
            }
            if (stack.isNotEmpty()) {
                stack.append('\n')
            }
            stack.append(line.trimEnd('\r'))
        }
        return stack.toString().takeIf { it.isNotEmpty() }
    }
}

/** What a native crash (a tombstone) says, without its registers, memory or logs. */
data class NativeCrash(
    val processName: String?,
    val threadName: String?,
    val pid: Long?,
    val tid: Long?,
    // "SIGSEGV", "SIGABRT".
    val signalName: String?,
    val signalNumber: Int?,
    // "SEGV_MAPERR", "SI_USER from pid 1234, uid 0".
    val code: String?,
    val faultAddress: String?,
    val abortMessage: String?,
    val cause: String?,
    // The crashing thread's frames, "#00 pc 0000000000049b70  /system/lib64/libc.so (abort+164)".
    val frames: List<String>,
) {
    /**
     * The frame that names the crash best: the first one outside Android's
     * runtime (libc's abort, ART's trampolines, the linker), so an app's
     * crash is named by its own library and a vendor daemon's by the
     * vendor's; the first frame when every one is the runtime's.
     */
    val topFrame: NativeFrame?
        get() {
            val parsed: List<NativeFrame> = frames.mapNotNull { NativeFrameParser.parse(it) }
            return parsed.firstOrNull { !it.isRuntime } ?: parsed.firstOrNull()
        }

    /** The report sent as the exception's stack trace: the signal and the backtrace. */
    fun report(maxLength: Int): String {
        val text: StringBuilder = StringBuilder()
        fun line(value: String?) {
            if (!value.isNullOrBlank()) {
                if (text.isNotEmpty()) text.append('\n')
                text.append(value)
            }
        }
        line(listOfNotNull(pid?.let { "pid: $it" }, tid?.let { "tid: $it" }, threadName?.let { "name: $it" }).joinToString(", ").ifEmpty { null })
        line(
            signalName?.let {
                buildString {
                    append("signal ")
                    signalNumber?.let { number -> append(number).append(' ') }
                    append('(').append(it).append(')')
                    code?.let { value -> append(", code ").append(value) }
                    faultAddress?.let { value -> append(", fault addr ").append(value) }
                }
            },
        )
        line(cause?.let { "Cause: $it" })
        line(abortMessage?.let { "Abort message: '$it'" })
        if (frames.isNotEmpty()) {
            line("backtrace:")
            for (frame in frames) {
                if (text.length + frame.length + 1 > maxLength) {
                    text.append(JavaStackParser.TRUNCATED)
                    break
                }
                line("  $frame")
            }
        }
        return text.toString()
    }
}

data class NativeFrame(val index: Int, val library: String, val function: String?) {
    /** The library's file name, "libprinter.so", without the install path Android changes on every update. */
    val libraryName: String get() = library.substringAfterLast('/')

    val isSystemLibrary: Boolean
        get() = SYSTEM_PREFIXES.any { library.startsWith(it) }

    /** Android's own runtime, which every crash passes through: never what names one. */
    val isRuntime: Boolean
        get() =
            libraryName in RUNTIME_LIBRARIES ||
                library.startsWith("[") ||
                (isSystemLibrary && (libraryName.startsWith("boot") && (libraryName.endsWith(".oat") || libraryName.endsWith(".art"))))

    /** "libprinter.so (print_job+52)", or the library alone. */
    val label: String get() = if (function.isNullOrEmpty()) libraryName else "$libraryName ($function)"

    companion object {
        private val SYSTEM_PREFIXES: List<String> =
            listOf("/system/", "/apex/", "/vendor/", "/system_ext/", "/product/", "/odm/", "[vdso]", "[anon:")

        private val RUNTIME_LIBRARIES: Set<String> =
            setOf(
                "libc.so",
                "libc++.so",
                "libm.so",
                "libdl.so",
                "linker",
                "linker64",
                "libart.so",
                "libartbase.so",
                "libbase.so",
                "liblog.so",
                "libutils.so",
                "libbinder.so",
                "libhidlbase.so",
                "libandroid_runtime.so",
                "libopenjdkjvm.so",
                "libunwindstack.so",
            )
    }
}

object NativeFrameParser {
    // "#00 pc 0000000000049b70  /system/lib64/libc.so (abort+164) (BuildId: 1a2b...)"
    private val FRAME: Regex = Regex("""^#(\d+)\s+pc\s+[0-9a-fA-F]+\s+(\S+)(.*)$""")

    /**
     * A frame's index, library and function. After the library come groups
     * in parentheses: the function, often with its own parentheses
     * ("android::Printer::send(int)+40"), and, for a library inside an APK,
     * "(offset 0x1f000)" before it; "(BuildId: ...)" last. The function is
     * the first group that is neither of those.
     */
    fun parse(line: String): NativeFrame? {
        val match: MatchResult = FRAME.matchEntire(line.trim()) ?: return null
        val function: String? =
            groups(match.groupValues[3]).firstOrNull { group ->
                group.isNotEmpty() && !group.startsWith("offset ") && !group.startsWith("BuildId:")
            }
        return NativeFrame(match.groupValues[1].toInt(), match.groupValues[2], function)
    }

    // The top-level "(...)" groups of [text], their own parentheses kept.
    private fun groups(text: String): List<String> {
        val found: MutableList<String> = mutableListOf()
        var depth = 0
        var start = -1
        for ((index, char) in text.withIndex()) {
            when (char) {
                '(' -> {
                    if (depth == 0) start = index + 1
                    depth += 1
                }
                ')' -> {
                    if (depth > 0) {
                        depth -= 1
                        if (depth == 0 && start >= 0) {
                            found.add(text.substring(start, index).trim())
                            start = -1
                        }
                    }
                }
            }
        }
        return found
    }
}

object TombstoneParser {
    private val PROCESS_LINE: Regex = Regex("""^pid:\s*(\d+),\s*tid:\s*(\d+),\s*name:\s*(.*?)\s+>>>\s*(.*?)\s*<<<.*$""")
    private val SIGNAL_LINE: Regex = Regex("""^signal\s+(\d+)\s+\((\w+)\),\s*code\s+(-?\d+)(?:\s+\(([^)]*)\))?(?:,\s*fault addr\s+(\S+))?.*$""")
    private val ABORT_LINE: Regex = Regex("""^Abort message:\s*'(.*)'\s*$""")
    private val CAUSE_LINE: Regex = Regex("""^Cause:\s*(.*)$""")
    private const val MAX_FRAMES: Int = 64

    /**
     * Reads a tombstone, or the native crash report Android files for an app
     * (`data_app_native_crash`), which holds the same lines. Null when it has
     * neither a signal nor a backtrace.
     */
    fun parse(text: String): NativeCrash? {
        var processName: String? = null
        var threadName: String? = null
        var pid: Long? = null
        var tid: Long? = null
        var signalName: String? = null
        var signalNumber: Int? = null
        var code: String? = null
        var faultAddress: String? = null
        var abortMessage: String? = null
        var cause: String? = null
        val frames: MutableList<String> = mutableListOf()
        var inBacktrace = false
        var backtraceDone = false

        for (raw in text.lineSequence()) {
            val line: String = raw.trim()
            if (inBacktrace) {
                if (line.startsWith("#") && frames.size < MAX_FRAMES) {
                    frames.add(line)
                    continue
                }
                if (line.startsWith("#")) {
                    continue
                }
                // The crashing thread's backtrace ends at the first line that is not a frame.
                inBacktrace = false
                backtraceDone = true
            }
            when {
                processName == null && PROCESS_LINE.matches(line) -> {
                    val match: MatchResult = PROCESS_LINE.matchEntire(line)!!
                    pid = match.groupValues[1].toLongOrNull()
                    tid = match.groupValues[2].toLongOrNull()
                    threadName = match.groupValues[3].takeIf { it.isNotEmpty() }
                    processName = match.groupValues[4].takeIf { it.isNotEmpty() }
                }
                signalName == null && SIGNAL_LINE.matches(line) -> {
                    val match: MatchResult = SIGNAL_LINE.matchEntire(line)!!
                    signalNumber = match.groupValues[1].toIntOrNull()
                    signalName = match.groupValues[2]
                    code = match.groupValues[4].takeIf { it.isNotEmpty() } ?: match.groupValues[3]
                    faultAddress = match.groupValues[5].takeIf { it.isNotEmpty() && !it.startsWith("--") }
                }
                abortMessage == null && ABORT_LINE.matches(line) -> abortMessage = ABORT_LINE.matchEntire(line)!!.groupValues[1]
                cause == null && CAUSE_LINE.matches(line) -> cause = CAUSE_LINE.matchEntire(line)!!.groupValues[1].trim()
                !backtraceDone && line == "backtrace:" -> inBacktrace = true
            }
            // The rest of a tombstone is other threads, memory and logs: nothing more to read.
            if (backtraceDone && signalName != null && processName != null) {
                break
            }
        }

        if (signalName == null && frames.isEmpty()) {
            return null
        }
        return NativeCrash(processName, threadName, pid, tid, signalName, signalNumber, code, faultAddress, abortMessage, cause, frames)
    }
}

/** What SYSTEM_LAST_KMSG says about the reboot before this boot. */
data class LastKernelLog(
    // ro.boot.bootreason, as the bootloader passed it: "reboot", "kernel_panic", "watchdog", "shutdown,battery".
    val bootReason: String?,
    // The line of a kernel panic, when the log has one: "Kernel panic - not syncing: ...".
    val panic: String?,
    // The last lines of the kernel's log before the reboot.
    val lastLines: List<String>,
)

object LastKernelLogParser {
    private val BOOT_REASON: Regex = Regex("""^Last boot reason:\s*(.*)$""")
    private val PANIC: Regex = Regex("""Kernel panic - not syncing:.*""")
    private const val TRUNCATED_MARKER: String = "[[TRUNCATED]]"

    fun parse(text: String, maxLines: Int): LastKernelLog {
        val headers: DropBoxHeaders = DropBoxHeaderParser.parse(text)
        var bootReason: String? = null
        val logLines: MutableList<String> = mutableListOf()
        var inFooter = false
        for (raw in headers.body.lines()) {
            val line: String = raw.trimEnd('\r')
            if (line.trim() == "Boot info:") {
                inFooter = true
                continue
            }
            if (inFooter) {
                BOOT_REASON.matchEntire(line.trim())?.let { bootReason = it.groupValues[1].trim().takeIf { reason -> reason.isNotEmpty() } }
                continue
            }
            if (line.isBlank() || line.trim() == TRUNCATED_MARKER) {
                continue
            }
            logLines.add(line)
        }
        val panic: String? = logLines.lastOrNull { PANIC.containsMatchIn(it) }?.let { PANIC.find(it)?.value?.trim() }
        return LastKernelLog(bootReason, panic, logLines.takeLast(maxLines))
    }
}
