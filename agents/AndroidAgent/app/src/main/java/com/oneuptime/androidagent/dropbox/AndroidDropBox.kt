package com.oneuptime.androidagent.dropbox

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.DropBoxManager
import android.os.Process
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

/** [DropBoxSource] over Android's DropBoxManager. */
class AndroidDropBoxSource(context: Context) : DropBoxSource {
    private val manager: DropBoxManager? = context.getSystemService(DropBoxManager::class.java)

    override fun next(afterMillis: Long, span: (tag: String) -> DropBoxTextSpan?): DropBoxEntry? {
        val dropBox: DropBoxManager = manager ?: return null
        val entry: DropBoxManager.Entry = dropBox.getNextEntry(null, afterMillis) ?: return null
        return entry.use { found ->
            val tag: String = found.tag.orEmpty()
            val wanted: DropBoxTextSpan? = span(tag)
            val isText: Boolean = found.flags and DropBoxManager.IS_TEXT != 0
            val text: String =
                if (wanted != null && isText) {
                    try {
                        // getInputStream undoes the compression Android stores an entry with.
                        found.inputStream?.use { input -> readBounded(input, wanted) }.orEmpty()
                    } catch (_: IOException) {
                        // Android deleted it to make room while it was being read: passed over.
                        ""
                    }
                } else {
                    ""
                }
            DropBoxEntry(tag, found.timeMillis, text)
        }
    }

    override fun isTagEnabled(tag: String): Boolean = manager?.isTagEnabled(tag) ?: false

    companion object {
        // The most read of an entry whose end is wanted: a kernel log is kept at 64 to 192 KB.
        private const val MAX_TAIL_SCAN_BYTES: Long = 4L * 1024 * 1024

        /** The first or last [DropBoxTextSpan.maxBytes] of [input], as text. */
        fun readBounded(input: InputStream, span: DropBoxTextSpan): String {
            return try {
                if (!span.fromEnd) {
                    val out = ByteArrayOutputStream(minOf(span.maxBytes, 16 * 1024))
                    val chunk = ByteArray(8 * 1024)
                    while (out.size() < span.maxBytes) {
                        val read: Int = input.read(chunk, 0, minOf(chunk.size, span.maxBytes - out.size()))
                        if (read < 0) break
                        out.write(chunk, 0, read)
                    }
                    String(out.toByteArray(), Charsets.UTF_8)
                } else {
                    // A ring of the last maxBytes read.
                    val ring = ByteArray(span.maxBytes)
                    var total = 0L
                    val chunk = ByteArray(8 * 1024)
                    while (total < MAX_TAIL_SCAN_BYTES) {
                        val read: Int = input.read(chunk)
                        if (read < 0) break
                        for (index in 0 until read) {
                            ring[((total + index) % span.maxBytes).toInt()] = chunk[index]
                        }
                        total += read
                    }
                    val size: Int = minOf(total, span.maxBytes.toLong()).toInt()
                    val start: Int = if (total <= span.maxBytes) 0 else (total % span.maxBytes).toInt()
                    val ordered = ByteArray(size) { index -> ring[(start + index) % span.maxBytes] }
                    // The cut may land inside a line: start at the next whole one.
                    val text = String(ordered, Charsets.UTF_8)
                    if (total > span.maxBytes) text.substringAfter('\n', text) else text
                }
            } catch (_: IOException) {
                ""
            }
        }
    }
}

/** [DropBoxAccess] from the agent's own permissions and app ops. */
class AndroidDropBoxAccess(private val context: Context) : DropBoxAccess {
    override fun permissionGranted(): Boolean =
        granted(Manifest.permission.READ_LOGS) ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM && granted(READ_DROPBOX_DATA))

    /*
     * DropBoxManagerService notes GET_USAGE_STATS for the caller: allowed is
     * allowed; the default falls back to the PACKAGE_USAGE_STATS permission;
     * anything else makes getNextEntry return nothing, with no exception -
     * which is why it is asked here first.
     */
    override fun usageAccessGranted(): Boolean =
        try {
            val appOps: AppOpsManager = context.getSystemService(AppOpsManager::class.java) ?: return false
            val mode: Int =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
                } else {
                    @Suppress("DEPRECATION")
                    appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
                }
            when (mode) {
                AppOpsManager.MODE_ALLOWED -> true
                AppOpsManager.MODE_DEFAULT -> granted(Manifest.permission.PACKAGE_USAGE_STATS)
                else -> false
            }
        } catch (_: RuntimeException) {
            false
        }

    private fun granted(permission: String): Boolean = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    companion object {
        // Manifest.permission.READ_DROPBOX_DATA, Android 15: named here so the agent builds against any SDK.
        const val READ_DROPBOX_DATA: String = "android.permission.READ_DROPBOX_DATA"

        /** Whether this device defines READ_DROPBOX_DATA, so asking for it with `pm grant` works. */
        fun readDropBoxDataExists(context: Context): Boolean =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM &&
                try {
                    context.packageManager.getPermissionInfo(READ_DROPBOX_DATA, 0)
                    true
                } catch (_: PackageManager.NameNotFoundException) {
                    false
                }
    }
}
