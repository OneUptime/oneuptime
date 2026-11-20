package com.oneuptime.androidagent.ui

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oneuptime.androidagent.agent.ContextStrings
import com.oneuptime.androidagent.agent.StringSource
import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.logsession.LogSessionRequest
import com.oneuptime.androidagent.logsession.LogSessionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/*
 * What the person at the device reads of a log session request (#9966): who
 * asks, for how long and at what level, and the requester's note, quoted
 * the way the device's language quotes - the note itself as written, in
 * whatever language they wrote it.
 */
@RunWith(AndroidJUnit4::class)
class LogSessionTextTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val strings: StringSource get() = ContextStrings(context)

    private fun request(
        note: String? = "Checking why the payment app crashes after 6pm",
        requestedBy: String? = "Dana Reyes",
    ): LogSessionRequest =
        LogSessionRequest(
            id = "s1",
            status = LogSessionStatus.AWAITING_APPROVAL,
            durationMinutes = 30,
            minimumLevel = LogcatLevel.INFO,
            requestedAtMillis = null,
            requestedBy = requestedBy,
            expiresAtMillis = null,
            note = note,
        )

    @Test
    fun `the note is quoted under the request, as written`() {
        assertEquals("“Checking why the payment app crashes after 6pm”", LogSessionText.noteLine(strings, request()))
    }

    @Test
    fun `no note, or an empty one, is no line`() {
        assertNull(LogSessionText.noteLine(strings, request(note = null)))
        assertNull(LogSessionText.noteLine(strings, request(note = "   ")))
    }

    @Test
    fun `the notification says who asks, then their note on a line of its own`() {
        assertEquals(
            "Dana Reyes asks, in OneUptime, for every app's logs on this device for 30 minutes, at Info and above.\n" +
                "“Checking why the payment app crashes after 6pm”",
            LogSessionText.notificationText(strings, request()),
        )
        // Without a note it is the request alone, as before notes.
        assertEquals(
            "Dana Reyes asks, in OneUptime, for every app's logs on this device for 30 minutes, at Info and above.",
            LogSessionText.notificationText(strings, request(note = null)),
        )
        // Without a name, OneUptime asks.
        assertEquals(
            "OneUptime asks for every app's logs on this device for 30 minutes, at Info and above.\n" +
                "“Checking why the payment app crashes after 6pm”",
            LogSessionText.notificationText(strings, request(requestedBy = null)),
        )
    }

    @Test
    @Config(qualifiers = "de")
    fun `German quotes it as German does, and leaves the note as written`() {
        assertEquals("„Checking why the payment app crashes after 6pm“", LogSessionText.noteLine(strings, request()))
    }

    @Test
    @Config(qualifiers = "fr")
    fun `French sets its quotes apart with no-break spaces`() {
        assertEquals("«\u00A0Checking why the payment app crashes after 6pm\u00A0»", LogSessionText.noteLine(strings, request()))
    }

    @Test
    @Config(qualifiers = "ja")
    fun `Japanese quotes it in corner brackets`() {
        assertEquals("「支払いアプリが18時以降に落ちる原因を調査中」", LogSessionText.noteLine(strings, request(note = "支払いアプリが18時以降に落ちる原因を調査中")))
    }

    @Test
    @Config(qualifiers = "fa")
    fun `Persian quotes it in guillemets, and the request reads in Persian around it`() {
        val note = "بررسی خرابی برنامهٔ پرداخت"
        assertEquals("«$note»", LogSessionText.noteLine(strings, request(note = note)))
        val text: String = LogSessionText.notificationText(strings, request(note = note))
        assertEquals("«$note»", text.lines().last())
        assertEquals(2, text.lines().size)
    }
}
