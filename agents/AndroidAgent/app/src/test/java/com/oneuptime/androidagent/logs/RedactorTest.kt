package com.oneuptime.androidagent.logs

import java.util.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RedactorTest {
    @Test
    fun `a card number is taken out, whichever way it is written`() {
        assertEquals("Declined [card number] at terminal 4", Redactor.redact("Declined 4111111111111111 at terminal 4"))
        assertEquals("card=[card number];", Redactor.redact("card=4111 1111 1111 1111;"))
        assertEquals("pan [card number]", Redactor.redact("pan 5500-0000-0000-0004"))
        assertEquals("Amex [card number] ok", Redactor.redact("Amex 378282246310005 ok"))
    }

    @Test
    fun `a long number that is not a card is kept`() {
        // Fails the Luhn check.
        assertEquals("order 4111111111111112", Redactor.redact("order 4111111111111112"))
        // Millisecond and nanosecond timestamps start with 1, which no card number does.
        assertEquals("at 1795076857467", Redactor.redact("at 1795076857467"))
        assertEquals("t=1795076857467123456", Redactor.redact("t=1795076857467123456"))
        // Too short, and inside a word.
        assertEquals("id 411111111111", Redactor.redact("id 411111111111"))
        assertEquals("x4111111111111111y", Redactor.redact("x4111111111111111y"))
    }

    @Test
    fun `the Luhn check`() {
        assertTrue(Redactor.passesLuhn("4111111111111111"))
        assertTrue(Redactor.passesLuhn("79927398713"))
        assertFalse(Redactor.passesLuhn("79927398710"))
        assertFalse(Redactor.passesLuhn(""))
        assertFalse(Redactor.passesLuhn("41a1"))
        assertTrue(Redactor.looksLikeCardNumber("4111111111111111"))
        assertFalse(Redactor.looksLikeCardNumber("1111111111111117"))
        // A digit of any script is read by its value, as the card search reads it (#10877): "٤" is 4, "１" is 1.
        assertTrue(Redactor.passesLuhn("\u0664\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661"))
        assertTrue(Redactor.passesLuhn("411111111111111\u0661"))
        assertTrue(Redactor.looksLikeCardNumber("411111111111111\uFF11"))
        // Anything else is no digit: a letter, and a digit beyond the Basic Multilingual Plane (Adlam's one, U+1E951).
        assertFalse(Redactor.looksLikeCardNumber("411111111111111x"))
        assertFalse(Redactor.passesLuhn("411111111111111\uD83A\uDD51"))
    }

    @Test
    fun `a secret written right against a letter of another script is taken out`() {
        // Chinese and Japanese run their words together, so a secret in their text often touches a letter (#10835).
        assertEquals("支付失败，卡号[card number]", Redactor.redact("支付失败，卡号4111111111111111"))
        assertEquals("[card number]已拒绝", Redactor.redact("4111111111111111已拒绝"))
        assertEquals("邮箱[email]", Redactor.redact("邮箱jane@example.com"))
        assertEquals("[email]已发送", Redactor.redact("jane@example.com已发送"))
        assertEquals("令牌Bearer [credential]", Redactor.redact("令牌Bearer abcdefghijklmnop"))
        assertEquals("令牌[token]", Redactor.redact("令牌$JWT"))
        assertEquals("用户password=[redacted]", Redactor.redact("用户password=hunter2"))
        assertEquals("カード番号[card number]です", Redactor.redact("カード番号4111 1111 1111 1111です"))
        assertEquals("トークン[token]を送信", Redactor.redact("トークン${JWT}を送信"))
        assertEquals("メール[email]に送信しました", Redactor.redact("メールjane.doe+kiosk@example.co.ukに送信しました"))
        // Korean, Arabic, Cyrillic, Thai and Devanagari.
        assertEquals("카드번호[card number]승인거절", Redactor.redact("카드번호4111111111111111승인거절"))
        assertEquals("이메일[email]으로", Redactor.redact("이메일jane@example.com으로"))
        assertEquals("토큰Bearer [credential]", Redactor.redact("토큰Bearer abcdefghijklmnop"))
        assertEquals("رقم البطاقة[card number]", Redactor.redact("رقم البطاقة5500-0000-0000-0004"))
        assertEquals("البريد[email]", Redactor.redact("البريدjane@example.com"))
        assertEquals("номер[card number]отклонён", Redactor.redact("номер4111111111111111отклонён"))
        assertEquals("ключBasic [credential]", Redactor.redact("ключBasic dXNlcjpwYXNzd29yZA=="))
        assertEquals("токен[token]", Redactor.redact("токен$JWT"))
        assertEquals("บัตร[card number]", Redactor.redact("บัตร378282246310005"))
        assertEquals("कार्ड[card number]", Redactor.redact("कार्ड4111111111111111"))
        // A secret's value after a long run of another script's letters: Android counted them into a 40-character name.
        assertEquals("中".repeat(41) + "password=[redacted]", Redactor.redact("中".repeat(41) + "password=hunter2"))
    }

    @Test
    fun `a mark, a joiner, a digit of another script or a folded letter beside a secret is no word's part either`() {
        // A zero-width space, a joiner, a combining mark: Android's \b looked past them, to the letter before.
        assertEquals("x\u200B[token]", Redactor.redact("x\u200B$JWT"))
        assertEquals("x\u200BBearer [credential]", Redactor.redact("x\u200BBearer abcdefghijklmnop"))
        assertEquals("\u200D[card number]", Redactor.redact("\u200D4111111111111111"))
        assertEquals("[email]\u200D", Redactor.redact("jane@example.com\u200D"))
        assertEquals("e\u0301[token]", Redactor.redact("e\u0301$JWT"))
        assertEquals("e\u0301Bearer [credential]", Redactor.redact("e\u0301Bearer abcdefghijklmnop"))
        assertEquals("[email]\u0301", Redactor.redact("jane@example.com\u0301"))
        // A digit of another script: Arabic-Indic, Devanagari, fullwidth. Android's \d took it into the card's digits.
        assertEquals("[card number]\u0663", Redactor.redact("4111111111111111\u0663"))
        assertEquals("\u0967[card number]", Redactor.redact("\u09674111111111111111"))
        assertEquals("[card number]\uFF11\uFF12", Redactor.redact("4111111111111111\uFF11\uFF12"))
        // The long s and the Kelvin sign, which Android's engine reads as s and k under (?i).
        assertEquals("\u017FBearer [credential]", Redactor.redact("\u017FBearer abcdefghijklmnop"))
        assertEquals("\u212Apassword=[redacted]", Redactor.redact("\u212Apassword=hunter2"))
        // A letter outside the basic plane.
        assertEquals("\uD835\uDC9C[token]", Redactor.redact("\uD835\uDC9C$JWT"))
    }

    @Test
    fun `a secret inside a longer ASCII word is still kept`() {
        assertEquals("x4111111111111111", Redactor.redact("x4111111111111111"))
        assertEquals("4111111111111111_", Redactor.redact("4111111111111111_"))
        assertEquals("v1.4111111111111111", Redactor.redact("v1.4111111111111111"))
        assertEquals("4111111111111111.5", Redactor.redact("4111111111111111.5"))
        assertEquals("xBearer abcdefghijklmnop", Redactor.redact("xBearer abcdefghijklmnop"))
        assertEquals("_basic abcdefghijklmnop", Redactor.redact("_basic abcdefghijklmnop"))
        assertEquals("a".repeat(41) + "password=hunter2", Redactor.redact("a".repeat(41) + "password=hunter2"))
        // Glued to an ASCII word on one side, beside another script on the other: still glued.
        assertEquals("卡号4111111111111111x", Redactor.redact("卡号4111111111111111x"))
        assertEquals("x4111111111111111已拒绝", Redactor.redact("x4111111111111111已拒绝"))
    }

    @Test
    fun `a card number beside another number is taken out`() {
        // Its expiry date, an amount or a code after it, one space or dash between.
        assertEquals("[card number] 12/25", Redactor.redact("4111 1111 1111 1111 12/25"))
        assertEquals("card [card number] 123", Redactor.redact("card 4111111111111111 123"))
        assertEquals("有效 [card number] 123元", Redactor.redact("有效 4111111111111111 123元"))
        assertEquals("卡号 [card number] 12月到期", Redactor.redact("卡号 4111 1111 1111 1111 12月到期"))
        assertEquals("[card number]-1号", Redactor.redact("4111-1111-1111-1111-1号"))
        // A number before it.
        assertEquals("1 [card number]", Redactor.redact("1 4111 1111 1111 1111"))
        assertEquals("号12 [card number]", Redactor.redact("号12 4111 1111 1111 1111"))
        assertEquals("订单号1234 [card number]", Redactor.redact("订单号1234 4111 1111 1111 1111"))
        // Two in one run, and a run too long for one.
        assertEquals("[card number] [card number]", Redactor.redact("4111 1111 1111 1111 5500 0000 0000 0004"))
        assertEquals("[card number] 1111 1111", Redactor.redact("4111 1111 1111 1111 1111 1111"))
        // Numbers that hold no card stay, whole.
        assertEquals("1795076857467 1795076857467", Redactor.redact("1795076857467 1795076857467"))
        assertEquals("12 34 56 78 90 12 34", Redactor.redact("12 34 56 78 90 12 34"))
        assertEquals("4111 1111 1111 1112 12/25", Redactor.redact("4111 1111 1111 1112 12/25"))
        assertEquals("only the cards: [card number]", Redactor.redactCards("only the cards: 4111111111111111"))
    }

    @Test
    fun `an e-mail address is taken out`() {
        assertEquals("Receipt sent to [email].", Redactor.redact("Receipt sent to jane.doe+kiosk@example.co.uk."))
        assertEquals("user=[email]", Redactor.redact("user=a@b.io"))
    }

    @Test
    fun `credentials and tokens are taken out, their names kept`() {
        assertEquals("Authorization: Bearer [credential]", Redactor.redact("Authorization: Bearer abcdefghijklmnop"))
        assertEquals("authorization=Basic [credential]", Redactor.redact("authorization=Basic dXNlcjpwYXNzd29yZA=="))
        assertEquals("password=[redacted]&user=7", Redactor.redact("password=hunter2&user=7"))
        assertEquals("{\"api_key\": \"[redacted]\", \"n\": 1}", Redactor.redact("{\"api_key\": \"sk_live_123\", \"n\": 1}"))
        assertEquals("csrf_token: [redacted] next", Redactor.redact("csrf_token: abc123 next"))
        assertEquals("GET /pay?session_id=[redacted]&amount=5", Redactor.redact("GET /pay?session_id=XYZ123&amount=5"))
        assertEquals("pin=[redacted]", Redactor.redact("pin=1234"))
        val jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
        assertEquals("token [token] expired", Redactor.redact("token $jwt expired"))
        assertEquals("id_token=[token]", Redactor.redact("id_token=$jwt"))
    }

    @Test
    fun `a long line costs time in proportion to its length`() {
        // An open repetition before the secret words once backtracked over every position of a long word: minutes for this.
        val pathological: String = "a".repeat(200_000) + " password" + "b".repeat(50_000) + "=x"
        val started: Long = System.nanoTime()
        Redactor.redact(pathological)
        Redactor.redact("1".repeat(200_000))
        Redactor.redact("x@".repeat(100_000))
        // Each of these one-digit groups is a place a card may start, each tried at seven lengths: none is a card.
        assertEquals("3 ".repeat(131_072), Redactor.redact("3 ".repeat(131_072)))
        assertEquals("中4111111111111112".repeat(15_000), Redactor.redact("中4111111111111112".repeat(15_000)))
        assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
    }

    @Test
    fun `every match of a long text is replaced, and the text between them kept`() {
        assertEquals("[card number] x ".repeat(1_000), Redactor.redact("4111111111111111 x ".repeat(1_000)))
        assertEquals("password=[redacted]&".repeat(1_000), Redactor.redact("password=hunter2&".repeat(1_000)))
        assertEquals("Bearer [credential] ".repeat(1_000), Redactor.redact("Bearer abcdefghijklmnop ".repeat(1_000)))
        // Numbers that are no card: each is read, and each is kept.
        assertEquals("1795076857467 ".repeat(1_000), Redactor.redact("1795076857467 ".repeat(1_000)))
        assertEquals(
            "a [card number], password=[redacted]; Bearer [credential] [email] end",
            Redactor.redact("a 4111111111111111, password=hunter2; Bearer abcdefghijklmnop a@b.io end"),
        )
    }

    @Test
    fun `what a crash is read by is kept`() {
        val stack =
            """
            java.lang.IllegalStateException: Printer offline (job 1234, pid 4321)
            	at com.example.kiosk.TokenManager.refresh(TokenManager.kt:42)
            	at com.example.kiosk.MainActivity.onCreate(MainActivity.kt:20)
            	at android.app.Activity.performCreate(Activity.java:8595)
            """.trimIndent()
        assertEquals(stack, Redactor.redact(stack))
        assertEquals("  580  1029 I ActivityManager: Start proc 4321:com.example/u0a190", Redactor.redact("  580  1029 I ActivityManager: Start proc 4321:com.example/u0a190"))
        assertEquals("max_tokens=5 spinner=3 mapping=x", Redactor.redact("max_tokens=5 spinner=3 mapping=x"))
    }

    @Test
    fun `nothing in, nothing out, and a huge text is cut first`() {
        assertEquals("", Redactor.redact(null))
        assertEquals("", Redactor.redact(""))
        assertEquals(Redactor.MAX_LENGTH, Redactor.redact("a".repeat(Redactor.MAX_LENGTH + 10)).length)
    }

    @Test
    fun `a token is taken out where no ASCII word runs into it, and only there`() {
        // After a "-" in a run: the run's text before the token stays.
        assertEquals("trace-[token]", Redactor.redact("trace-$JWT"))
        assertEquals("req a-b-[token].more", Redactor.redact("req a-b-$JWT.more"))
        // From the first place in the run a token may start: the token from there holds the later one.
        assertEquals("x-[token]", Redactor.redact("x-eyJab-$JWT"))
        // Glued to a word, no token starts.
        assertEquals("x$JWT", Redactor.redact("x$JWT"))
        assertEquals("_$JWT", Redactor.redact("_$JWT"))
        assertEquals("9$JWT", Redactor.redact("9$JWT"))
        // Each token of a line, and a token that ends where another run starts.
        assertEquals("[token] [token]", Redactor.redact("$JWT $JWT"))
        assertEquals("a=[token];b=[token]", Redactor.redact("a=$JWT;b=$JWT"))
        // A segment shorter than five characters is no token.
        assertEquals("eyJabcd.efghi.jklmn", Redactor.redact("eyJabcd.efghi.jklmn"))
        assertEquals("[token]", Redactor.redact("eyJabcde.efghi.jklmn"))
        // A letter of another script, a mark or a zero-width space before it is no ASCII word's (#10835).
        for (head in listOf("é", "中", "e\u0301", "x\u200B", "-\u0301", "\u0661", "\uD835\uDC9C", "\u017F", "\u212A")) {
            assertEquals(head, "$head[token]", Redactor.redact("$head$JWT"))
        }
    }

    @Test
    fun `the token pattern takes out exactly the tokens a search from every place outside an ASCII word does`() {
        // Drawn texts, many with a token in them and many nearly, letters, marks and spaces of other scripts among them.
        val random = Random(10786)
        var withToken = 0
        var ascii = 0
        repeat(DRAWN_TEXTS) {
            val text: String = drawnText(random)
            val expected: String = OUTSIDE_A_WORD_TOKEN.replace(text, Redactor.TOKEN)
            if (expected != text) {
                withToken++
            }
            assertEquals(text, expected, Redactor.redactTokens(text))
            if (text.all { it.code < 128 }) {
                // On ASCII text, the same answer as the pattern before #10835: there the JVM's \b is that edge.
                ascii++
                assertEquals(text, WORD_BOUNDARY_TOKEN.replace(text, Redactor.TOKEN), expected)
            } else {
                // Elsewhere, no token it took out is left whole. (In a chain of more than three dotted segments one may now start a
                // segment sooner, after a mark the JVM's \b counted into a word, and end a segment sooner too.)
                val now: List<IntRange> = OUTSIDE_A_WORD_TOKEN.findAll(text).map { it.range }.toList()
                for (match in WORD_BOUNDARY_TOKEN.findAll(text)) {
                    assertTrue(text, now.any { it.first <= match.range.last && it.last >= match.range.first })
                }
            }
        }
        // The draw holds tokens enough, and ASCII texts enough, to mean something.
        assertTrue(withToken > DRAWN_TEXTS / 50)
        assertTrue(ascii > DRAWN_TEXTS / 20)
    }

    @Test
    fun `an ASCII text reads as it did before #10835, and no secret taken out then is kept now`() {
        // Drawn texts with a secret planted between two of what stands beside one in a log line, of any script.
        val random = Random(10835)
        var ascii = 0
        var keptThenTakenOutNow = 0
        repeat(DRAWN_TEXTS) {
            val secret: String = SECRETS[random.nextInt(SECRETS.size)]
            val text: String = neighbours(random) + secret + neighbours(random)
            val now: String = Redactor.redact(text)
            if (text.all { it.code < 128 }) {
                // Every pattern but the card's reads it as before. The card's takes out what it did, and a card beside another number too.
                ascii++
                assertEquals(text, Before10835.redact(text, Redactor::redactCards), now)
            }
            val before: String = Before10835.redact(text)
            if (!before.contains(secret)) {
                assertFalse("$text: $now", now.contains(secret))
            } else if (!now.contains(secret)) {
                keptThenTakenOutNow++
            }
        }
        assertTrue(ascii > DRAWN_TEXTS / 20)
        // The JVM read \w and \b as ASCII before too: what is new here is a card beside another number, and a secret after a combining mark.
        assertTrue(keptThenTakenOutNow > 0)
    }

    @Test
    fun `a long run of a token's characters costs time in proportion to its length`() {
        // Read once more from each "eyJ" after a "-", the first two took ten seconds each at 100 KB (#10786).
        val texts: List<String> =
            listOf(
                "-eyJ-".repeat(40_000),
                "eyJab-".repeat(40_000),
                "eyJ".repeat(80_000),
                "eyJeeeeeeeeee".repeat(15_000),
                "a-".repeat(100_000),
                ("eyJ".repeat(170) + "." + "a".repeat(16_384) + "!").repeat(12),
            )
        val started: Long = System.nanoTime()
        for (text in texts) {
            // No token is whole in any of them.
            assertEquals(text, Redactor.redact(text))
        }
        assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
    }

    @Test
    fun `a token whose segment is a long run is taken out, and so is every token after it`() {
        // Android's regular expressions once ran out of room on a segment this long and found nothing more after it.
        for (segment in 0..2) {
            val parts: MutableList<String> = mutableListOf("eyJ" + "a".repeat(10), "b".repeat(10), "c".repeat(10))
            parts[segment] += "z".repeat(255_000)
            assertEquals("[token] then [token]", Redactor.redact(parts.joinToString(".") + " then $JWT"))
        }
    }

    /*
     * The redactor before #10835, which said "not inside a longer word" with
     * \w, \b and \d: the JVM reads them as ASCII, Android with every script's
     * letters, marks and digits (OnDeviceParsersTest holds the same copy, read
     * there by Android's engine). Its card check took a card-length run of
     * digits whole. It read a digit of another script as a number too ("١" -
     * "0" is 1585), and so passed such a run now and then by chance; here a
     * run that holds one is no card, so that only what it took out for a card
     * counts.
     */
    private object Before10835 {
        private val CARD_CANDIDATE: Regex = Regex("""(?<![\w.])\d(?:[ -]?\d){12,18}(?![\w.])""")
        private val EMAIL_ADDRESS: Regex =
            Regex("""(?<![\w.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![\w-])""")
        private val AUTHORIZATION: Regex = Regex("""(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}""")
        private val SECRET_ASSIGNMENT: Regex =
            Regex(
                """(?i)((?<![\w-])["']?[\w-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?\s{0,8}[:=]\s{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\s,;&)\]\}]+)""",
            )

        // Every stage in Redactor.redact's order; the cards' by [redactCards], its own unless another is given.
        fun redact(text: String, redactCards: (String) -> String = { cards(it) }): String {
            var result: String = WORD_BOUNDARY_TOKEN.replace(text, Redactor.TOKEN)
            result = AUTHORIZATION.replace(result) { match -> "${match.groupValues[1]} ${Redactor.CREDENTIAL}" }
            result =
                SECRET_ASSIGNMENT.replace(result) { match ->
                    val value: String = match.groupValues[2]
                    val isMarker: Boolean = value.startsWith("[") && value.endsWith("]")
                    if (value.isEmpty() || isMarker || value == "\"${Redactor.REDACTED}\"" || value.lowercase() in setOf("bearer", "basic")) {
                        match.value
                    } else {
                        val quote: String = if (value.length >= 2 && (value[0] == '"' || value[0] == '\'')) value[0].toString() else ""
                        "${match.groupValues[1]}$quote${Redactor.REDACTED}$quote"
                    }
                }
            result = EMAIL_ADDRESS.replace(result, Redactor.EMAIL)
            return redactCards(result)
        }

        fun cards(text: String): String =
            CARD_CANDIDATE.replace(text) { match -> if (looksLikeCardNumber(match.value.filter { it.isDigit() })) Redactor.CARD else match.value }

        private fun looksLikeCardNumber(digits: String): Boolean {
            if (digits.length !in 13..19 || digits[0] !in '2'..'6' || digits.any { it !in '0'..'9' }) {
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

    private companion object {
        const val JWT: String = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"

        const val DRAWN_TEXTS: Int = 50_000

        // The token pattern before #10786: tried from every word boundary, it read a long run again from each "eyJ".
        val WORD_BOUNDARY_TOKEN: Regex = Regex("""\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}""")

        // What the token pattern takes out since #10835: a token tried from every place no ASCII word runs into.
        val OUTSIDE_A_WORD_TOKEN: Regex = Regex("""(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}""")

        // A secret of each kind, and what may stand beside one in a log line: ASCII, numbers, and other scripts' letters, marks and digits.
        val SECRETS: List<String> =
            listOf(
                "4111111111111111", "4111 1111 1111 1111", "5500-0000-0000-0004", "378282246310005", "jane@example.com",
                "jane.doe+kiosk@example.co.uk", "Bearer abcdefghijklmnop", "basic dXNlcjpwYXNzd29yZA==", JWT, "password=hunter2",
                "api_key: sk_live_123", "\"token\": \"abc123def\"", "pin=1234",
            )
        val NEIGHBOURS: List<String> =
            listOf(
                "", "", " ", "x", "_", ".", "-", "=", ":", "/", "\"", "12 ", "1234 ", " 12", " 123", " 12/25", "7-", "5", "e", "eyJ",
                "中", "卡号", "已拒绝", "，", "カード", "です", "카드", "رقم",
                "ب", "ключ", "ก", "क", "é", "e\u0301", "\u0301", "\u200B", "x\u200B", "\u200D",
                "\u0661", "\u0967", "\uFF11", "\u017F", "\u212A", "\uD835\uDC9C",
            )

        // Up to two neighbours.
        fun neighbours(random: Random): String = buildString { repeat(1 + random.nextInt(2)) { append(NEIGHBOURS[random.nextInt(NEIGHBOURS.size)]) } }

        // What a text is drawn from: a token's characters, what ends a run, and letters, marks and spaces of other scripts.
        val PIECES: List<String> =
            listOf(
                "eyJ", "eyJ", "eyJ", "-", "-", "-", ".", ".", ".", "e", "y", "J", "a", "Z", "0", "_", " ", "=", ":", "\"", "/",
                "é", "中", "́", "​", "‍", "١", "𝒜", "x", "abcde", "abcde", "12345",
                "-eyJ", "-eyJ", "eyJhbGciOiJIUzI1NiJ9", " ", "\t", "@",
            )
        val TOKEN_PIECES: List<String> = listOf("a", "b", "Z", "0", "_", "-", "-", "eyJ", "eyJ", "e", "J", "y", "abcde")
        val JOINERS: List<String> = listOf(".", ".", ".", ".", ".", "", "-", " ", "é", "́")
        val HEADS: List<String> = listOf("eyJ", "eyJ", "eyJ", "-eyJ", "a-eyJ", "eyJ-", "")

        fun noise(random: Random, most: Int): String = buildString { repeat(random.nextInt(most + 1)) { append(PIECES[random.nextInt(PIECES.size)]) } }

        fun segment(random: Random): String =
            buildString {
                val length: Int = random.nextInt(13)
                while (this.length < length) {
                    append(TOKEN_PIECES[random.nextInt(TOKEN_PIECES.size)])
                }
            }

        // Half drawn piece by piece, half built like a token: a head, and three segments of 0 to 12 characters, joined by dots or not.
        fun drawnText(random: Random): String {
            if (random.nextBoolean()) {
                return noise(random, 40)
            }
            return buildString {
                repeat(1 + random.nextInt(3)) {
                    append(noise(random, 4))
                    append(HEADS[random.nextInt(HEADS.size)])
                    append(segment(random))
                    repeat(2) {
                        append(JOINERS[random.nextInt(JOINERS.size)])
                        append(segment(random))
                    }
                    append(noise(random, 4))
                }
            }
        }
    }
}
