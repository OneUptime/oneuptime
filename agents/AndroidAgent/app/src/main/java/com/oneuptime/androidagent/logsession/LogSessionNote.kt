package com.oneuptime.androidagent.logsession

import com.oneuptime.androidagent.logs.Redactor

/**
 * The note a log session's requester wrote (#9966): why they ask for every
 * app's logs, which the person at the device reads under the request, in
 * the notification and on the agent's screen, before they allow it.
 *
 * OneUptime sends it as one line of plain text with card numbers, email
 * addresses, tokens and passwords already taken out
 * (Common/Utils/Host/HostLogSessionNote). The agent reads it as it reads
 * anything from the network, and shows only what it would send itself:
 *
 *   - one line: line breaks, tabs and runs of spaces become one space;
 *   - no control characters, and none of the characters that reorder the
 *     text around them on screen (embeddings and overrides, U+202A to
 *     U+202E, and isolates, U+2066 to U+2069), so a note cannot make the
 *     request beside it read otherwise;
 *   - at most [MAX_LENGTH] characters, never cutting one in two;
 *   - redacted again (Redactor), so a OneUptime from before redaction
 *     cannot put a card number on a kiosk's screen.
 */
object LogSessionNote {
    // What OneUptime keeps of a note (its column's length): a redacted note can be longer than the 200 a person types.
    const val MAX_LENGTH: Int = 500

    private val WHITESPACE: Regex = Regex("""[\s\u0085\u00A0\u2028\u2029]+""")
    private val NOT_SHOWN: Regex = Regex("""[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]""")
    private val SPACES: Regex = Regex(" {2,}")

    fun clean(text: String?): String? {
        if (text.isNullOrBlank()) {
            return null
        }
        val oneLine: String = text.replace(WHITESPACE, " ").replace(NOT_SHOWN, "").replace(SPACES, " ").trim()
        if (oneLine.isEmpty()) {
            return null
        }
        return Redactor.redact(cut(oneLine, MAX_LENGTH)).trim().takeIf { it.isNotEmpty() }
    }

    // At most [max] characters (code points), never ending in half of one.
    private fun cut(text: String, max: Int): String {
        if (text.codePointCount(0, text.length) <= max) {
            return text
        }
        return text.substring(0, text.offsetByCodePoints(0, max))
    }
}
