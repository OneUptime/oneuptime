package com.oneuptime.androidagent

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oneuptime.androidagent.collect.BootIdParser
import com.oneuptime.androidagent.collect.CpuStatParser
import com.oneuptime.androidagent.collect.LoadAverageParser
import com.oneuptime.androidagent.collect.MemInfoParser
import com.oneuptime.androidagent.collect.MountsParser
import com.oneuptime.androidagent.config.EndpointParser
import com.oneuptime.androidagent.config.EndpointResult
import com.oneuptime.androidagent.config.LabelParser
import com.oneuptime.androidagent.config.ManagedConfigParser
import com.oneuptime.androidagent.config.ManagedSettings
import com.oneuptime.androidagent.device.DefaultDeviceName
import com.oneuptime.androidagent.dropbox.DropBoxDecoder
import com.oneuptime.androidagent.dropbox.DropBoxEntry
import com.oneuptime.androidagent.dropbox.DropBoxFinding
import com.oneuptime.androidagent.dropbox.NativeFrameParser
import com.oneuptime.androidagent.dropbox.ThreadTraceParser
import com.oneuptime.androidagent.logs.LogcatLineParser
import com.oneuptime.androidagent.logs.LogcatParse
import com.oneuptime.androidagent.logs.LogcatUid
import com.oneuptime.androidagent.logs.Redactor
import java.util.Random
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/*
 * The JVM runs the unit tests with its own regular expressions; a device
 * runs the agent with ICU's, which refuses some patterns the JVM accepts (a
 * bare "}" crashed the first build at launch). Every parser runs here once,
 * on the device, so no pattern can pass the unit tests and fail on Android.
 */
@RunWith(AndroidJUnit4::class)
class OnDeviceParsersTest {
    @Test
    fun managedConfigurationParsesOnAndroid() {
        val settings: ManagedSettings =
            ManagedConfigParser.parse(mapOf("device_name" to "\${esper.deviceName}", "labels" to "store=0412", "logcat_min_level" to "info"))

        assertNull(settings.deviceName)
        assertEquals(mapOf("store" to "0412"), settings.labels)
        assertEquals(1, settings.problems.size)
    }

    @Test
    fun endpointsAndLabelsParseOnAndroid() {
        assertEquals(
            "https://oneuptime.com/otlp",
            (EndpointParser.parse("https://oneuptime.com/otlp/v1/metrics") as EndpointResult.Valid).endpoint.base,
        )
        assertEquals(listOf("bad name=1"), LabelParser.parse("ok=1, bad name=1").rejected)
        assertEquals("elo-i3-15", DefaultDeviceName.of(com.oneuptime.androidagent.device.DeviceFacts("Elo", "Elo i3 15", "14", 34, "B", "D", null, null, emptyList(), null, 4)))
    }

    @Test
    fun logcatLinesParseOnAndroid() {
        val zone: TimeZone = TimeZone.getTimeZone("UTC")
        val now = 1_795_076_900_000L

        assertTrue(LogcatLineParser.parse("         1795076845.947  root   380   439 I netd    : tetherGetStats()", now, zone) is LogcatParse.Entry)
        assertTrue(LogcatLineParser.parse("1795076845.927   580   974 W OomAdjuster: Not killing", now, zone) is LogcatParse.Entry)
        assertTrue(LogcatLineParser.parse("11-19 08:27:37.467  1000   580  1029 E ActivityManager: ANR", now, zone) is LogcatParse.Entry)
        assertEquals(LogcatParse.Divider("events"), LogcatLineParser.parse("--------- beginning of events", now, zone))
        assertEquals(10143, LogcatUid.appUid("u0_a143"))
    }

