package com.oneuptime.androidagent.logsession

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * The note a log session's requester wrote (#9966), as the device reads it
 * from OneUptime's answer and shows it under the request: one line of plain
 * text, as long as OneUptime keeps one, with nothing that reorders the text
 * around it and nothing a kiosk's screen must not show.
 */
class LogSessionNoteTest {
    @Test
    fun `a note is shown as written`() {
        assertEquals(
            "Checking why the payment app crashes after 6pm",
            LogSessionNote.clean("Checking why the payment app crashes after 6pm"),
        )
        // Any script, as written: a note is never translated.
        assertEquals("Проверяем, почему приложение оплаты падает после 18:00", LogSessionNote.clean("Проверяем, почему приложение оплаты падает после 18:00"))
        assertEquals("بررسی خرابی برنامهٔ پرداخت پس از ساعت ۶ عصر", LogSessionNote.clean("بررسی خرابی برنامهٔ پرداخت پس از ساعت ۶ عصر"))
    }

    @Test
    fun `no note, or only spaces, is none`() {
        assertNull(LogSessionNote.clean(null))
        assertNull(LogSessionNote.clean(""))
        assertNull(LogSessionNote.clean("   \n\t  "))
        assertNull(LogSessionNote.clean("\u0000\u0007"))
    }

    @Test
    fun `it is one line, with breaks, tabs and runs of spaces as one space`() {
        assertEquals("Crashes after 6pm. Ticket 4412.", LogSessionNote.clean("  Crashes after 6pm.\r\n\r\nTicket\t4412.  "))
        assertEquals("a b c", LogSessionNote.clean("a\u2028b\u2029c"))
        assertEquals("a b", LogSessionNote.clean("a\u00A0\u00A0b"))
    }

    @Test
    fun `control characters, and those that reorder the text around them, are left out`() {
        // An override that would turn the words after it round on screen, and an isolate.
        assertEquals("Allow it, it is safe", LogSessionNote.clean("Allow it, \u202Eit is safe\u202C"))
        assertEquals("ab", LogSessionNote.clean("a\u2066\u2069b"))
        assertEquals("ab", LogSessionNote.clean("a\u001Bb"))
        // A next-line character is a line break: one space.
        assertEquals("a b", LogSessionNote.clean("a\u0085b"))
        // Right-to-left text needs none of them: its own letters say which way it reads.
        assertEquals("שלום עולם", LogSessionNote.clean("שלום עולם"))
    }

    @Test
    fun `it is at most as long as OneUptime keeps one, never cutting a character in two`() {
        val long: String = "a".repeat(LogSessionNote.MAX_LENGTH + 50)
        assertEquals(LogSessionNote.MAX_LENGTH, LogSessionNote.clean(long)!!.length)

        // An emoji is two chars in Java and one character: never left half.
        val emoji: String = "😀".repeat(LogSessionNote.MAX_LENGTH + 1)
        val cut: String = LogSessionNote.clean(emoji)!!
        assertEquals(LogSessionNote.MAX_LENGTH, cut.codePointCount(0, cut.length))
        assertTrue(!Character.isHighSurrogate(cut.last()))
    }

    @Test
    fun `what a kiosk's screen must not show is taken out, as in what the agent sends`() {
        assertEquals(
            "Card [card number] declined at 6pm, ask [email]",
            LogSessionNote.clean("Card 4111 1111 1111 1111 declined at 6pm, ask dana@example.com"),
        )
        assertEquals("Retry with password=[redacted] after", LogSessionNote.clean("Retry with password=hunter2 after"))
        assertEquals("Bearer [credential] fails", LogSessionNote.clean("Bearer abcdefgh12345678 fails"))
        // A store's number and a time are not secrets.
        assertEquals("Store 0412, till 3, since 18:05", LogSessionNote.clean("Store 0412, till 3, since 18:05"))
    }
}
