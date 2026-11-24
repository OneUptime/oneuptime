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

    @Test
    fun `a card number in another script's digits is taken out`() {
        // Japanese text often writes a card number in fullwidth digits, Arabic and Persian text in their own: each was kept (#10877).
        assertEquals("カード番号：[card number]", Redactor.redact("カード番号：４１１１ １１１１ １１１１ １１１１"))
        assertEquals("[card number]", Redactor.redact("٤١١١١١١١١١١١١١١١"))
        assertEquals("شماره کارت [card number] رد شد", Redactor.redact("شماره کارت ۴۱۱۱-۱۱۱۱-۱۱۱۱-۱۱۱۱ رد شد"))
        assertEquals("کارت [card number]", Redactor.redact("کارت ۵۵۰۰ ۰۰۰۰ ۰۰۰۰ ۰۰۰۴"))
        assertEquals("कार्ड [card number] अस्वीकृत", Redactor.redact("कार्ड ४१११ ११११ ११११ ११११ अस्वीकृत"))
        assertEquals("বাতিল [card number]", Redactor.redact("বাতিল ৩৭৮২৮২২৪৬৩১০০০৫"))
        assertEquals("บัตร [card number] ถูกปฏิเสธ", Redactor.redact("บัตร ๔๑๑๑๑๑๑๑๑๑๑๑๑๑๑๑ ถูกปฏิเสธ"))
        assertEquals("ကတ် [card number]", Redactor.redact("ကတ် ၄၁၁၁၁၁၁၁၁၁၁၁၁၁၁၁"))
        assertEquals("កាត [card number]", Redactor.redact("កាត ៥៥០០ ០០០០ ០០០០ ០០០៤"))
        // Right against a letter, as an ASCII card is since #10835.
        assertEquals("卡号[card number]已拒绝", Redactor.redact("卡号４１１１１１１１１１１１１１１１已拒绝"))
        assertEquals("رقم البطاقة[card number]مرفوض", Redactor.redact("رقم البطاقة٤١١١١١١١١١١١١١١١مرفوض"))
    }

    @Test
    fun `a card number is taken out in the digits of each script of the Basic Multilingual Plane`() {
        for (zero in DIGIT_ZEROS) {
            for (card in listOf("4111111111111111", "5500 0000 0000 0004", "6011-1111-1111-1117", "378282246310005")) {
                val written: String = inScript(card, zero)
                assertEquals(written, "Card [card number] declined", Redactor.redact("Card $written declined"))
                assertEquals(written, "卡号[card number]已拒绝", Redactor.redact("卡号${written}已拒绝"))
            }
            // A number in the same digits that fails the Luhn check, or starts as a timestamp does, stays.
            for (number in listOf("4111111111111112", "1795076857467")) {
                assertEquals(inScript(number, zero), Redactor.redact(inScript(number, zero)))
            }
        }
    }

    @Test
    fun `the decimal digits of the Basic Multilingual Plane are 37 scripts' ten, each read by its value`() {
        // What Character.digit reads on the JVM, and on a device (OnDeviceParsersTest): none has changed since Unicode 7.
        val digits: List<Int> = (0..0xFFFF).filter { Character.digit(it.toChar(), 10) >= 0 }
        assertEquals(DIGIT_ZEROS.flatMap { zero -> zero..zero + 9 }, digits)
        for (code in 0..0xFFFF) {
            val char: Char = code.toChar()
            if (char.isSurrogate()) {
                continue
            }
            // Fifteen digits and a last one: a card when the last reads as 1, whatever its script.
            assertEquals("U+%04X".format(code), Character.digit(char, 10) == 1, Redactor.looksLikeCardNumber("411111111111111$char"))
        }
    }

    @Test
    fun `a number in another script's digits that is no card is kept`() {
        for (text in listOf(
            // It fails the Luhn check, starts as a timestamp does, or is too short.
            "٤١١١١١١١١١١١١١١٢", "١٧٩٥٠٧٦٨٥٧٤٦٧", "٤١١١١١١١١١١١",
            // A digit of its own script beside it: a longer number.
            "٤١١١١١١١١١١١١١١١١١١١١", "٤١١١١١١١١١١١١١١١٤", "١٤١١١١١١١١١١١١١١١",
            // An ASCII letter, "_" or "." beside it: a word, or a decimal.
            "x٤١١١١١١١١١١١١١١١", "٤١١١١١١١١١١١١١١١x", "_٤١١١١١١١١١١١١١١١", "v1.٤١١١١١١١١١١١١١١١", "٤١١١١١١١١١١١١١١١.٥",
        )) {
            assertEquals(text, Redactor.redact(text))
        }
    }

    @Test
    fun `a digit of another script beside a card is no part of it, and a card in mixed digits is read whole`() {
        // A card is looked for in one script's digits first, as an ASCII card was (#10835).
        assertEquals("[card number]１２", Redactor.redact("4111111111111111１２"))
        assertEquals("１２[card number]", Redactor.redact("１２4111111111111111"))
        assertEquals("[card number]12", Redactor.redact("٤١١١١١١١١١١١١١١١12"))
        assertEquals("12[card number]", Redactor.redact("12٤١١١١١١١١١١١١١١١"))
        assertEquals("[card number]٣", Redactor.redact("４１１１１１１１１１１１１１１１٣"))
        assertEquals("٣[card number]", Redactor.redact("٣4111111111111111"))
        assertEquals("[card number] ١٢/٢٥", Redactor.redact("4111111111111111 ١٢/٢٥"))
        // Then, among the digits left, a number that mixes scripts: a Persian card typed with Arabic-Indic digits among its own.
        assertEquals("[card number]", Redactor.redact("４１１１ 1111 1111 1111"))
        assertEquals("[card number]", Redactor.redact("4111 1111 1111 ١١١١"))
        assertEquals("[card number]", Redactor.redact("۴۱۱۱١١١١۱۱۱۱١١١١"))
        assertEquals("[card number]", Redactor.redact("۴١۱١۱١۱١۱١۱١۱١۱١"))
        assertEquals("[card number]", Redactor.redact("۵۵۰۰-٠٠٠٠-۰۰۰۰-٠٠٠٤"))
        // Read whole, a mixed number with more digits is a longer one, and no card.
        assertEquals("١٢4111 1111 1111 ١١١١", Redactor.redact("١٢4111 1111 1111 ١١١١"))
    }

    @Test
    fun `a card number in another script's digits beside another number is taken out`() {
        assertEquals("[card number] ١٢/٢٥", Redactor.redact("٤١١١ ١١١١ ١١١١ ١١١١ ١٢/٢٥"))
        assertEquals("[card number] １２３", Redactor.redact("４１１１ １１１１ １１１１ １１１１ １２３"))
        assertEquals("１ [card number]", Redactor.redact("１ ４１１１ １１１１ １１１１ １１１１"))
        assertEquals("[card number] [card number]", Redactor.redact("٤١١١ ١١١١ ١١١١ ١١١١ ٥٥٠٠ ٠٠٠٠ ٠٠٠٠ ٠٠٠٤"))
        assertEquals("[card number] ١١١١ ١١١١", Redactor.redact("٤١١١ ١١١١ ١١١١ ١١١١ ١١١١ ١١١١"))
    }

    @Test
    fun `a digit beyond the Basic Multilingual Plane is no card's`() {
        // Adlam's and the mathematical bold digits stay as they were, and an ASCII card beside one is taken out.
        val adlam: String = "\uD83A\uDD54" + "\uD83A\uDD51".repeat(15)
        val bold: String = "\uD835\uDFD2" + "\uD835\uDFCF".repeat(15)
        assertEquals(adlam, Redactor.redact(adlam))
        assertEquals(bold, Redactor.redact(bold))
        assertEquals("[card number]\uD83A\uDD51", Redactor.redact("4111111111111111\uD83A\uDD51"))
        assertEquals("\uD83A\uDD51[card number]", Redactor.redact("\uD83A\uDD514111111111111111"))
    }

    @Test
    fun `an address in any script is taken out whole`() {
        // Each was kept, whole or in part, on every engine (#10878).
        for (address in listOf(
            "张伟@example.com", "josé@example.com", "josé.garcia@example.com", "müller@bücher.de", "user@例え.jp", "user@xn--r8jz45g.jp",
            "почта@пример.рф", "user@xn--e1afmkfd.xn--p1ai", "山田たろう@例え.jp", "δοκιμή@παράδειγμα.δοκιμή", "उपयोगकर्ता@उदाहरण.भारत",
            "用户123@example.com", "jose\u0301@example.com", "ｊａｎｅ@example.com",
        )) {
            assertEquals(address, "[email]", Redactor.redact(address))
            assertEquals(address, "Receipt sent to [email], thanks", Redactor.redact("Receipt sent to $address, thanks"))
        }
        // Whole: the name's first part was kept.
        assertEquals("Écrire à [email]", Redactor.redact("Écrire à françois.dupont@exemple.fr"))
        assertEquals("Отправлено на [email].", Redactor.redact("Отправлено на почта@пример.рф."))
    }

    @Test
    fun `a domain is taken out in its Unicode form and in punycode alike`() {
        for ((unicode, punycode) in listOf("例え.jp" to "xn--r8jz45g.jp", "пример.рф" to "xn--e1afmkfd.xn--p1ai", "bücher.de" to "xn--bcher-kva.de")) {
            for (name in listOf("user", "张伟", "josé")) {
                assertEquals("[email]", Redactor.redact("$name@$unicode"))
                assertEquals("[email]", Redactor.redact("$name@$punycode"))
            }
        }
    }

    @Test
    fun `a letter of another script beside an address is still no part of it`() {
        assertEquals("邮箱[email]", Redactor.redact("邮箱jane@example.com"))
        assertEquals("Email[email]", Redactor.redact("Email张伟@example.com"))
        assertEquals("[email]已发送", Redactor.redact("张伟@example.com已发送"))
        assertEquals("[email]に送信", Redactor.redact("用户@例え.jpに送信"))
        assertEquals("[email]으로", Redactor.redact("이메일张伟@example.com으로"))
        // A name in the script of the word before it cannot be told from that word, and a top-level domain in another script
        // takes in the letters of its script written after it: more is taken out, not less.
        assertEquals("[email]", Redactor.redact("邮件张伟@example.com"))
        assertEquals("[email]", Redactor.redact("jane@例子.中国已发送"))
    }

    @Test
    fun `what is no address in any script is kept`() {
        // No top-level domain, one of a letter, punycode with no letter, and an ASCII "_" or digit right after it.
        for (text in listOf("张伟@localhost", "张伟@例え", "user@例え.j", "user@example.xn--4111", "张伟@example.com_x", "张伟@example.com7")) {
            assertEquals(text, Redactor.redact(text))
        }
    }

    @Test
    fun `an address beside a card takes no part of it`() {
        // A card's last group is no address's name, nor its first group an address's top-level domain.
        assertEquals("[card number]é@例え.jp", Redactor.redact("4111 1111 1111 1111é@例え.jp"))
        assertEquals("[card number] [email]", Redactor.redact("4111 1111 1111 1111 user@例え.jp"))
        assertEquals("x@x.xn--[card number]", Redactor.redact("x@x.xn--4111 1111 1111 1111"))
        // A card in an address's name goes with the address.
        assertEquals("[email]", Redactor.redact("٤١١١١١١١١١١١١١١١@example.com"))
        // An ASCII address takes a card's last group as it did, and two addresses written as one are taken out whole.
        assertEquals("4111 1111 1111 [email]", Redactor.redact("4111 1111 1111 1111@example.com"))
        assertEquals("[email]", Redactor.redact("中@x.jane@example.com"))
    }

    @Test
    fun `a space is one of the characters Android's backslash-s takes, here as on a device`() {
        // The JVM's \s took six of them, so these were kept here and taken out on a device (#10876).
        assertEquals("令牌：Bearer [credential]", Redactor.redact("令牌：Bearer\u3000abcdefghijklmnop"))
        assertEquals("password=[redacted]\u3000次の", Redactor.redact("password=hunter2\u3000次の"))
        for (space in ANDROID_SPACES) {
            val name: String = "U+%04X".format(space.code)
            assertEquals(name, "Bearer [credential]", Redactor.redact("Bearer${space}abcdefghijklmnop"))
            assertEquals(name, "password$space=$space[redacted]", Redactor.redact("password$space=${space}hunter2"))
            assertEquals(name, "password=[redacted]${space}next", Redactor.redact("password=hunter2${space}next"))
        }
        // None of these: the zero-width no-break space JavaScript's \s takes, a zero-width space, the Mongolian vowel
        // separator, and controls the JVM calls white space. A value runs on through each.
        for (other in listOf('\uFEFF', '\u200B', '\u180E', '\u001C', '\u001F', '\u0000')) {
            val name: String = "U+%04X".format(other.code)
            assertEquals(name, "Bearer${other}abcdefghijklmnop", Redactor.redact("Bearer${other}abcdefghijklmnop"))
            assertEquals(name, "password=[redacted]", Redactor.redact("password=hun${other}ter2"))
        }
    }

    @Test
    fun `a space is exactly one of the characters Android's backslash-s takes, and no other`() {
        for (code in 0..0xFFFF) {
            val char: Char = code.toChar()
            if (char.isSurrogate()) {
                continue
            }
            val taken: Boolean = Redactor.redact("Bearer${char}abcdefghijklmnop") == "Bearer [credential]"
            assertEquals("U+%04X".format(code), char in ANDROID_SPACES, taken)
        }
    }

    @Test
    fun `no secret the redactor took out before is kept, and an ASCII text reads as it did`() {
        // Drawn texts with a secret planted between neighbours of any script: #10835's, and cards, addresses and spaces of other scripts.
        val random = Random(10877)
        var ascii = 0
        var newlyTakenOut = 0
        repeat(DRAWN_TEXTS) { index ->
            // A third of them ASCII alone.
            val asciiOnly: Boolean = index % 3 == 0
            val secrets: List<String> = if (asciiOnly) ASCII_MORE_SECRETS else MORE_SECRETS
            val secret: String = secrets[random.nextInt(secrets.size)]
            val text: String = moreNeighbours(random, asciiOnly) + secret + moreNeighbours(random, asciiOnly)
            val now: String = Redactor.redact(text)
            val before: String = Before10876.redact(text)
            // On ASCII text, as before: but for an address in a punycode top-level domain, and two addresses written as one, now taken out.
            if (text.all { it.code < 128 } && !PUNYCODE_TOP_LEVEL_DOMAIN.containsMatchIn(text) && text.count { it == '@' } < 2) {
                ascii++
                assertEquals(text, before, now)
            }
            if (!before.contains(secret)) {
                assertFalse("$text: $now", now.contains(secret))
            } else if (!now.contains(secret)) {
                newlyTakenOut++
            }
        }
        assertTrue("$ascii ASCII texts", ascii > DRAWN_TEXTS / 5)
        assertTrue("$newlyTakenOut newly taken out", newlyTakenOut > DRAWN_TEXTS / 10)
    }

    @Test
    fun `a long run of another script's digits costs time in proportion to its length`() {
        val texts: List<Pair<String, String?>> =
            listOf(
                // Each digit a place a card may start, inside a longer number of its own script. (Half of the longest text: the
                // JVM's engine reads each place more slowly than Android's, and OnDeviceParsersTest times them at full length.)
                "٣".repeat(131_000) to null,
                // Each a one-digit group, tried at seven lengths; scripts that change at each digit.
                "٣ ".repeat(65_000) to null,
                "4٣".repeat(65_000) to null,
                "１ ٣-".repeat(32_000) to null,
                "٤١١١١١١١١١١١١١١٢ ".repeat(7_000) to null,
                "٤١١١١١١١١١١١١١١١ ".repeat(7_000) to "[card number] ".repeat(7_000),
            )
        val started: Long = System.nanoTime()
        for ((text, expected) in texts) {
            assertEquals(expected ?: text, Redactor.redact(text))
        }
        assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
    }

    @Test
    fun `a long run of an address's characters, or of spaces, costs time in proportion to its length`() {
        val texts: List<Pair<String, String?>> =
            listOf(
                // A name that runs on too long before its "@".
                "٣".repeat(262_000) + "@example.com" to null,
                // Names and top-level domains in other scripts, and a long run of Latin letters before an "@". (Not a domain of
                // thousands of labels: the JVM's regular expressions recurse once for each, and overflow a test thread's stack
                // from 5,000 on, as they did for the ASCII address alone. Android's do not: OnDeviceParsersTest times it.)
                "张@".repeat(131_000) to null,
                "é".repeat(262_000) + "@example.com" to null,
                "a@" + "例.".repeat(1_000) to null,
                "中".repeat(262_000) + "@x.中国" to null,
                // A run of spaces between a scheme and no credential.
                "Bearer" + "\u3000".repeat(262_000) + "x" to null,
            )
        val started: Long = System.nanoTime()
        for ((text, expected) in texts) {
            assertEquals(expected ?: text, Redactor.redact(text))
        }
        assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
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

    /*
     * The redactor before #10876, #10877 and #10878, as a device read it. Its
     * \s was Android's, written out here as the redactor writes it now
     * (OnDeviceParsersTest holds it as it was written, which Android's engine
     * reads so), so its credentials and secrets read as they do now. Its
     * cards were ASCII digits alone, and its addresses ASCII.
     */
    private object Before10876 {
        private const val SPACE: String = """\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000"""
        private val CARD_START: Regex = Regex("""(?<![A-Za-z0-9_.])(?=([2-6](?:[ -]?[0-9]){12,18})(?![A-Za-z0-9_.]))""")
        private val EMAIL_ADDRESS: Regex =
            Regex("""(?<![A-Za-z0-9_.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9_-])""")
        private val AUTHORIZATION: Regex = Regex("""(?<![A-Za-z0-9_])(?i)(bearer|basic)[$SPACE]+[A-Za-z0-9._~+/=-]{8,}""")
        private val SECRET_ASSIGNMENT: Regex =
            Regex(
                """(?<![A-Za-z0-9_-])(?i)(["']?[A-Za-z0-9_-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?[$SPACE]{0,8}[:=][$SPACE]{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^$SPACE,;&)\]\}]+)""",
            )

        // Every stage in Redactor.redact's order.
        fun redact(text: String): String {
            var result: String = Redactor.redactTokens(text)
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
            return cards(result)
        }

        // At each place a card may start, the longest card from there that ends at the run's end or before a space or dash.
        private fun cards(text: String): String {
            val result = StringBuilder()
            var last = 0
            for (match in CARD_START.findAll(text)) {
                val start: Int = match.range.first
                if (start < last) {
                    continue
                }
                val length: Int = cardLength(match.groupValues[1])
                if (length > 0) {
                    result.append(text, last, start).append(Redactor.CARD)
                    last = start + length
                }
            }
            return result.append(text, last, text.length).toString()
        }

        private fun cardLength(run: String): Int {
            val digits: String = run.filter { it in '0'..'9' }
            var end: Int = run.length
            var count: Int = digits.length
            while (count >= 13) {
                if (looksLikeCardNumber(digits.substring(0, count))) {
                    return end
                }
                val separator: Int = run.lastIndexOfAny(charArrayOf(' ', '-'), end - 1)
                if (separator < 0) {
                    return 0
                }
                count -= end - separator - 1
                end = separator
            }
            return 0
        }

        private fun looksLikeCardNumber(digits: String): Boolean {
            if (digits.length !in 13..19 || digits[0] !in '2'..'6') {
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

        // The first of each script's ten decimal digits in Unicode's Basic Multilingual Plane, as the redactor reads them.
        val DIGIT_ZEROS: List<Int> =
            listOf(
                0x0030, 0x0660, 0x06F0, 0x07C0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0DE6, 0x0E50,
                0x0ED0, 0x0F20, 0x1040, 0x1090, 0x17E0, 0x1810, 0x1946, 0x19D0, 0x1A80, 0x1A90, 0x1B50, 0x1BB0, 0x1C40, 0x1C50, 0xA620,
                0xA8D0, 0xA900, 0xA9D0, 0xA9F0, 0xAA50, 0xABF0, 0xFF10,
            )

        // The characters Android's \s takes (ICU's), which the redactor writes out.
        val ANDROID_SPACES: Set<Char> =
            ("\t\n\u000B\u000C\r \u0085\u00A0\u1680\u2028\u2029\u202F\u205F\u3000" + ('\u2000'..'\u200A').joinToString("")).toSet()

        // ASCII digits, and the spaces and dashes between them, written in the script whose zero is [zero].
        fun inScript(digits: String, zero: Int): String = digits.map { if (it in '0'..'9') (zero + (it - '0')).toChar() else it }.joinToString("")

        // An address whose top-level domain is punycode, which the redactor takes out now, and did not.
        val PUNYCODE_TOP_LEVEL_DOMAIN: Regex = Regex("""@[A-Za-z0-9.-]*\.[Xx][Nn]--""")

        // #10835's secrets, and cards in other scripts' digits, addresses in other scripts, and credentials and secrets with other spaces.
        val MORE_SECRETS: List<String> =
            SECRETS +
                listOf(
                    inScript("4111 1111 1111 1111", 0xFF10), inScript("4111111111111111", 0x0660), inScript("5500-0000-0000-0004", 0x06F0),
                    inScript("378282246310005", 0x09E6), inScript("4111111111111111", 0x0E50), "４１１１ 1111 1111 1111", "۴۱۱۱١١١١۱۱۱۱١١١١",
                    "张伟@example.com", "josé.garcia@example.com", "user@例え.jp", "user@xn--r8jz45g.jp", "почта@пример.рф",
                    "user@xn--e1afmkfd.xn--p1ai", "Bearer\u3000abcdefghijklmnop", "basic\u00A0dXNlcjpwYXNzd29yZA==", "password\u3000=\u3000hunter2",
                )

        // And what may stand beside them: other scripts' digits, an "@" or a domain, and spaces Android's \s takes or not.
        val MORE_NEIGHBOURS: List<String> =
            NEIGHBOURS +
                listOf(
                    "\u0664", "\u06F4", "\u096A", "\uFF14", " \u0661\u0662", "\uFF11\uFF12 ", "4", "@", "中@", "@例え.jp", ".中国", "例え", "xn--",
                    ".com", "\u3000", "\u00A0", "\u0085", "\uFEFF", "\u2003", "ü", "Ж",
                )

        val ASCII_MORE_SECRETS: List<String> = MORE_SECRETS.filter { secret -> secret.all { it.code < 128 } }
        val ASCII_MORE_NEIGHBOURS: List<String> = MORE_NEIGHBOURS.filter { neighbour -> neighbour.all { it.code < 128 } }

        // One or two neighbours, of any script or ASCII alone.
        fun moreNeighbours(random: Random, asciiOnly: Boolean): String {
            val neighbours: List<String> = if (asciiOnly) ASCII_MORE_NEIGHBOURS else MORE_NEIGHBOURS
            return buildString { repeat(1 + random.nextInt(2)) { append(neighbours[random.nextInt(neighbours.size)]) } }
        }

    }
}
