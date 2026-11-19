package com.oneuptime.androidagent.logs

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
 * Bounded: each pattern is linear, and the text is cut to [MAX_LENGTH]
 * before any of them runs.
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

    private val JWT: Regex = Regex("""\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}""")

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
        result = JWT.replace(result, TOKEN)
        result = AUTHORIZATION.replace(result) { match -> "${match.groupValues[1]} $CREDENTIAL" }
        result =
            SECRET_ASSIGNMENT.replace(result) { match ->
                val value: String = match.groupValues[2]
                // A value already taken out (one of the markers above), or a scheme whose credential was just taken out, is left.
                val isMarker: Boolean = value.startsWith("[") && value.endsWith("]")
                if (value.isEmpty() || isMarker || value == "\"$REDACTED\"" || value.lowercase() in SCHEMES) {
                    match.value
                } else {
                    val quote: String = if (value.length >= 2 && (value[0] == '"' || value[0] == '\'')) value[0].toString() else ""
                    "${match.groupValues[1]}$quote$REDACTED$quote"
                }
            }
        result = EMAIL_ADDRESS.replace(result, EMAIL)
        result =
            CARD_CANDIDATE.replace(result) { match ->
                val digits: String = match.value.filter { it.isDigit() }
                if (looksLikeCardNumber(digits)) CARD else match.value
            }
        return result
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
