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
    fun `a token is taken out where a word boundary lets one start, and only there`() {
        // After a "-" in a run: the run's text before the token stays.
        assertEquals("trace-[token]", Redactor.redact("trace-$JWT"))
        assertEquals("req a-b-[token].more", Redactor.redact("req a-b-$JWT.more"))
        // From the first place in the run a token may start: the token from there holds the later one.
        assertEquals("x-[token]", Redactor.redact("x-eyJab-$JWT"))
        // Glued to a word, no token starts.
        assertEquals("x$JWT", Redactor.redact("x$JWT"))
        assertEquals("_$JWT", Redactor.redact("_$JWT"))
        // Each token of a line, and a token that ends where another run starts.
        assertEquals("[token] [token]", Redactor.redact("$JWT $JWT"))
        assertEquals("a=[token];b=[token]", Redactor.redact("a=$JWT;b=$JWT"))
        // A segment shorter than five characters is no token.
        assertEquals("eyJabcd.efghi.jklmn", Redactor.redact("eyJabcd.efghi.jklmn"))
        assertEquals("[token]", Redactor.redact("eyJabcde.efghi.jklmn"))
    }

    @Test
    fun `the token pattern takes out exactly the tokens a search from every word boundary did`() {
        // Drawn texts, many with a token in them and many nearly: the same answer as the pattern before #10786.
        val random = Random(10786)
        var withToken = 0
        repeat(DRAWN_TEXTS) {
            val text: String = drawnText(random)
            val expected: String = WORD_BOUNDARY_TOKEN.replace(text, Redactor.TOKEN)
            if (expected != text) {
                withToken++
            }
            assertEquals(text, expected, Redactor.redactTokens(text))
        }
        // The draw holds tokens enough to mean something.
        assertTrue(withToken > DRAWN_TEXTS / 50)
        // Where the two engines' word boundaries part: the same answer as the old pattern on this one.
        for (text in listOf("é$JWT", "中$JWT", "é$JWT", "x​$JWT", "-́$JWT", "١$JWT", "𝒜$JWT")) {
            assertEquals(text, WORD_BOUNDARY_TOKEN.replace(text, Redactor.TOKEN), Redactor.redactTokens(text))
        }
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

    private companion object {
        const val JWT: String = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"

        const val DRAWN_TEXTS: Int = 50_000

        // The token pattern before #10786: tried from every word boundary, it read a long run again from each "eyJ".
        val WORD_BOUNDARY_TOKEN: Regex = Regex("""\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}""")

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
