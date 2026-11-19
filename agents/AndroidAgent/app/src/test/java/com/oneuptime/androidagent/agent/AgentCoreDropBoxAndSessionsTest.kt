package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.apps.AppInventoryTracker
import com.oneuptime.androidagent.boot.BootInfo
import com.oneuptime.androidagent.boot.BootTracker
import com.oneuptime.androidagent.collect.DeviceSnapshot
import com.oneuptime.androidagent.collect.MemoryReading
import com.oneuptime.androidagent.config.AgentConfig
import com.oneuptime.androidagent.config.ConfigResolver
import com.oneuptime.androidagent.config.LocalSettings
import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.config.ManagedConfigParser
import com.oneuptime.androidagent.config.MemoryKeyValueStore
import com.oneuptime.androidagent.dropbox.DropBoxDecoder
import com.oneuptime.androidagent.dropbox.DropBoxEntry
import com.oneuptime.androidagent.dropbox.DropBoxFinding
import com.oneuptime.androidagent.dropbox.DropBoxFixtures
import com.oneuptime.androidagent.dropbox.DropBoxRead
import com.oneuptime.androidagent.dropbox.DropBoxState
import com.oneuptime.androidagent.logs.LogBuffer
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.logsession.LogSessionClient
import com.oneuptime.androidagent.logsession.LogSessionManager
import com.oneuptime.androidagent.logsession.LogSessionStatus
import com.oneuptime.androidagent.logsession.LogSessionUnavailable
import com.oneuptime.androidagent.logsession.SessionLogcat
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.array
import com.oneuptime.androidagent.testing.kioskFacts
import com.oneuptime.androidagent.testing.obj
import com.oneuptime.androidagent.testing.otlpAttributes
import com.oneuptime.androidagent.testing.parseJson
import com.oneuptime.androidagent.testing.text
import com.oneuptime.androidagent.transport.Backoff
import com.oneuptime.androidagent.transport.JsonTransport
import com.oneuptime.androidagent.transport.OtlpTransport
import com.oneuptime.androidagent.transport.Outbox
import com.oneuptime.androidagent.transport.TransportResult
import com.oneuptime.androidagent.transport.Uploader
import java.io.File
import kotlin.random.Random
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AgentCoreDropBoxAndSessionsTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val clock = FakeClock(now = 1_795_000_000_000L, elapsed = 3_600_000L)
    private val facts = kioskFacts()
    private val state = MemoryKeyValueStore()
    private val logBuffer = LogBuffer()
    private val managed: Map<String, Any?> = mapOf("oneuptime_token" to "the-key", "device_name" to "store-0412-kiosk-02")
    private var bootInfo = BootInfo("boot-1", 41, clock.now - clock.elapsed)

    // What DropBox gives the next cycle.
    private var dropBoxState = DropBoxState.READING
    private val dropBoxRecords: MutableList<LogRecord> = mutableListOf()
    private val dropBoxBoots: MutableList<DropBoxFinding.Boot> = mutableListOf()

    private class Sent(val url: String, val json: JsonObject)

    private val sent: MutableList<Sent> = mutableListOf()
    private val sessionRequests: MutableList<String> = mutableListOf()
    private var sessionAnswer: TransportResult = TransportResult.Answered(200, body = """{"sessions":[]}""")

    private val sessionLogcat =
        object : SessionLogcat {
            override fun unavailable(): LogSessionUnavailable? = null

            override fun start(sessionId: String, level: LogcatLevel) = Unit

            override fun stop() = Unit

            override val isRunning: Boolean = true
            override val lastOtherAppLineElapsedMillis: Long? = null
        }

    private lateinit var core: AgentCore
    private lateinit var sessions: LogSessionManager

    @Before
    fun setUp() {
        val outbox = Outbox(File(folder.root, "outbox"), clock)
        val transport =
            OtlpTransport { url, _, body ->
                sent.add(Sent(url, parseJson(String(Outbox.gunzip(body)))))
                TransportResult.Answered(200)
            }
        sessions = LogSessionManager(clock, 34, sessionLogcat)
        core =
            AgentCore(
                environment =
                    AgentEnvironment(
                        loadConfig = { ConfigResolver.resolve(ManagedConfigParser.parse(managed), LocalSettings(), facts) },
                        collectSnapshot = {
                            DeviceSnapshot(clock.now, clock.now - clock.elapsed, clock.elapsed / 1000.0, 8, null, null, MemoryReading(4_000, 2_000, 1_000), emptyList(), null, null, null)
                        },
                        ipAddresses = { emptyList() },
                        bootInfo = { bootInfo },
                        installedApps = { emptyList() },
                        readLogsGranted = { true },
                        networkAvailable = { true },
                        updateLogcat = { _: AgentConfig, _: Boolean -> LogcatState.CRASHES_AND_ANRS },
                        stopLogcat = {},
                        saveLogcatPosition = {},
                        takeDroppedLogcatRecord = { null },
                        readDropBox = {
                            DropBoxRead(dropBoxState, dropBoxRecords.toList(), dropBoxBoots.toList()).also {
                                dropBoxRecords.clear()
                                dropBoxBoots.clear()
                            }
                        },
                    ),
                facts = facts,
                clock = clock,
                outbox = outbox,
                uploader = Uploader(outbox, transport, clock, Backoff(baseMillis = 10_000, random = Random(3))),
                bootTracker = BootTracker(state, clock),
                apps = AppInventoryTracker(state, clock),
                logBuffer = logBuffer,
                agentVersion = "17.0.20",
                logSessions = sessions,
                logSessionClient =
                    LogSessionClient(
                        JsonTransport { url, _, json ->
                            sessionRequests.add(url + " " + json)
                            sessionAnswer
                        },
                        clock,
                    ),
                canSendSessionLogs = { true },
            )
    }

    private fun logRecords(): List<JsonObject> =
        sent.filter { it.url.endsWith("/v1/logs") }.flatMap { request ->
            request.json.array("resourceLogs").flatMap { resource ->
                resource.jsonObject.array("scopeLogs").flatMap { scope -> scope.jsonObject.array("logRecords").map { it.jsonObject } }
            }
        }

    private fun attributesOf(event: String): Map<String, JsonObject>? =
        logRecords().map { it["attributes"]!!.otlpAttributes() }.lastOrNull { it["event.name"]?.text("stringValue") == event }

    private fun metricNames(): List<String> =
        sent.filter { it.url.endsWith("/v1/metrics") }.flatMap { request ->
            request.json.array("resourceMetrics").flatMap { resource ->
                resource.jsonObject.array("scopeMetrics").flatMap { scope -> scope.jsonObject.array("metrics").map { it.jsonObject.text("name") } }
            }
        }

    private fun newBoot(id: String, uptimeMillis: Long) {
        clock.elapsed = uptimeMillis
        bootInfo = BootInfo(id, 42, clock.now - uptimeMillis)
    }

    @Test
    fun `DropBox's crashes are sent with the cycle, and the agent says what it reads`() {
        val crash: DropBoxFinding.Fault =
            DropBoxDecoder.decode(DropBoxEntry("data_app_crash", clock.now - 1_000, DropBoxFixtures.JAVA_CRASH), 0L) as DropBoxFinding.Fault
        dropBoxRecords.add(crash.record)

        val result: CycleResult = core.cycle(byService = true)

        assertEquals(DropBoxState.READING, result.dropBox)
        assertEquals("java.lang.IllegalStateException", attributesOf("app.crash")!!["exception.type"]!!.text("stringValue"))
        assertEquals("reading", attributesOf("oneuptime.agent.started")!!["oneuptime.agent.dropbox"]!!.text("stringValue"))

        dropBoxState = DropBoxState.NO_USAGE_ACCESS
        core.cycle(byService = true)
        assertEquals("no_usage_access", attributesOf("oneuptime.agent.dropbox")!!["oneuptime.agent.dropbox"]!!.text("stringValue"))
    }

    @Test
    fun `a new boot's record waits for Android's boot entries, and says why the device rebooted`() {
        core.cycle(byService = true)
        newBoot("boot-2", uptimeMillis = 40_000)

        core.cycle(byService = true)
        assertNull(attributesOf("device.boot"))

        clock.advance(60_000)
        dropBoxBoots.add(DropBoxFinding.Boot(bootInfo.bootTimeMillis + 8_000, null))
        dropBoxBoots.add(
            DropBoxDecoder.decode(DropBoxEntry("SYSTEM_LAST_KMSG", bootInfo.bootTimeMillis + 8_100, DropBoxFixtures.LAST_KERNEL_LOG), 0L)
                as DropBoxFinding.Boot,
        )
        core.cycle(byService = true)

        val boot: Map<String, JsonObject> = attributesOf("device.boot")!!
        assertEquals("kernel_panic", boot["android.boot.reason"]!!.text("stringValue"))
        assertEquals("Kernel panic - not syncing: Fatal exception in interrupt", boot["android.boot.kernel_panic"]!!.text("stringValue"))
        // The kernel's own lines are redacted too: no MAC address is a secret, but nothing in them is trusted either.
        assertTrue(boot["android.boot.last_kernel_log"]!!.text("stringValue").contains("Kernel panic"))
    }

    @Test
    fun `it waits three minutes at most`() {
        core.cycle(byService = true)
        newBoot("boot-2", uptimeMillis = 40_000)
        core.cycle(byService = true)
        assertNull(attributesOf("device.boot"))

        clock.advance(AgentCore.BOOT_FACTS_WAIT_MILLIS)
        core.cycle(byService = true)

        val boot: Map<String, JsonObject> = attributesOf("device.boot")!!
        assertNull(boot["android.boot.reason"])
    }

    @Test
    fun `without DropBox the boot is reported at once`() {
        dropBoxState = DropBoxState.NOT_GRANTED
        core.cycle(byService = true)
        newBoot("boot-2", uptimeMillis = 40_000)

        core.cycle(byService = true)

        assertTrue(attributesOf("device.boot") != null)
    }

    @Test
    fun `a kernel log from an earlier boot is not this boot's reason`() {
        core.cycle(byService = true)
        newBoot("boot-2", uptimeMillis = 400_000)
        dropBoxBoots.add(
            DropBoxDecoder.decode(DropBoxEntry("SYSTEM_LAST_KMSG", bootInfo.bootTimeMillis - 10 * 60_000, DropBoxFixtures.LAST_KERNEL_LOG), 0L)
                as DropBoxFinding.Boot,
        )

        core.cycle(byService = true)

        assertNull(attributesOf("device.boot")!!["android.boot.reason"])
    }

    @Test
    fun `the boots of the last hour go out as a metric, for the Restart Loop template`() {
        core.cycle(byService = true)

        assertTrue("android.boot.recent_count" in metricNames())
    }

    @Test
    fun `each cycle asks OneUptime for log sessions, and a request reaches the device`() {
        sessionAnswer =
            TransportResult.Answered(
                200,
                body = """{"sessions":[{"id":"s1","status":"Requested","durationMinutes":30,"minimumLevel":"info","requestedByName":"Jane Doe"}]}""",
            )

        core.cycle(byService = true)

        assertTrue(sessionRequests.single().startsWith("https://oneuptime.com/telemetry/android-agent/v1/log-sessions "))
        assertEquals(LogSessionStatus.AWAITING_APPROVAL, sessions.current()!!.status)

        // The next exchange tells OneUptime the device has it, and is not asked again until something changes.
        core.cycle(byService = true)
        assertTrue(sessionRequests[1].contains("\"status\":\"AwaitingApproval\""))
        sessionAnswer = TransportResult.Answered(200, body = """{"sessions":[]}""")
        core.cycle(byService = true)
        assertFalse(sessionRequests[2].contains("AwaitingApproval"))
    }

    @Test
    fun `a OneUptime without log sessions is not asked every minute`() {
        sessionAnswer = TransportResult.Answered(404)

        core.cycle(byService = true)
        core.cycle(byService = true)

        assertEquals(1, sessionRequests.size)
    }
}
