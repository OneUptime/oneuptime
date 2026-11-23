package com.oneuptime.androidagent.logs

import java.util.regex.Matcher

/**
 * Takes what must not leave the device out of the text the agent sends from
 * other apps: their log lines, the messages of their crashes, their stack
 * traces and the kernel's last lines before a reboot.
 *
 * The agent reads what every app on a kiosk or a POS terminal writes, and an
 * app writes what it should not more often than anyone would like: a payment
 * SDK that logs the card it declined, a request logged with its token, a
 * customer's e-mail address in an exception's message. Each of these is
 * replaced with a marker that says what was there, so the line still reads,
 * an exception still groups (the marker is the same every time, where the
 * card number was not), and nobody receives the value:
 *
 *   a payment card number (13 to 19 digits, spaces or dashes allowed,
 *     a card network's first digit, and the Luhn
 *     check passed)                                [card number]
 *   an e-mail address                              [email]
 *   a bearer or basic credential                   Bearer [credential]
 *   a JSON Web Token                               [token]
 *   the value of a secret-sounding name:
 *     password=..., "token": "...", api_key: ...   password=[redacted]
 *
 * It is deliberately narrow. A device's own identifiers (its serial number,
 * its IP address) are not secrets in a device-monitoring tool, and the agent
 * sends them itself; blanking every long number would blank process ids,
 * timestamps and addresses in stack traces, which are what a crash is read
 * by.
 *
 * Bounded: each pattern is linear, each reads the text with one matcher
 * (replaceEach says why), and the text is cut to [MAX_LENGTH] before any of
 * them runs.
 */
object Redactor {
    const val MAX_LENGTH: Int = 256 * 1024

    const val CARD: String = "[card number]"
    const val EMAIL: String = "[email]"
    const val CREDENTIAL: String = "[credential]"
    const val TOKEN: String = "[token]"
    const val REDACTED: String = "[redacted]"

    // 13 to 19 digits, each group separated by at most one space or dash, not inside a longer number or word.
    private val CARD_CANDIDATE: Regex = Regex("""(?<![\w.])\d(?:[ -]?\d){12,18}(?![\w.])""")

    private val EMAIL_ADDRESS: Regex =
        Regex("""(?<![\w.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![\w-])""")

    private val AUTHORIZATION: Regex = Regex("""(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}""")
    private val SCHEMES: Set<String> = setOf("bearer", "basic")

    /*
     * A JSON Web Token, looked for once per run of the characters a token is
     * made of. A token starts where \beyJ does: at the run's start, when the
     * character before the run is no word character, or just after a "-" in
     * the run. The match begins only where such a run begins, the atomic
     * group settles on the first place in the run where \beyJ holds and keeps
     * it, and the run's text before that place is the first group, which the
     * replacement puts back. A later place in the same run has a shorter
     * first segment and ends no better, so the same tokens are taken out as
     * by \beyJ... tried from every word boundary, while a long run is read a
     * bounded number of times rather than once more from each "eyJ" in it:
     * that took 12 seconds on 100 KB of "-eyJ-" under Android 15, and four
     * times as long for twice the text (#10786).
     *
     * The server's copy (AndroidAgentRedactor.ts) does the same in
     * JavaScript. This one differs in three places, for Android's regular
     * expressions (ICU):
     * - The atomic group. JavaScript has none, so the server's copy captures
     *   the run's text in a look-ahead and reads it again with \1. ICU takes
     *   \1 for nothing when it works out where a match may start, so it
     *   would start one only at an "e", and miss every token after a "-".
     * - \b stays. It is each engine's own word boundary, and Android's counts
     *   the letters of every script, so a token glued to "é" or "中" is kept
     *   there, as it always was.
     * - Each segment is five characters and then any more, not {5,}. ICU
     *   keeps a place to go back to for each character a counted repeat
     *   reads. On a segment of about 250,000 characters it runs out of room,
     *   Android's matcher says it found nothing, and that token and every
     *   later one stay in the text.
     */
    private val JWT: Regex =
        Regex(
            """(?<![A-Za-z0-9_-])(?>((?:[A-Za-z0-9_-]*?-)??)(?=\beyJ))eyJ[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*""",
        )

