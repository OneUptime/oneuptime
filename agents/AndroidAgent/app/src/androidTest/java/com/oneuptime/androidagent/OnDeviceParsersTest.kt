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
import com.oneuptime.androidagent.dropbox.JavaStackParser
import com.oneuptime.androidagent.dropbox.NativeFrameParser
import com.oneuptime.androidagent.dropbox.ThreadTraceParser
import com.oneuptime.androidagent.logs.LogcatLineParser
import com.oneuptime.androidagent.logs.LogcatParse
import com.oneuptime.androidagent.logs.LogcatUid
import com.oneuptime.androidagent.logs.Redactor
import com.oneuptime.androidagent.logsession.LogSessionNote
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
        assertEquals("บัตร[card number]", Redactor.redact("บัตร378282246310005"))
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

    /*
     * A card number in another script's digits, an address in another
     * script, and a credential after another script's space: each was kept
     * on the device (#10877, #10878), or read otherwise here than in the
     * JVM's unit tests (#10876).
     */
    @Test
    fun secretsInOtherScriptsAreRedactedOnAndroid() {
        assertEquals("カード番号：[card number]", Redactor.redact("カード番号：４１１１ １１１１ １１１１ １１１１"))
        assertEquals("[card number]", Redactor.redact("٤١١١١١١١١١١١١١١١"))
        assertEquals("شماره کارت [card number] رد شد", Redactor.redact("شماره کارت ۴۱۱۱-۱۱۱۱-۱۱۱۱-۱۱۱۱ رد شد"))
        assertEquals("卡号[card number]已拒绝", Redactor.redact("卡号４１１１１１１１１１１１１１１１已拒绝"))
        for (zero in DIGIT_ZEROS) {
            for (card in listOf("4111111111111111", "5500 0000 0000 0004", "378282246310005")) {
                val written: String = inScript(card, zero)
                assertEquals(written, "Card [card number] declined", Redactor.redact("Card $written declined"))
            }
            assertEquals(inScript("4111111111111112", zero), Redactor.redact(inScript("4111111111111112", zero)))
        }
        // A digit of another script beside a card is no part of it; a card in mixed digits is read whole.
        assertEquals("[card number]１２", Redactor.redact("4111111111111111１２"))
        assertEquals("12[card number]", Redactor.redact("12٤١١١١١١١١١١١١١١١"))
        assertEquals("[card number]", Redactor.redact("４１１１ 1111 1111 1111"))
        assertEquals("[card number]", Redactor.redact("۴۱۱۱١١١١۱۱۱۱١١١١"))
        assertEquals("١٢4111 1111 1111 ١١١١", Redactor.redact("١٢4111 1111 1111 ١١١١"))
        assertEquals("x٤١١١١١١١١١١١١١١١", Redactor.redact("x٤١١١١١١١١١١١١١١١"))
        assertEquals("[card number] ١٢/٢٥", Redactor.redact("٤١١١ ١١١١ ١١١١ ١١١١ ١٢/٢٥"))
        // Digits beyond the Basic Multilingual Plane are left.
        assertEquals("\uD83A\uDD54" + "\uD83A\uDD51".repeat(15), Redactor.redact("\uD83A\uDD54" + "\uD83A\uDD51".repeat(15)))
        // Addresses in any script, whole; a domain in Unicode and in punycode alike.
        for (address in listOf(
            "张伟@example.com", "josé@example.com", "josé.garcia@example.com", "müller@bücher.de", "user@例え.jp", "user@xn--r8jz45g.jp",
            "почта@пример.рф", "user@xn--e1afmkfd.xn--p1ai", "山田たろう@例え.jp", "उपयोगकर्ता@उदाहरण.भारत", "jose\u0301@example.com",
        )) {
            assertEquals(address, "Receipt sent to [email], thanks", Redactor.redact("Receipt sent to $address, thanks"))
        }
        // A letter of another script beside an address is still no part of it.
        assertEquals("邮箱[email]", Redactor.redact("邮箱jane@example.com"))
        assertEquals("Email[email]", Redactor.redact("Email张伟@example.com"))
        assertEquals("[email]已发送", Redactor.redact("张伟@example.com已发送"))
        // An address beside a card takes no part of it.
        assertEquals("[card number]é@例え.jp", Redactor.redact("4111 1111 1111 1111é@例え.jp"))
        assertEquals("x@x.xn--[card number]", Redactor.redact("x@x.xn--4111 1111 1111 1111"))
        assertEquals("[email]", Redactor.redact("中@x.jane@example.com"))
        // Chinese and Japanese text's own space, and a no-break space.
        assertEquals("令牌：Bearer [credential]", Redactor.redact("令牌：Bearer\u3000abcdefghijklmnop"))
        assertEquals("password=[redacted]\u3000次の", Redactor.redact("password=hunter2\u3000次の"))
        assertEquals("Bearer [credential]", Redactor.redact("Bearer\u00A0abcdefghijklmnop"))
        assertEquals("Bearer\ufeffabcdefghijklmnop", Redactor.redact("Bearer\ufeffabcdefghijklmnop"))
    }

    /*
     * What the redactor writes out is what Android's regular expressions
     * read: a space is exactly a character Android's \s takes, and a digit
     * exactly one Android's \p{Nd} and Character.digit take in the Basic
     * Multilingual Plane, each by the value RedactorTest reads on the JVM.
     */
    @Test
    fun aSpaceAndADigitAreAndroidsOwn() {
        val space = Regex("""\s""")
        val digit = Regex("""\p{Nd}""")
        val spaces: MutableList<Int> = mutableListOf()
        val digits: MutableList<Int> = mutableListOf()
        for (code in 0..0xFFFF) {
            val char: Char = code.toChar()
            if (char.isSurrogate()) {
                continue
            }
            val name: String = "U+%04X".format(code)
            val androidSpace: Boolean = space.matches(char.toString())
            assertEquals(name, androidSpace, Redactor.redact("Bearer${char}abcdefghijklmnop") == "Bearer [credential]")
            if (androidSpace) {
                spaces.add(code)
            }
            val value: Int = Character.digit(char, 10)
            assertEquals(name, value >= 0, digit.matches(char.toString()))
            assertEquals(name, value == 1, Redactor.looksLikeCardNumber("411111111111111$char"))
            if (value >= 0) {
                digits.add(code)
            }
        }
        assertEquals(ANDROID_SPACES.map { it.code }.sorted(), spaces)
        assertEquals(DIGIT_ZEROS.flatMap { zero -> zero..zero + 9 }, digits)
    }

    /*
     * What the device took out before #10876, #10877 and #10878, it takes
     * out still: the redactor as it was written, read by Android's engine
     * as the device read it, on texts that plant a secret of any kind
     * (#10835's, cards in other scripts' digits, addresses in other scripts,
     * credentials after other spaces) between neighbours of any script. On
     * an ASCII text it reads as it did.
     */
    @Test
    fun noSecretTheDeviceTookOutBeforeIsKeptOnAndroid() {
        val random = Random(10878)
        var ascii = 0
        var newlyTakenOut = 0
        repeat(DRAWN_TEXTS) { index ->
            val asciiOnly: Boolean = index % 3 == 0
            val secrets: List<String> = if (asciiOnly) ASCII_MORE_SECRETS else MORE_SECRETS
            val secret: String = secrets[random.nextInt(secrets.size)]
            val text: String = moreNeighbours(random, asciiOnly) + secret + moreNeighbours(random, asciiOnly)
            val now: String = Redactor.redact(text)
            val before: String = Before10876.redact(text)
            if (asciiOnly && !PUNYCODE_TOP_LEVEL_DOMAIN.containsMatchIn(text) && text.count { it == '@' } < 2) {
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

    // Each digit of a long run of another script's a place a card may start, each read in O(1) once found: none is a card.
    @Test
    fun otherScriptsDigitsAreLookedThroughInTimeOnAndroid() {
        val started: Long = System.nanoTime()
        assertEquals("٣".repeat(262_000), Redactor.redact("٣".repeat(262_000)))
        assertEquals("٣ ".repeat(131_000), Redactor.redact("٣ ".repeat(131_000)))
        assertEquals("4٣".repeat(131_000), Redactor.redact("4٣".repeat(131_000)))
        assertTrue((System.nanoTime() - started) / 1_000_000 < 10_000)
    }

    // An address's name, labels and top-level domain in other scripts, and a long run of spaces: none is an address or a credential.
    @Test
    fun addressesInOtherScriptsAreLookedThroughInTimeOnAndroid() {
        val texts: List<String> =
            listOf(
                "张@".repeat(131_000),
                "é".repeat(262_000) + "@example.com",
                // A domain of 131,000 labels and no top-level domain: Android's engine reads it to its end, where the JVM's runs out of stack.
                "a@" + "例.".repeat(131_000),
                "中".repeat(262_000) + "@x.中国",
                "Bearer" + "\u3000".repeat(262_000) + "x",
            )
        val started: Long = System.nanoTime()
        for (text in texts) {
            assertEquals(text, Redactor.redact(text))
        }
        assertTrue((System.nanoTime() - started) / 1_000_000 < 10_000)
    }

    /*
     * The parsers read a line as the JVM's unit tests do: a Java class name
     * by Java's own rule, an app's text whole whatever character it holds,
     * and Android's own headers in ASCII (#10876).
     */
    @Test
    fun parsersReadALineAsTheTestsDoOnAndroid() {
        assertEquals("com.example.Ошибка", JavaStackParser.parse("com.example.Ошибка: Платёж отклонён\n\tat a.B.c(B.java:1)", 1024)!!.type)
        assertEquals("例え.パッケージ.エラー\$内部", JavaStackParser.parse("例え.パッケージ.エラー\$内部: x", 1024)!!.type)
        assertNull(JavaStackParser.parse("Ошибка: x", 1024))
        val zone: TimeZone = TimeZone.getTimeZone("UTC")
        for (inside in listOf("\u000B", "\u000C", "\u0085", "\u2028", "\u2029")) {
            assertEquals("a${inside}b", JavaStackParser.parse("java.lang.Error: a${inside}b", 1024)!!.message)
            assertEquals("a${inside}b", (LogcatLineParser.parse("1795076845.927   580   974 I Tag: a${inside}b", 0L, zone) as LogcatParse.Entry).line.message)
        }
        assertEquals(LogcatParse.Unrecognized, LogcatLineParser.parse("1795076845.927   ٥٨٠   974 I Tag: m", 0L, zone))
        assertEquals("a b", LogSessionNote.clean("a\u3000b"))
        assertEquals("a\uFEFFb", LogSessionNote.clean("a\uFEFFb"))
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

    /*
     * The redactor before #10876, #10877 and #10878, as it was written, here
     * read by Android's engine as the device read it: its \s is Android's
     * (RedactorTest writes it out, for the JVM). Its cards were ASCII digits
     * alone, and its addresses ASCII.
     */
    private object Before10876 {
        private val CARD_START: Regex = Regex("""(?<![A-Za-z0-9_.])(?=([2-6](?:[ -]?[0-9]){12,18})(?![A-Za-z0-9_.]))""")
        private val EMAIL_ADDRESS: Regex =
            Regex("""(?<![A-Za-z0-9_.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9_-])""")
        private val AUTHORIZATION: Regex = Regex("""(?<![A-Za-z0-9_])(?i)(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}""")
        private val SECRET_ASSIGNMENT: Regex =
            Regex(
                """(?<![A-Za-z0-9_-])(?i)(["']?[A-Za-z0-9_-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?\s{0,8}[:=]\s{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\s,;&)\]\}]+)""",
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

        // The first of each script's ten decimal digits in Unicode's Basic Multilingual Plane, as the redactor reads them.
        val DIGIT_ZEROS: List<Int> =
            listOf(
                0x0030, 0x0660, 0x06F0, 0x07C0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0DE6, 0x0E50,
                0x0ED0, 0x0F20, 0x1040, 0x1090, 0x17E0, 0x1810, 0x1946, 0x19D0, 0x1A80, 0x1A90, 0x1B50, 0x1BB0, 0x1C40, 0x1C50, 0xA620,
                0xA8D0, 0xA900, 0xA9D0, 0xA9F0, 0xAA50, 0xABF0, 0xFF10,
            )

        // The characters Android's \s takes, which the redactor writes out.
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
