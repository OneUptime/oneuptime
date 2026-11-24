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
 * A secret inside a longer word is left (x4111111111111111y is no card), and
 * a word is made of ASCII letters, digits and "_": a letter of another
 * script beside a secret makes it no part of one. Chinese and Japanese run
 * their words together, so a card number or an address in their text is
 * often written right against a letter (卡号4111111111111111,
 * 邮箱jane@example.com). The patterns write those characters out rather than
 * say \w, \b or \d. Android's regular expressions (ICU's) read those with the
 * letters, marks and digits of every script, and \b looks past a combining
 * mark or a zero-width space too, while the JVM, where the unit tests run,
 * and JavaScript, where OneUptime runs its copy (AndroidAgentRedactor.ts),
 * read them as ASCII: such a secret was kept on the device alone (#10835).
 * Written out, the three read every text alike. A case-insensitive pattern
 * turns that on only after its look-behind, because under (?i) Android's
 * regular expressions count "ſ" and "K" (U+017F, U+212A) among the ASCII
 * letters too.
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

    /*
     * Each place a payment card number may start, with the longest run of a
     * card's digits from there that ends where one may end, captured in a
     * look-ahead: 13 to 19 digits, the first a card network's (2 to 6), each
     * group separated by at most one space or dash, neither end beside an
     * ASCII letter, digit, "_" or ".". The match itself is empty, so the next
     * one is looked for from the next character, and each group of a longer
     * run of numbers is a place of its own: in "1 4111 1111 1111 1111" the
     * card starts at the second group. redactCards then checks the run, and
     * each shorter one from the same place that ends before one of its
     * spaces or dashes: in "4111 1111 1111 1111 12/25" the card ends before
     * the expiry's month.
     *
     * Read as one number with what stood beside it, such a card failed the
     * Luhn check and was kept. On Android, a letter of another script right
     * after the other number ended the run where a word's letter does, so
     * the device found the card in "有效 4111111111111111 123元" by chance;
     * it finds it now because each shorter run is checked (#10835).
     */
    private val CARD_START: Regex = Regex("""(?<![A-Za-z0-9_.])(?=([2-6](?:[ -]?[0-9]){12,18})(?![A-Za-z0-9_.]))""")
    private val SEPARATORS: CharArray = charArrayOf(' ', '-')

    private val EMAIL_ADDRESS: Regex =
        Regex("""(?<![A-Za-z0-9_.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9_-])""")

    private val AUTHORIZATION: Regex = Regex("""(?<![A-Za-z0-9_])(?i)(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}""")
    private val SCHEMES: Set<String> = setOf("bearer", "basic")

    /*
     * A JSON Web Token, looked for once per run of the characters a token is
     * made of. A token starts where "eyJ" is not inside a longer word: at the
     * run's start (the look-behind says the character before the run is none
     * of a token's, so no ASCII letter, digit or "_"), or just after a "-" in
     * the run. The match begins only where such a run begins, the atomic
     * group settles on the first of those places in the run where "eyJ" is,
     * and keeps it, and the run's text before that place is the first group,
     * which the replacement puts back. A later place in the same run has a
     * shorter first segment and ends no better, so the same tokens are taken
     * out as by (?<![A-Za-z0-9_])eyJ... tried from every place, while a long
     * run is read a bounded number of times rather than once more from each
     * "eyJ" in it: that took 12 seconds on 100 KB of "-eyJ-" under Android
     * 15, and four times as long for twice the text (#10786).
     *
     * The server's copy (AndroidAgentRedactor.ts) does the same in
     * JavaScript. This one differs in two places, for Android's regular
     * expressions (ICU):
     * - The atomic group. JavaScript has none, so the server's copy captures
     *   the run's text in a look-ahead and reads it again with \1. ICU takes
     *   \1 for nothing when it works out where a match may start, so it
     *   would start one only at an "e", and miss every token after a "-".
     * - Each segment is five characters and then any more, not {5,}. ICU
     *   keeps a place to go back to for each character a counted repeat
     *   reads. On a segment of about 250,000 characters it runs out of room,
     *   Android's matcher says it found nothing, and that token and every
     *   later one stay in the text.
     *
     * The look-ahead once said \beyJ, Android's own word boundary, so a token
     * right after "中" or "é" was kept on the device alone (#10835).
     */
    private val JWT: Regex =
        Regex(
            """(?<![A-Za-z0-9_-])(?>((?:[A-Za-z0-9_-]*?-)??)(?=eyJ))eyJ[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*""",
        )

    /*
     * A secret-sounding name, then = or :, then its value: a quoted string,
     * or everything up to a space, a comma, a semicolon, an ampersand or a
     * closing bracket. The name may be quoted, as in JSON, and may end in one
     * of the words ("db_password", "x-api-key", "accessToken").
     *
     * The name starts where an ASCII word does (in "用户password=x" it is
     * "password"), and what comes before the word is at most 40 characters:
     * an open `[\w-]*` there backtracked over every position of a long word,
     * and took minutes over a 256 KB line of letters. Bounded, each position
     * costs at most 40 steps. Android's engine once counted every script's
     * letters in that word, so a value after 40 Chinese characters with no
     * space between was kept on the device alone (#10835).
     */
    private val SECRET_ASSIGNMENT: Regex =
        Regex(
            // The closing brace is escaped in its class too: Android's regex engine (ICU) refuses a bare one.
            """(?<![A-Za-z0-9_-])(?i)(["']?[A-Za-z0-9_-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?\s{0,8}[:=]\s{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\s,;&)\]\}]+)""",
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
        result = redactCards(result)
        return result
    }

    /** Every JSON Web Token in the text replaced with [TOKEN], and nothing else changed. */
    internal fun redactTokens(text: String): String = JWT.replace(text, "\$1$TOKEN")

    /*
     * Every card number in the text replaced with [CARD], and nothing else
     * changed: at each place one may start (CARD_START), the longest card
     * from there. A place inside a card already taken out is passed over.
     * The text is read once, with one matcher, as replaceEach reads it.
     */
    internal fun redactCards(text: String): String {
        val matcher: Matcher = CARD_START.toPattern().matcher(text)
        var result: StringBuilder? = null
        var last = 0
        while (matcher.find()) {
            val start: Int = matcher.start()
            if (start < last) {
                continue
            }
            val length: Int = cardLength(matcher.group(1).orEmpty())
            if (length > 0) {
                val builder: StringBuilder = result ?: StringBuilder(text.length).also { result = it }
                builder.append(text, last, start).append(CARD)
                last = start + length
            }
        }
        val builder: StringBuilder = result ?: return text
        return builder.append(text, last, text.length).toString()
    }

    /*
     * How much of [run] (a card's digits, single spaces or dashes between
     * them) from its start is a card number: the whole run, or the longest
     * part of it that ends before one of its spaces or dashes and passes.
     * Zero when none does.
     */
    private fun cardLength(run: String): Int {
        val digits: String = run.filter { it in '0'..'9' }
        var end: Int = run.length
        var count: Int = digits.length
        while (count >= 13) {
            if (looksLikeCardNumber(digits.substring(0, count))) {
                return end
            }
            val separator: Int = run.lastIndexOfAny(SEPARATORS, end - 1)
            if (separator < 0) {
                return 0
            }
            // Everything between the separator and the end is the last group's digits.
            count -= end - separator - 1
            end = separator
        }
        return 0
    }

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

    /**
     * The Luhn check every payment card number passes, and most other long
     * numbers do not. ASCII digits only, as the server's copy reads them: a
     * digit of another script ("٤") is no card's.
     */
    fun passesLuhn(digits: String): Boolean {
        if (digits.isEmpty() || digits.any { it !in '0'..'9' }) {
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
