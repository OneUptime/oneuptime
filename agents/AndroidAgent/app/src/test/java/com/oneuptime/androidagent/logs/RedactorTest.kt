package com.oneuptime.androidagent.logs

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
}
