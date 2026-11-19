package com.oneuptime.androidagent.otlp

import com.oneuptime.androidagent.agent.AgentCore
import com.oneuptime.androidagent.agent.AgentEvents
import com.oneuptime.androidagent.apps.AppInventoryTracker
import com.oneuptime.androidagent.apps.InstalledApp
import com.oneuptime.androidagent.boot.BootEvent
import com.oneuptime.androidagent.boot.BootInfo
import com.oneuptime.androidagent.boot.BootTracker
import com.oneuptime.androidagent.boot.PreviousShutdown
import com.oneuptime.androidagent.boot.RebootFacts
import com.oneuptime.androidagent.collect.BatteryReading
import com.oneuptime.androidagent.collect.DeviceSnapshot
import com.oneuptime.androidagent.collect.FilesystemReading
import com.oneuptime.androidagent.collect.HostMetrics
import com.oneuptime.androidagent.collect.MemoryReading
import com.oneuptime.androidagent.collect.NetworkReading
import com.oneuptime.androidagent.collect.ThermalReading
import com.oneuptime.androidagent.config.ConfigSource
import com.oneuptime.androidagent.config.DeviceIdentity
import com.oneuptime.androidagent.device.SecurityPatchAge
import com.oneuptime.androidagent.dropbox.DropBoxDecoder
import com.oneuptime.androidagent.dropbox.DropBoxEntry
import com.oneuptime.androidagent.dropbox.DropBoxFinding
import com.oneuptime.androidagent.dropbox.DropBoxFixtures
import com.oneuptime.androidagent.dropbox.DropBoxState
import com.oneuptime.androidagent.logs.EventLogDecoder
import com.oneuptime.androidagent.logs.LogcatCollector
import com.oneuptime.androidagent.logs.LogcatLine
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.testing.kioskFacts
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/*
 * The exact OTLP requests the agent sends for one kiosk, kept as files in
 * src/test/resources/otlp. OneUptime's own tests read the same files
 * (packages/App/Tests/Telemetry/AndroidDeviceAgentIngest.test.ts) and run
 * them through its real ingest code, so a change here that OneUptime would
 * file differently - as a RUM app instead of a host, or with its readings
 * lost - fails there.
 *
 * After changing what the agent sends on purpose, write the files again:
 *   ./gradlew :app:testDebugUnitTest --tests '*GoldenPayloadTest*' -PupdateGoldens=true
 */
class GoldenPayloadTest {
    private val now: Long = 1_795_076_857_467L
    private val boot: Long = now - 3 * 86_400_000L
    private val scope = Scope(AgentCore.SCOPE_NAME, "17.0.12")

    private val resource: List<Attribute> =
        DeviceResource.build(
            facts = kioskFacts(),
            identity =
                DeviceIdentity(
                    name = "store-0412-kiosk-02",
                    serial = "ELO123456",
                    type = "kiosk",
                    location = "Store 0412",
                    labels = linkedMapOf("store" to "0412", "region" to "emea"),
                ),
            ipAddresses = listOf("10.20.30.40", "fd00::40"),
            agentVersion = "17.0.12",
        )

    private val snapshot =
        DeviceSnapshot(
            timeMillis = now,
            bootTimeMillis = boot,
            uptimeSeconds = 3 * 86_400.0,
            logicalCpuCount = 8,
            cpuUtilization =
                linkedMapOf(
                    "cpu0" to linkedMapOf("user" to 0.3, "system" to 0.1, "idle" to 0.6),
                    "cpu1" to linkedMapOf("user" to 0.5, "system" to 0.2, "idle" to 0.3),
                ),
            loadAverage = null,
            memory = MemoryReading(totalBytes = 4_000_000_000L, availableBytes = 1_400_000_000L, freeBytes = 400_000_000L),
            filesystems = listOf(FilesystemReading("/dev/block/dm-40", "/data", "f2fs", "rw", 64_000_000_000L, 20_000_000_000L, 19_000_000_000L)),
            network = NetworkReading(5_000_000_000L, 800_000_000L, 4_000_000L, 1_500_000L),
            battery = BatteryReading(charge = 1.0, state = "full", plugged = "ac", temperatureCelsius = 31.5),
            thermal = ThermalReading(status = 0, headroom = 0.42),
            bootsInLastHour = 1,
            // The kiosk's patch level (2024-06-05), as the agent ages it at this time.
            securityPatchAgeDays = SecurityPatchAge.days(kioskFacts().securityPatch, now),
        )

