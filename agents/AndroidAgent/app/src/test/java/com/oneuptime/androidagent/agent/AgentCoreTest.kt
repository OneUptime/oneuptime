package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.apps.AppInventoryTracker
import com.oneuptime.androidagent.apps.InstalledApp
import com.oneuptime.androidagent.boot.BootInfo
import com.oneuptime.androidagent.boot.BootTracker
import com.oneuptime.androidagent.collect.DeviceSnapshot
import com.oneuptime.androidagent.collect.MemoryReading
import com.oneuptime.androidagent.config.AgentConfig
import com.oneuptime.androidagent.config.ConfigResolver
import com.oneuptime.androidagent.config.LocalSettings
import com.oneuptime.androidagent.config.ManagedConfigParser
import com.oneuptime.androidagent.config.MemoryKeyValueStore
import com.oneuptime.androidagent.logs.LogBuffer
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.Severity
import com.oneuptime.androidagent.testing.FakeClock
import com.oneuptime.androidagent.testing.array
import com.oneuptime.androidagent.testing.kioskFacts
import com.oneuptime.androidagent.testing.obj
import com.oneuptime.androidagent.testing.otlpAttributes
import com.oneuptime.androidagent.testing.parseJson
import com.oneuptime.androidagent.testing.text
import com.oneuptime.androidagent.transport.Backoff
import com.oneuptime.androidagent.transport.OtlpTransport
import com.oneuptime.androidagent.transport.Outbox
import com.oneuptime.androidagent.transport.Signal
import com.oneuptime.androidagent.transport.TransportResult
import com.oneuptime.androidagent.transport.Uploader
import java.io.File
import kotlin.random.Random
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AgentCoreTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val clock = FakeClock(now = 1_795_000_000_000L, elapsed = 60_000L)
    private val facts = kioskFacts()
    private val state = MemoryKeyValueStore()
    private val logBuffer = LogBuffer()

    private var managed: Map<String, Any?> = mapOf("oneuptime_token" to "the-key", "device_name" to "store-0412-kiosk-02")
    private var bootInfo = BootInfo("boot-1", 41, clock.now - clock.elapsed)
    private var granted = false
    private var online = true
    private var apps: List<InstalledApp> = listOf(InstalledApp("com.example.kiosk", "4.2.0", 420, false, false, true, null, 1L, 1L))
    private var appsRead = 0
    private var logcatStops = 0
    private var droppedLogcat: LogRecord? = null

    private class Sent(val url: String, val json: JsonObject)

    private val sent: MutableList<Sent> = mutableListOf()
    private val answers: ArrayDeque<TransportResult> = ArrayDeque()
    private lateinit var outbox: Outbox
    private lateinit var core: AgentCore

    @Before
    fun setUp() {
        outbox = Outbox(File(folder.root, "outbox"), clock)
        val transport =
            OtlpTransport { url, _, body ->
                sent.add(Sent(url, parseJson(String(Outbox.gunzip(body)))))
                answers.removeFirstOrNull() ?: TransportResult.Answered(200)
            }
        core =
            AgentCore(
                environment =
                    AgentEnvironment(
                        loadConfig = { ConfigResolver.resolve(ManagedConfigParser.parse(managed), LocalSettings(), facts) },
                        collectSnapshot = {
                            DeviceSnapshot(clock.now, clock.now - clock.elapsed, clock.elapsed / 1000.0, 8, null, null, MemoryReading(4_000, 2_000, 1_000), emptyList(), null, null, null)
                        },
                        ipAddresses = { listOf("10.20.30.40") },
                        bootInfo = { bootInfo },
                        installedApps = {
                            appsRead += 1
                            apps
                        },
                        readLogsGranted = { granted },
                        networkAvailable = { online },
                        updateLogcat = { config: AgentConfig, isGranted: Boolean ->
                            when {
                                !config.logcatEnabled -> LogcatState.DISABLED
                                !isGranted -> LogcatState.NOT_GRANTED
                                else -> LogcatState.CRASHES_AND_ANRS
                            }
                        },
                        stopLogcat = { logcatStops += 1 },
                        saveLogcatPosition = {},
                        takeDroppedLogcatRecord = { droppedLogcat.also { droppedLogcat = null } },
                    ),
                facts = facts,
                clock = clock,
                outbox = outbox,
                uploader = Uploader(outbox, transport, clock, Backoff(baseMillis = 10_000, random = Random(3))),
                bootTracker = BootTracker(state, clock),
                apps = AppInventoryTracker(state, clock),
                logBuffer = logBuffer,
                agentVersion = "17.0.12",
            )
    }

    private fun logRecords(): List<JsonObject> =
        sent.filter { it.url.endsWith("/v1/logs") }.flatMap { request ->
            request.json.array("resourceLogs").flatMap { resource ->
                resource.jsonObject.array("scopeLogs").flatMap { scope -> scope.jsonObject.array("logRecords").map { it.jsonObject } }
            }
        }

    private fun eventNames(): List<String> =
        logRecords().mapNotNull { it["attributes"]?.otlpAttributes()?.get("event.name")?.text("stringValue") }

    @Test
    fun `without a key nothing is collected or sent, but boots are still recorded`() {
        managed = emptyMap()

        val result: CycleResult = core.cycle(byService = true)

        assertFalse(result.collected)
        assertTrue(outbox.pending().isEmpty())
        assertTrue(sent.isEmpty())
        assertEquals(1, logcatStops)

        // The boot seen while not set up is not reported as new once the key arrives.
        managed = mapOf("oneuptime_token" to "the-key")
        core.cycle(byService = true)
        assertFalse("device.boot" in eventNames())
    }

    @Test
    fun `a cycle collects, queues and sends metrics and logs under the device's resource`() {
        val result: CycleResult = core.cycle(byService = true)

        assertTrue(result.collected)
        assertTrue(result.uploaded)
        assertEquals(LogcatState.NOT_GRANTED, result.logcat)
        assertEquals(listOf("https://oneuptime.com/otlp/v1/metrics", "https://oneuptime.com/otlp/v1/logs"), sent.map { it.url })
        assertTrue(outbox.pending().isEmpty())
        assertEquals(clock.now, core.lastCollectionAtMillis)

        val metricsResource: Map<String, JsonObject> =
            sent.first().json.array("resourceMetrics")[0].jsonObject.obj("resource").getValue("attributes").otlpAttributes()
        assertEquals("store-0412-kiosk-02", metricsResource.getValue("host.name").text("stringValue"))
        assertEquals("linux", metricsResource.getValue("os.type").text("stringValue"))
        assertFalse(metricsResource.containsKey("service.name"))

        // Started, saying Logcat is off and how to turn it on; and the installed apps.
        assertEquals(listOf("oneuptime.agent.started", "android.package.inventory"), eventNames())
        val started: JsonObject = logRecords().first()
        assertTrue(started.obj("body").text("stringValue").contains("READ_LOGS has not been granted"))
    }

    @Test
    fun `the start is announced once, and a change in what Logcat can read is reported`() {
        core.cycle(byService = true)
        sent.clear()

        core.cycle(byService = true)
        assertFalse("oneuptime.agent.started" in eventNames())

        granted = true
        sent.clear()
        core.cycle(byService = true)
        assertEquals(listOf("oneuptime.agent.logcat"), eventNames())
    }

    @Test
    fun `a new boot is reported`() {
        core.cycle(byService = true)
        clock.advance(600_000L)
        core.cycle(byService = true)
        sent.clear()

        // The device went down without a shutdown and came back.
        clock.now += 30_000L
        clock.elapsed = 45_000L
        bootInfo = BootInfo("boot-2", 42, clock.now - clock.elapsed)
        core.cycle(byService = true)

        assertTrue("device.boot" in eventNames())
        val boot: JsonObject = logRecords().first { it["attributes"]?.otlpAttributes()?.get("event.name")?.text("stringValue") == "device.boot" }
        assertEquals(
            "unexpected",
            boot.getValue("attributes").otlpAttributes().getValue("android.boot.previous_shutdown").text("stringValue"),
        )
    }

    @Test
    fun `installed apps are read every 15 minutes, or at once after a package change, and not when switched off`() {
        core.cycle(byService = true)
        clock.advance(60_000L)
        core.cycle(byService = true)
        assertEquals(1, appsRead)

        core.requestAppsCheck()
        core.cycle(byService = true)
        assertEquals(2, appsRead)

        clock.advance(AgentCore.APPS_CHECK_INTERVAL_MILLIS)
        core.cycle(byService = true)
        assertEquals(3, appsRead)

        managed = managed + ("installed_apps_enabled" to false)
        clock.advance(AgentCore.APPS_CHECK_INTERVAL_MILLIS)
        core.cycle(byService = true)
        assertEquals(3, appsRead)
    }

    @Test
    fun `offline, telemetry is kept and sent once the network is back`() {
        online = false
        core.cycle(byService = true)
        assertTrue(sent.isEmpty())
        assertEquals(2, outbox.pending().size)

        online = true
        assertTrue(core.upload())

        assertTrue(outbox.pending().isEmpty())
        assertEquals(2, sent.size)
    }

    @Test
    fun `new settings after a failure are tried at once`() {
        answers.add(TransportResult.Answered(401))
        core.cycle(byService = true)
        assertEquals(1, sent.size)

        // Waiting after the 401: the next cycle sends nothing...
        core.cycle(byService = true)
        assertEquals(1, sent.size)

        // ...until a new key arrives.
        managed = managed + ("oneuptime_token" to "the-new-key")
        core.cycle(byService = true)
        assertTrue(sent.size > 1)
        assertTrue(outbox.pending().isEmpty())
    }

    @Test
    fun `lines read from Logcat, dropped-line counts and dropped batches go out with the next cycle`() {
        logBuffer.add(LogRecord(1L, 1L, Severity.ERROR, "Printer offline"))
        droppedLogcat = LogRecord(2L, 2L, Severity.WARN, "Left out 5 Logcat lines")
        outbox.countDropped(3)

        core.cycle(byService = true)

        val bodies: List<String> = logRecords().map { it.obj("body").text("stringValue") }
        assertTrue("Printer offline" in bodies)
        assertTrue("Left out 5 Logcat lines" in bodies)
        assertTrue("oneuptime.agent.dropped" in eventNames())
    }

    @Test
    fun `at shutdown, the shutdown and what is in memory are written to disk, not sent`() {
        core.cycle(byService = true)
        sent.clear()
        logBuffer.add(LogRecord(1L, 1L, Severity.INFO, "last line"))

        core.onShutdown()

        assertTrue(sent.isEmpty())
        val stored: List<String> = outbox.pending(Signal.LOGS).mapNotNull { outbox.read(it) }
        assertEquals(1, stored.size)
        assertTrue(stored.single().contains("device.shutdown"))
        assertTrue(stored.single().contains("last line"))
    }

    @Test
    fun `logs are queued in batches of at most 2,000 records`() {
        repeat(4_500) { logBuffer.add(LogRecord(it.toLong(), it.toLong(), Severity.INFO, "line $it")) }
        online = false

        core.cycle(byService = true)

        assertEquals(1 + 3, outbox.pending().size)
        assertEquals(3, outbox.pending(Signal.LOGS).size)
    }
}