    /*
     * A secret-sounding name, then = or :, then its value: a quoted string,
     * or everything up to a space, a comma, a semicolon, an ampersand or a
     * closing bracket. The name may be quoted, as in JSON, and may end in one
     * of the words ("db_password", "x-api-key", "accessToken").
     *
     * The name starts where a word does, and what comes before the word is
     * at most 40 characters: an open `[\w-]*` there backtracked over every
     * position of a long word, and took minutes over a 256 KB line of
     * letters. Bounded, each position costs at most 40 steps.
     */
    private val SECRET_ASSIGNMENT: Regex =
        Regex(
            // The closing brace is escaped in its class too: Android's regex engine (ICU) refuses a bare one.
            """(?i)((?<![\w-])["']?[\w-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?\s{0,8}[:=]\s{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\s,;&)\]\}]+)""",
        )

    fun redact(text: String?): String {
        if (text.isNullOrEmpty()) {
            return text.orEmpty()
        }
        var result: String = if (text.length > MAX_LENGTH) text.take(MAX_LENGTH) else text
        result = redactTokens(result)
        result = AUTHORIZATION.replaceEach(result) { match -> "${match.group(1).orEmpty()} $CREDENTIAL" }
        result =
            SECRET_ASSIGNMENT.replaceEach(result) { match ->
                val value: String = match.group(2).orEmpty()
                // A value already taken out (one of the markers above), or a scheme whose credential was just taken out, is left.
                val isMarker: Boolean = value.startsWith("[") && value.endsWith("]")
                if (value.isEmpty() || isMarker || value == "\"$REDACTED\"" || value.lowercase() in SCHEMES) {
                    match.group()
                } else {
                    val quote: String = if (value.length >= 2 && (value[0] == '"' || value[0] == '\'')) value[0].toString() else ""
                    "${match.group(1).orEmpty()}$quote$REDACTED$quote"
                }
            }
        result = EMAIL_ADDRESS.replace(result, EMAIL)
        result =
            CARD_CANDIDATE.replaceEach(result) { match ->
                val digits: String = match.group().filter { it.isDigit() }
                if (looksLikeCardNumber(digits)) CARD else match.group()
            }
        return result
    }

    /** Every JSON Web Token in the text replaced with [TOKEN], and nothing else changed. */
    internal fun redactTokens(text: String): String = JWT.replace(text, "\$1$TOKEN")

    /*
     * Each match replaced with what [replacement] makes of it, the text read
     * once with one matcher. Kotlin's replace(text) { ... } opens a new
     * matcher for each match after the first, and Android copies the whole
     * text into each one: 250 KB of a crash message with 18,000 numbers in
     * it took five seconds that way, and four times as long for twice the
     * text. (replace(text, "...") reads with one matcher already.)
     */
    private inline fun Regex.replaceEach(text: String, replacement: (Matcher) -> String): String {
        val matcher: Matcher = toPattern().matcher(text)
        if (!matcher.find()) {
            return text
        }
        val result = StringBuilder(text.length)
        var last = 0
        do {
            result.append(text, last, matcher.start()).append(replacement(matcher))
            last = matcher.end()
        } while (matcher.find())
        return result.append(text, last, text.length).toString()
    }

    /*
     * 13 to 19 digits that start as a card network's numbers do (2 to 6:
     * Mastercard, American Express, JCB, Diners, Visa, Maestro, Discover,
     * UnionPay) and pass the Luhn check. The first digit keeps the
     * millisecond and nanosecond timestamps logs are full of, which start
     * with 1, from being taken for a card a tenth of the time.
     */
    fun looksLikeCardNumber(digits: String): Boolean = digits.length in 13..19 && digits[0] in '2'..'6' && passesLuhn(digits)

    /** The Luhn check every payment card number passes, and most other long numbers do not. */
    fun passesLuhn(digits: String): Boolean {
        if (digits.isEmpty() || digits.any { !it.isDigit() }) {
            return false
        }
        var sum = 0
        var double = false
        for (index in digits.indices.reversed()) {
            var digit: Int = digits[index] - '0'
            if (double) {
                digit *= 2
                if (digit > 9) {
                    digit -= 9
                }
            }
            sum += digit
            double = !double
        }
        return sum % 10 == 0
    }
}