    // A DropBox entry as the agent reads it: its text, filed at a time just before now.
    private fun dropBoxFault(tag: String, text: String, offsetMillis: Long): LogRecord =
        (DropBoxDecoder.decode(DropBoxEntry(tag, now - offsetMillis, text), millisToNanos(now)) as DropBoxFinding.Fault).record

    private fun metricsRequest(): JsonObject = OtlpJson.metricsRequest(resource, scope, HostMetrics.from(snapshot))

    private fun logsRequest(): JsonObject {
        val observed: Long = millisToNanos(now)
        val records: List<LogRecord> =
            listOf(
                AgentEvents.started(now, "17.0.12", ConfigSource.MANAGED, LogcatState.CRASHES_AND_ANRS, DropBoxState.READING),
                BootTracker.record(
                    BootEvent(BootInfo("e7a7ab81-d18d-41ea-9dbb-27082631f948", 42, boot), 86_400L, 125L, PreviousShutdown.CLEAN, 1),
                    now,
                    RebootFacts("reboot,userrequested", null, listOf("[86400.100000] reboot: Restarting system with command 'userrequested'")),
                ),
                // Every app's crashes from DropBox, with their stacks: these group by stack in Exceptions.
                dropBoxFault("data_app_crash", DropBoxFixtures.JAVA_CRASH, 3_000),
                dropBoxFault("data_app_anr", DropBoxFixtures.ANR, 2_000),
                dropBoxFault("data_app_native_crash", DropBoxFixtures.NATIVE_CRASH, 1_000),
                EventLogDecoder.decode(
                    LogcatLine(1_795_076_857_467_000_000L, "1000", 580, 1029, 'I', "am_crash", "[4242,0,com.example.kiosk,550026820,java.lang.IllegalStateException,Printer offline,Printer.kt,88,0]"),
                    observed,
                )!!,
                EventLogDecoder.decode(
                    LogcatLine(1_795_076_857_500_000_000L, "1000", 580, 1029, 'I', "am_anr", "[0,4242,com.example.kiosk,550026820,Input dispatching timed out (com.example.kiosk/.MainActivity is not responding. Waited 5001ms)]"),
                    observed,
                )!!,
                LogcatCollector.textRecord(
                    LogcatLine(1_795_076_857_600_000_000L, "10143", 4242, 4250, 'W', "KioskApp", "Receipt printer offline, retrying"),
                    "main",
                    observed,
                ) { uid -> if (uid == 10143) "com.example.kiosk" else null },
                // A line read in a log session OneUptime asked for, tagged with the session.
                LogcatCollector.textRecord(
                    LogcatLine(1_795_076_857_700_000_000L, "10143", 4242, 4250, 'I', "KioskApp", "Payment terminal handshake started"),
                    "main",
                    observed,
                    logSessionId = "9f8e7d6c-5b4a-4321-8765-0123456789ab",
                ) { uid -> if (uid == 10143) "com.example.kiosk" else null },
                AppInventoryTracker.inventoryRecord(
                    InstalledApp("com.example.kiosk", "4.2.0", 420, false, false, true, "io.shoonya.shoonyadpc", 1_790_000_000_000L, 1_794_000_000_000L),
                    now,
                ),
            )
        return OtlpJson.logsRequest(resource, scope, records)
    }

    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
    private val pretty =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
        }

    private fun check(name: String, actual: JsonObject) {
        val directory = File(System.getProperty("goldenDir") ?: "src/test/resources/otlp")
        val file = File(directory, name)
        if (System.getProperty("updateGoldens") == "true") {
            directory.mkdirs()
            file.writeText(pretty.encodeToString(JsonElement.serializer(), actual) + "\n")
        }
        val expected: JsonElement = Json.parseToJsonElement(file.readText())
        assertEquals(
            "$name differs from what the agent sends. If that change is intended, write it again with -PupdateGoldens=true and update OneUptime's ingest test.",
            expected,
            actual,
        )
    }

    @Test
    fun `the metrics request matches the one OneUptime's ingest tests read`() {
        check("android-agent-metrics.json", metricsRequest())
    }

    @Test
    fun `the logs request matches the one OneUptime's ingest tests read`() {
        check("android-agent-logs.json", logsRequest())
    }
}
