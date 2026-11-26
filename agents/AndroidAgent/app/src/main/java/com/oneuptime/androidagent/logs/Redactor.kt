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
 *   a payment card number (13 to 19 digits of any
 *     script, spaces or dashes allowed, a card
 *     network's first digit, and the Luhn check
 *     passed)                                      [card number]
 *   an e-mail address, in any script               [email]
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
 * Every other class an engine reads its own way is written out as well. A
 * space is one of the characters Android's \s takes, which the JVM's \s
 * reads as ASCII's alone and JavaScript's with U+FEFF and without U+0085
 * (#10876). What reaches beyond ASCII on purpose says so with Unicode's own
 * classes, which the three read alike: a card's digits are any script's
 * (\p{Nd}, #10877), and an address's name and domain any script's letters
 * (\p{L}, #10878).
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

    private const val MIN_CARD_DIGITS: Int = 13
    private const val MAX_CARD_DIGITS: Int = 19

    /*
     * Each place a payment card number may start, with the run of a card's
     * digits from there captured in a look-ahead: 13 to 19 decimal digits,
     * each group separated by at most one space or dash, not right after an
     * ASCII letter, "_" or "." (nor after an ASCII digit, unless the card is
     * in another script's digits). The match itself is empty, so the next one
     * is looked for from the next character, and each group of a longer run
     * of numbers is a place of its own: in "1 4111 1111 1111 1111" the card
     * starts at the second group. redactCards then checks the run, and each
     * shorter one from the same place that ends before one of its spaces or
     * dashes: in "4111 1111 1111 1111 12/25" the card ends before the expiry's
     * month.
     *
     * A digit is any script's (\p{Nd}). Japanese text often writes a card
     * number in fullwidth digits (４１１１ １１１１ …), Arabic and Persian text
     * in their own (٤١١١…, ۴۱۱۱…), and such a card was kept on every engine
     * (#10877). cardLength reads each digit by its value, and only those of
     * Unicode's Basic Multilingual Plane: the 37 scripts' digits there have
     * not changed since Unicode 7, so every Android version the agent runs on
     * reads them as the JVM and JavaScript do. The few scripts whose digits
     * Unicode put beyond it (Adlam, Chakma, Hanifi Rohingya) are left.
     *
     * Read as one number with what stood beside it, a card failed the Luhn
     * check and was kept. On Android, a letter of another script right after
     * the other number once ended the run where a word's letter does, so the
     * device found the card in "有效 4111111111111111 123元" by chance; it
     * finds it now because each shorter run is checked (#10835).
     */
    private val CARD_START: Regex = Regex("""(?:(?<![A-Za-z0-9_.])|(?<=[0-9])(?![0-9]))(?=(\p{Nd}(?:[ -]?\p{Nd}){12,18}))""")

    /*
     * An e-mail address written in ASCII, as the agent has read one since
     * #10835: a name of ASCII letters, digits and "._%+-" right after none of
     * those, and a domain of ASCII labels and an ASCII top-level domain right
     * before no ASCII letter, digit, "_" or "-". Kept as it was, beside
     * EMAIL_ADDRESS, so that no address it took out is kept (redactAddresses
     * says how).
     */
    private val ASCII_EMAIL_ADDRESS: Regex =
        Regex("""(?<![A-Za-z0-9_.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9_-])""")

    /*
     * An e-mail address in any script, as RFC 6531 allows one: josé@example.com,
     * 张伟@example.com, user@例え.jp, почта@пример.рф. Each was kept, whole or in
     * part (josé[email]), on every engine (#10878).
     *
     * Its name is Latin, in ASCII or not (josé, müller), or in the letters of
     * other scripts (张伟, почта), each with digits, marks and "._%+-", but not
     * both: where the two meet is where an address begins, as a letter of
     * another script beside an ASCII address was no part of it (#10835).
     * "邮箱jane@example.com" is still "邮箱[email]". Each starts right after
     * none of its own characters, so a run of them is tried once, from its
     * start, and a name in another script holds at least one of their
     * letters. (ASCII_EMAIL_ADDRESS still starts an ASCII name wherever it
     * did: after "é" in "éjane@example.com", say.) Neither starts with a digit
     * right after a digit and a space: that is the next group of a number,
     * and a card written in groups would lose its last one to the address and
     * be kept ("4111 1111 1111 1111é@例え.jp").
     *
     * Its domain's labels hold the letters, marks and digits of any script, or
     * punycode (例え is xn--r8jz45g). Its top-level domain is ASCII letters,
     * punycode (xn--p1ai is Russia's рф) or another script's letters (рф, 中国).
     * Punycode always holds a letter (each number it encodes ends in one), so
     * "xn--4111" before " 1111 1111 1111" is no top-level domain but the first
     * group of a card. An address ends right before no ASCII letter, digit,
     * "_" or "-", as it did, so a letter of another script after an ASCII
     * top-level domain is no part of it (jane@example.com已发送). One in
     * another script takes in the letters of its script written right after
     * it: nothing tells where it ends.
     */
    private val EMAIL_ADDRESS: Regex =
        Regex(
            """(?!(?<=\p{Nd} )\p{Nd})(?:(?<![\p{sc=Latin}\p{M}\p{Nd}._%+-])[\p{sc=Latin}\p{M}\p{Nd}._%+-]{1,64}|(?<![\p{M}\p{Nd}._%+-]|[^\P{L}\p{sc=Latin}])(?=[\p{M}\p{Nd}._%+-]{0,63}[^\P{L}\p{sc=Latin}])(?:[^\P{L}\p{sc=Latin}]|[\p{M}\p{Nd}._%+-]){1,64})@[\p{L}\p{M}\p{Nd}-]{1,63}(?:\.[\p{L}\p{M}\p{Nd}-]{1,63})*\.(?:[A-Za-z]{2,24}|[Xx][Nn]--(?=[A-Za-z0-9-]{0,58}[A-Za-z])[A-Za-z0-9-]{1,59}|[\p{L}\p{M}]{2,24})(?![A-Za-z0-9_-])""",
        )

    /*
     * A space between a scheme and its credential is one of the characters
     * Android's \s takes, written out (SECRET_ASSIGNMENT's are the same): \t
     * \n \x0B \f \r, a space, U+0085, U+00A0, U+1680, U+2000 to U+200A,
     * U+2028, U+2029, U+202F, U+205F and U+3000. The JVM's \s reads only the
     * first six, so the unit tests could not say what a device does with
     * Chinese and Japanese text's own space (令牌：Bearer　abc…) or a no-break
     * space, and JavaScript's takes U+FEFF and not U+0085 (#10876). Android's
     * set keeps the device as it was: with U+FEFF a space, a secret's value
     * would end at one.
     */
    private val AUTHORIZATION: Regex =
        Regex("""(?<![A-Za-z0-9_])(?i)(bearer|basic)[\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+[A-Za-z0-9._~+/=-]{8,}""")
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
     * of the words ("db_password", "x-api-key", "accessToken"). A space is
     * one of Android's, written out, as in AUTHORIZATION.
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
            """(?<![A-Za-z0-9_-])(?i)(["']?[A-Za-z0-9_-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?[\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]{0,8}[:=][\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000,;&)\]\}]+)""",
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
        result = redactAddresses(result)
        result = redactCards(result)
        return result
    }

    /** Every JSON Web Token in the text replaced with [TOKEN], and nothing else changed. */
    internal fun redactTokens(text: String): String = JWT.replace(text, "\$1$TOKEN")

    /*
     * Every e-mail address in the text replaced with [EMAIL], and nothing else
     * changed: each character ASCII_EMAIL_ADDRESS or EMAIL_ADDRESS takes out,
     * where the two overlap as one address. Read as one pattern, an address in
     * another script found sooner could take the first part of an ASCII
     * address right after it and leave the rest ("中@x.jane@example.com" would
     * keep "example.com"); read apart, the ASCII address is taken out whole,
     * as before. Each pattern reads the text once, with one matcher.
     */
    internal fun redactAddresses(text: String): String {
        if (text.indexOf('@') < 0) {
            return text
        }
        val spans: List<IntRange> = (spansOf(ASCII_EMAIL_ADDRESS, text) + spansOf(EMAIL_ADDRESS, text)).sortedBy { it.first }
        if (spans.isEmpty()) {
            return text
        }
        val result = StringBuilder(text.length)
        var last = 0
        var start: Int = spans[0].first
        var end: Int = spans[0].last + 1
        for (span in spans) {
            if (span.first < end) {
                end = maxOf(end, span.last + 1)
                continue
            }
            result.append(text, last, start).append(EMAIL)
            last = end
            start = span.first
            end = span.last + 1
        }
        return result.append(text, last, start).append(EMAIL).append(text, end, text.length).toString()
    }

    // Where each match of [pattern] in [text] is, the text read once with one matcher.
    private fun spansOf(pattern: Regex, text: String): List<IntRange> {
        val matcher: Matcher = pattern.toPattern().matcher(text)
        val spans: MutableList<IntRange> = mutableListOf()
        while (matcher.find()) {
            spans.add(matcher.start() until matcher.end())
        }
        return spans
    }

    /*
     * Every card number in the text replaced with [CARD], and nothing else
     * changed. A card is looked for in one script's digits first, as #10835
     * read an ASCII card: a digit of another script beside it is no part of
     * it, so "4111111111111111１２" is a card, then "１２". Then, among the
     * digits left, a number that mixes scripts is read whole: a Persian card
     * typed with a few Arabic-Indic digits among its own (the two share most
     * of their shapes), or "４１１１ 1111 1111 1111". Looked for second, such a
     * number cannot take the place of a card in one script's digits.
     *
     * Most texts hold digits of one script alone, and in those, whether
     * scripts may mix changes nothing: such a text, with no card taken out
     * the first time, would be read the second time as it was and give up
     * nothing more, so it is not read again. Read again, each place a card
     * may start in a long line of numbers was looked at twice.
     */
    internal fun redactCards(text: String): String {
        val inOneScript: String = redactCards(text, mixed = false)
        if (inOneScript === text && hasDigitsOfOneScript(text)) {
            return text
        }
        return redactCards(inOneScript, mixed = true)
    }

    /*
     * At each place a card may start (CARD_START), the longest card from
     * there. A place inside a card already taken out is passed over, and so
     * is one inside a longer number: right after a digit of its own script,
     * or after any digit when scripts may mix. The text is read once, with
     * one matcher, as replaceEach reads it.
     */
    private fun redactCards(text: String, mixed: Boolean): String {
        val matcher: Matcher = CARD_START.toPattern().matcher(text)
        var result: StringBuilder? = null
        var last = 0
        while (matcher.find()) {
            val start: Int = matcher.start()
            if (start < last || (start > 0 && carriesOn(text[start - 1], zeroOf(text[start]), mixed))) {
                continue
            }
            val length: Int = cardLength(text, start, matcher.end(1), mixed)
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
     * How much of the text from [start] is a card number: the run of a card's
     * digits there, up to [end] (where CARD_START's capture ends), or the
     * longest part of it that ends before one of its spaces or dashes and
     * passes. Unless [mixed], the run is one script's digits, and ends where
     * another script's begin. The whole run counts only when what comes right
     * after it does not carry it on: an ASCII letter, "_" or ".", or a digit
     * of its number (CARD_START's capture stops at 19 digits). Zero when none
     * passes.
     */
    private fun cardLength(text: String, start: Int, end: Int, mixed: Boolean): Int {
        val zero: Int = zeroOf(text[start])
        if (zero < 0) {
            return 0
        }
        val values = IntArray(MAX_CARD_DIGITS)
        // Where each part that ends before a space or a dash ends, and how many digits it holds.
        val partEnds = IntArray(MAX_CARD_DIGITS)
        val partDigits = IntArray(MAX_CARD_DIGITS)
        var parts = 0
        var count = 0
        var runEnd: Int = start
        var index: Int = start
        while (index < end) {
            val char: Char = text[index]
            if (char == ' ' || char == '-') {
                index++
                continue
            }
            val charZero: Int = zeroOf(char)
            if (charZero < 0 || (!mixed && charZero != zero)) {
                break
            }
            if (index > runEnd) {
                // A space or a dash came between this digit and the last.
                partEnds[parts] = runEnd
                partDigits[parts] = count
                parts++
            }
            values[count++] = char.code - charZero
            index++
            runEnd = index
        }
        if (!carriesOn(text, runEnd, zero, mixed) && isCardNumber(values, count)) {
            return runEnd - start
        }
        for (part in parts - 1 downTo 0) {
            if (isCardNumber(values, partDigits[part])) {
                return partEnds[part] - start
            }
        }
        return 0
    }

    // Whether the character at [index] carries on a number of [zero]'s digits: an ASCII letter, "_" or ".", or such a digit.
    private fun carriesOn(text: String, index: Int, zero: Int, mixed: Boolean): Boolean {
        if (index >= text.length) {
            return false
        }
        val char: Char = text[index]
        return char in 'A'..'Z' || char in 'a'..'z' || char == '_' || char == '.' || carriesOn(char, zero, mixed)
    }

    // Whether [char] is a digit of the number whose digits start at [zero]: one of the same script, or any when scripts may mix.
    private fun carriesOn(char: Char, zero: Int, mixed: Boolean): Boolean {
        val charZero: Int = zeroOf(char)
        return charZero >= 0 && (mixed || charZero == zero)
    }

    /*
     * The first of the ten decimal digits [char] is one of, its script's zero
     * ("٠" for "٤"), or -1 when it is none of the Basic Multilingual Plane's.
     * Character.digit reads a digit of any script by its value.
     */
    private fun zeroOf(char: Char): Int {
        val value: Int = Character.digit(char, 10)
        return if (value < 0) -1 else char.code - value
    }

    // Whether every digit in the text that zeroOf reads is of one script: an ASCII text's, a Persian one's.
    private fun hasDigitsOfOneScript(text: String): Boolean {
        var zero: Int = -1
        for (char in text) {
            val charZero: Int = if (char in '0'..'9') '0'.code else if (char.code < 0x80) -1 else zeroOf(char)
            if (charZero < 0) {
                continue
            }
            if (zero >= 0 && charZero != zero) {
                return false
            }
            zero = charZero
        }
        return true
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
     * UnionPay) and pass the Luhn check, each read by its value, of whatever
     * script. The first digit keeps the millisecond and nanosecond timestamps
     * logs are full of, which start with 1, from being taken for a card a
     * tenth of the time.
     */
    fun looksLikeCardNumber(digits: String): Boolean {
        val values: IntArray = valuesOf(digits) ?: return false
        return isCardNumber(values, values.size)
    }

    /**
     * The Luhn check every payment card number passes, and most other long
     * numbers do not. Each digit is read by its value, whatever its script
     * ("٤" is 4), as the card search reads it (#10877); anything else is no
     * digit, and a digit beyond the Basic Multilingual Plane is none either.
     */
    fun passesLuhn(digits: String): Boolean {
        val values: IntArray = valuesOf(digits) ?: return false
        return passesLuhn(values, values.size)
    }

    private fun isCardNumber(values: IntArray, count: Int): Boolean =
        count in MIN_CARD_DIGITS..MAX_CARD_DIGITS && values[0] in 2..6 && passesLuhn(values, count)

    // The Luhn check over the first [count] of [values].
    private fun passesLuhn(values: IntArray, count: Int): Boolean {
        var sum = 0
        var double = false
        for (index in count - 1 downTo 0) {
            var digit: Int = values[index]
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

    // The value of each of [digits], or null when it is empty or holds anything else.
    private fun valuesOf(digits: String): IntArray? {
        if (digits.isEmpty()) {
            return null
        }
        val values = IntArray(digits.length)
        for (index in digits.indices) {
            values[index] = Character.digit(digits[index], 10)
            if (values[index] < 0) {
                return null
            }
        }
        return values
    }
}