    @Test
    fun dropBoxEntriesDecodeOnAndroid() {
        val crash: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "data_app_crash",
                    0L,
                    "Process: com.example.kiosk\nPID: 4321\nPackage: com.example.kiosk v42 (4.2.0)\nForeground: Yes\n\n" +
                        "java.lang.IllegalStateException: Card 4111111111111111 declined\n" +
                        "\tat com.example.kiosk.PaymentFlow.charge(PaymentFlow.kt:88)\n",
                ),
                0L,
            )
        val anr: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "data_app_anr",
                    0L,
                    "Process: com.example.kiosk\nPID: 4321\nSubject: Input dispatching timed out\n\n" +
                        "\"main\" prio=5 tid=1 Sleeping\n  at com.example.kiosk.MainActivity.onClick(MainActivity.kt:42)\n\n",
                ),
                0L,
            )
        val native: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "data_app_native_crash",
                    0L,
                    "Process: com.example.kiosk\nPID: 4321\n\n*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n" +
                        "pid: 4321, tid: 4350, name: PrinterThread  >>> com.example.kiosk <<<\n" +
                        "signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000010\n" +
                        "backtrace:\n" +
                        "      #00 pc 000000000005a4c4  /data/app/~~Zh3x==/com.example.kiosk-Ab1==/lib/x86_64/libprinter.so (print_job(Job*)+52) (BuildId: 1a2b3c)\n",
                ),
                0L,
            )
        val tombstone: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "SYSTEM_TOMBSTONE",
                    0L,
                    "isPrevious: true\n\n*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n" +
                        "pid: 812, tid: 812, name: printer-service  >>> /vendor/bin/hw/android.hardware.printer-service <<<\n" +
                        "signal 6 (SIGABRT), code -1 (SI_QUEUE), fault addr --------\n" +
                        "Abort message: 'Check failed: fd >= 0'\n" +
                        "backtrace:\n" +
                        "      #00 pc 0000000000068c4f  /apex/com.android.runtime/lib64/bionic/libc.so (abort+191) (BuildId: aa)\n" +
                        "      #01 pc 0000000000012345  /vendor/lib64/libprinterhal.so (PrinterHal::open()+77) (BuildId: bb)\n",
                ),
                0L,
            )
        val boot: DropBoxFinding? =
            DropBoxDecoder.decode(
                DropBoxEntry(
                    "SYSTEM_LAST_KMSG",
                    0L,
                    "isPrevious: true\n\n[[TRUNCATED]]\n" +
                        "[ 8812.200100] Kernel panic - not syncing: Fatal exception in interrupt\n\n" +
                        "Boot info:\nLast boot reason: kernel_panic\n",
                ),
                0L,
            )

        assertTrue(crash is DropBoxFinding.Fault)
        assertTrue(anr is DropBoxFinding.Fault)
        assertEquals(4321L, (native as DropBoxFinding.Fault).nativeCrashPid)
        assertTrue(tombstone is DropBoxFinding.Fault)
        assertEquals("kernel_panic", (boot as DropBoxFinding.Boot).kernelLog!!.bootReason)
        assertEquals("libprinter.so", NativeFrameParser.parse("      #00 pc 000000000005a4c4  /data/app/x/lib/x86_64/libprinter.so (f+52) (BuildId: 1a)")!!.libraryName)
    }

    @Test
    fun secretsAreRedactedOnAndroid() {
        assertEquals("Declined [card number] for [email]", Redactor.redact("Declined 4111111111111111 for jane@example.com"))
        assertEquals("Authorization: Bearer [credential]", Redactor.redact("Authorization: Bearer abcdefghijklmnop"))
        assertEquals("password=[redacted]&user=7", Redactor.redact("password=hunter2&user=7"))
        assertEquals("order 4111111111111112", Redactor.redact("order 4111111111111112"))
    }

    /*
     * A secret written right against a letter, a mark or a digit of another
     * script, as Chinese and Japanese text runs its words together. Android's
     * \w, \b and \d count every script's letters, marks and digits, so the
     * patterns that said them kept each of these on the device alone, while
     * the JVM's unit tests took them out (#10835).
     */
    @Test
    fun secretsBesideAnotherScriptAreRedactedOnAndroid() {
        assertEquals("支付失败，卡号[card number]", Redactor.redact("支付失败，卡号4111111111111111"))
        assertEquals("[card number]已拒绝", Redactor.redact("4111111111111111已拒绝"))
        assertEquals("邮箱[email]", Redactor.redact("邮箱jane@example.com"))
        assertEquals("[email]已发送", Redactor.redact("jane@example.com已发送"))
        assertEquals("令牌Bearer [credential]", Redactor.redact("令牌Bearer abcdefghijklmnop"))
        assertEquals("令牌[token]", Redactor.redact("令牌$JWT"))
        assertEquals("用户password=[redacted]", Redactor.redact("用户password=hunter2"))
        assertEquals("中".repeat(41) + "password=[redacted]", Redactor.redact("中".repeat(41) + "password=hunter2"))
        assertEquals("カード番号[card number]です", Redactor.redact("カード番号4111 1111 1111 1111です"))
        assertEquals("トークン[token]を送信", Redactor.redact("トークン${JWT}を送信"))
        assertEquals("카드번호[card number]승인거절", Redactor.redact("카드번호4111111111111111승인거절"))
        assertEquals("이메일[email]으로", Redactor.redact("이메일jane@example.com으로"))
        assertEquals("البريد[email]", Redactor.redact("البريدjane@example.com"))
        assertEquals("номер[card number]отклонён", Redactor.redact("номер4111111111111111отклонён"))
        assertEquals("ключBasic [credential]", Redactor.redact("ключBasic dXNlcjpwYXNzd29yZA=="))
        assertEquals("บ\u0E31ตร[card number]", Redactor.redact("บ\u0E31ตร378282246310005"))
        // A zero-width space, a joiner and a combining mark, which Android's \b looked past, and digits of other scripts.
        assertEquals("x\u200B[token]", Redactor.redact("x\u200B$JWT"))
        assertEquals("x\u200BBearer [credential]", Redactor.redact("x\u200BBearer abcdefghijklmnop"))
        assertEquals("\u200D[card number]", Redactor.redact("\u200D4111111111111111"))
        assertEquals("e\u0301[token]", Redactor.redact("e\u0301$JWT"))
        assertEquals("[email]\u0301", Redactor.redact("jane@example.com\u0301"))
        assertEquals("[card number]\u0663", Redactor.redact("4111111111111111\u0663"))
        assertEquals("\u0967[card number]", Redactor.redact("\u09674111111111111111"))
        assertEquals("[card number]\uFF11\uFF12", Redactor.redact("4111111111111111\uFF11\uFF12"))
        // The long s and the Kelvin sign, which Android's engine folds into s and k under (?i).
        assertEquals("\u017FBearer [credential]", Redactor.redact("\u017FBearer abcdefghijklmnop"))
        assertEquals("\u212Apassword=[redacted]", Redactor.redact("\u212Apassword=hunter2"))
        // Inside an ASCII word, kept still.
        assertEquals("x4111111111111111已拒绝", Redactor.redact("x4111111111111111已拒绝"))
        assertEquals("卡号4111111111111111x", Redactor.redact("卡号4111111111111111x"))
        assertEquals("xBearer abcdefghijklmnop", Redactor.redact("xBearer abcdefghijklmnop"))
        // A card beside another number, which a letter of another script once cut off here by chance.
        assertEquals("有效 [card number] 123元", Redactor.redact("有效 4111111111111111 123元"))
        assertEquals("卡号 [card number] 12月到期", Redactor.redact("卡号 4111 1111 1111 1111 12月到期"))
        assertEquals("订单号1234 [card number]", Redactor.redact("订单号1234 4111 1111 1111 1111"))
        assertEquals("[card number] 12/25", Redactor.redact("4111 1111 1111 1111 12/25"))
        // An ANR's thread header, read alike whatever script stands before "tid=".
        assertTrue(ThreadTraceParser.thread("\"x\" prio=5 线程tid=9 Native\n  at g.H.i(H.java:3)\n", "x", 1024) != null)
        assertNull(ThreadTraceParser.thread("\"x\" prio=5 utid=9 Native\n  at g.H.i(H.java:3)\n", "x", 1024))
    }

    /*
     * The token pattern reads each run of a token's characters a bounded
     * number of times (#10786), and Android's engine is where its
     * differences from the server's copy matter (Redactor.kt says why).
     */
    @Test
    fun tokensAreTakenOutOnAndroidOncePerRun() {
        // After a "-": the server's form, a back-reference, would start a match only at an "e" here and miss these.
        assertEquals("trace-[token]", Redactor.redact("trace-$JWT"))
        assertEquals("req a-b-[token].more", Redactor.redact("req a-b-$JWT.more"))
        assertEquals("x-[token]", Redactor.redact("x-eyJab-$JWT"))
        assertEquals("x$JWT", Redactor.redact("x$JWT"))

        // The tokens eyJ... finds wherever no ASCII word runs into it, and no others, whatever comes before and after.
        val outsideAWordToken = Regex("""(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}""")
        // Android's own word boundary, which the pattern held before #10835: the same tokens on ASCII text, and elsewhere none left whole.
        val wordBoundaryToken = Regex("""\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}""")
        val heads: List<String> =
            listOf(
                "", " ", "=", "x", "_", "-", "a-", "eyJab-", "é", "中", "e\u0301", "-\u0301", "\u200B", "x\u200B", "\u200D", "\u0661",
                "\uD835\uDC9C", "\u017F", "\u212A", "카", "ж",
            )
        val tokens: List<String> =
            listOf(JWT, "eyJabcde.fghij.klmno", "eyJabcd.efghi.jklmn", "eyJab-eyJabcde.fghij.klmno", "eyJ-eyJab.cdefg.hijkl", "eyJabcde.fghij")
        val tails: List<String> = listOf("", " ", ".", ".more", "-x", "é", "\u0301", "已", "\u200B")
        for (head in heads) {
            for (token in tokens) {
                for (tail in tails) {
                    val text = head + token + tail
                    val now: String = Redactor.redactTokens(text)
                    assertEquals(text, outsideAWordToken.replace(text, Redactor.TOKEN), now)
                    if (text.all { it.code < 128 }) {
                        assertEquals(text, wordBoundaryToken.replace(text, Redactor.TOKEN), now)
                    } else {
                        val taken: List<IntRange> = outsideAWordToken.findAll(text).map { it.range }.toList()
                        for (match in wordBoundaryToken.findAll(text)) {
                            assertTrue(text, taken.any { it.first <= match.range.last && it.last >= match.range.first })
                        }
                    }
                }
            }
        }

        // Read once more from each "eyJ" after a "-", these took minutes here.
        val started: Long = System.nanoTime()
        for (text in listOf("-eyJ-".repeat(40_000), "eyJab-".repeat(40_000), "eyJ".repeat(80_000))) {
            assertEquals(text, Redactor.redact(text))
        }
        assertTrue((System.nanoTime() - started) / 1_000_000 < 10_000)

        // On a segment this long, a counted repeat ran out of room, and the token after it was kept.
        assertEquals("[token] then [token]", Redactor.redact("eyJ" + "a".repeat(255_000) + ".bbbbbbbbbb.cccccccccc then $JWT"))
    }

    /*
     * What the device took out before #10835, it takes out still: a secret
     * planted between two of what may stand beside it, of any script, and
     * the redactor before #10835 read by Android's own engine. On an ASCII
     * text every pattern reads as it did, the card's taking out a card
     * beside another number too.
     */
    @Test
    fun noSecretTheDeviceTookOutIsKeptOnAndroid() {
        val random = Random(10835)
        var ascii = 0
        var keptThenTakenOutNow = 0
        repeat(DRAWN_TEXTS) {
            val secret: String = SECRETS[random.nextInt(SECRETS.size)]
            val text: String = neighbours(random) + secret + neighbours(random)
            val now: String = Redactor.redact(text)
            if (text.all { it.code < 128 }) {
                ascii++
                assertEquals(text, Before10835.redact(text) { Redactor.redactCards(it) }, now)
            }
            val before: String = Before10835.redact(text)
            if (!before.contains(secret)) {
                assertFalse("$text: $now", now.contains(secret))
            } else if (!now.contains(secret)) {
                keptThenTakenOutNow++
            }
        }
        assertTrue(ascii > DRAWN_TEXTS / 20)
        // Here Android's engine read \w, \b and \d with every script's characters: many a secret it kept is taken out now.
        assertTrue(keptThenTakenOutNow > DRAWN_TEXTS / 10)
    }

    // A new matcher for each match copied the whole text on Android: about four to six seconds for each of these.
    @Test
    fun aTextWithManyMatchesIsReadOnceOnAndroid() {
        val started: Long = System.nanoTime()
        assertEquals("1795076857467 ".repeat(18_000), Redactor.redact("1795076857467 ".repeat(18_000)))
        assertEquals("password=[redacted] ".repeat(23_000), Redactor.redact("password=x ".repeat(23_000)))
        assertEquals("[card number] ".repeat(15_000), Redactor.redact("4111111111111111 ".repeat(15_000)))
        assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
    }

    // Each one-digit group is a place a card may start, each tried at seven lengths, and read with one matcher: none is a card.
    @Test
    fun cardsAreLookedForInTimeInLineWithTheTextOnAndroid() {
        val started: Long = System.nanoTime()
        assertEquals("3 ".repeat(131_072), Redactor.redact("3 ".repeat(131_072)))
        assertEquals("中4111111111111112".repeat(15_000), Redactor.redact("中4111111111111112".repeat(15_000)))
        assertEquals("12 [card number] ".repeat(12_000), Redactor.redact("12 4111111111111111 ".repeat(12_000)))
        assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
    }

    @Test
    fun kernelFilesParseOnAndroid() {
        assertEquals(1024L, MemInfoParser.parse("MemTotal: 1 kB\nActive(anon): 2 kB")["MemTotal"])
        assertEquals(1, CpuStatParser.parse("cpu0 1 2 3 4 5 6 7 8").size)
        assertEquals(0.5, LoadAverageParser.parse("0.5 0.4 0.3 1/2 3")!!.oneMinute, 0.0)
        assertEquals("/a b", MountsParser.parse("/dev/x /a\\040b ext4 rw 0 0").single().mountpoint)
        assertEquals("e7a7ab81-d18d-41ea-9dbb-27082631f948", BootIdParser.parse("e7a7ab81-d18d-41ea-9dbb-27082631f948"))
    }

    /*
     * The redactor before #10835, which said "not inside a longer word" with
     * \w, \b and \d, here read by Android's engine as the device read it
     * (RedactorTest holds the same copy). Its card check took a card-length
     * run of digits whole. It read a digit of another script as a number too
     * ("١" - "0" is 1585), and so passed such a run now and then by chance;
     * here a run that holds one is no card, so that only what it took out for
     * a card counts.
     */
    private object Before10835 {
        private val TOKEN: Regex = Regex("""\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}""")
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
            var result: String = TOKEN.replace(text, Redactor.TOKEN)
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

        const val DRAWN_TEXTS: Int = 20_000

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
                "中", "卡号", "已拒绝", "，", "カード", "です", "카드", "رقم", "ب", "ключ", "ก", "क", "é", "e\u0301", "\u0301", "\u200B",
                "x\u200B", "\u200D", "\u0661", "\u0967", "\uFF11", "\u017F", "\u212A", "\uD835\uDC9C",
            )

        // One or two neighbours.
        fun neighbours(random: Random): String = buildString { repeat(1 + random.nextInt(2)) { append(NEIGHBOURS[random.nextInt(NEIGHBOURS.size)]) } }
    }
}
