package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.apps.AppInventoryTracker
import com.oneuptime.androidagent.apps.InstalledApp
import com.oneuptime.androidagent.boot.BootInfo
import com.oneuptime.androidagent.boot.BootTracker
import com.oneuptime.androidagent.collect.DeviceSnapshot
import com.oneuptime.androidagent.collect.HostMetrics
import com.oneuptime.androidagent.config.AgentConfig
import com.oneuptime.androidagent.config.OtlpEndpoint
import com.oneuptime.androidagent.device.DeviceFacts
import com.oneuptime.androidagent.logs.LogBuffer
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.otlp.Attribute
import com.oneuptime.androidagent.otlp.DeviceResource
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.OtlpJson
import com.oneuptime.androidagent.otlp.Scope
import com.oneuptime.androidagent.transport.Outbox
import com.oneuptime.androidagent.transport.Signal
import com.oneuptime.androidagent.transport.Uploader

/** What the agent needs from the device, as functions so the core runs the same in a unit test. */
class AgentEnvironment(
    val loadConfig: () -> AgentConfig,
    val collectSnapshot: () -> DeviceSnapshot,
    val ipAddresses: () -> List<String>,
    val bootInfo: () -> BootInfo,
    val installedApps: () -> List<InstalledApp>,
    val readLogsGranted: () -> Boolean,
    val networkAvailable: () -> Boolean,
    // Starts or stops Logcat collection to match the settings; returns what it now collects.
    val updateLogcat: (config: AgentConfig, granted: Boolean) -> LogcatState,
    val stopLogcat: () -> Unit,
    val saveLogcatPosition: () -> Unit,
    val takeDroppedLogcatRecord: () -> LogRecord?,
)

/** How the last cycle went, for the notification and the setup screen. */
data class CycleResult(
    val config: AgentConfig,
    val collected: Boolean,
    val uploaded: Boolean,
    val logcat: LogcatState?,
)

/**
 * One cycle of the agent - collect, queue, send - and what it does when the
 * device boots or shuts down. The service runs a cycle every collection
 * interval; the watchdog runs one when the service cannot run.
 *
 * Every cycle writes what it collected to the [Outbox] before it tries to
 * send anything, so nothing collected is lost to a failed upload.
 */
class AgentCore(
    private val environment: AgentEnvironment,
    private val facts: DeviceFacts,
    private val clock: Clock,
    private val outbox: Outbox,
    private val uploader: Uploader,
    private val bootTracker: BootTracker,
    private val apps: AppInventoryTracker,
    private val logBuffer: LogBuffer,
    private val agentVersion: String,
) {
    private val scope = Scope(SCOPE_NAME, agentVersion)
    private var announcedStart: Boolean = false
    private var lastLogcatState: LogcatState? = null
    private var lastAppsCheckElapsed: Long? = null

    // Set by the service's package receiver on the main thread, read by the cycle.
    @Volatile
    private var appsCheckRequested: Boolean = false
    private var lastEndpointAndToken: Pair<OtlpEndpoint?, String?>? = null

    @Volatile
    var lastCycle: CycleResult? = null
        private set

    @Volatile
    var lastCollectionAtMillis: Long? = null
        private set

    /** Asks the next cycle to read the installed apps, as when a package was installed or removed. */
    fun requestAppsCheck() {
        appsCheckRequested = true
    }

    @Synchronized
    fun cycle(byService: Boolean): CycleResult {
        val config: AgentConfig = environment.loadConfig()

        // New settings may well fix what failed: try again at once rather than after the wait.
        val settings: Pair<OtlpEndpoint?, String?> = config.endpoint to config.token
        if (lastEndpointAndToken != null && lastEndpointAndToken != settings) {
            uploader.resetBackoff()
        }
        lastEndpointAndToken = settings

        if (!config.isReady) {
            environment.stopLogcat()
            // Boots are still recorded, so the first report after setup knows the device's history.
            bootTracker.observe(environment.bootInfo())
            return CycleResult(config, collected = false, uploaded = false, logcat = null).also { lastCycle = it }
        }

        val now: Long = clock.nowMillis()
        val resource: List<Attribute> = DeviceResource.build(facts, config.identity, environment.ipAddresses(), agentVersion)
        val records: MutableList<LogRecord> = mutableListOf()

        bootTracker.observe(environment.bootInfo())?.let { records.add(BootTracker.record(it, now)) }

        val logcat: LogcatState = environment.updateLogcat(config, environment.readLogsGranted())
        if (!announcedStart) {
            records.add(AgentEvents.started(now, agentVersion, config.source, logcat))
            announcedStart = true
        } else if (logcat != lastLogcatState) {
            records.add(AgentEvents.logcatChanged(now, logcat))
        }
        lastLogcatState = logcat

        val snapshot: DeviceSnapshot = environment.collectSnapshot()
        outbox.add(Signal.METRICS, OtlpJson.metricsRequest(resource, scope, HostMetrics.from(snapshot)).toString())
        lastCollectionAtMillis = snapshot.timeMillis
        bootTracker.recordAlive(byService)

        if (config.installedAppsEnabled && appsCheckDue()) {
            records.addAll(apps.check(environment.installedApps()))
        }

        records.addAll(logBuffer.drain())
        environment.takeDroppedLogcatRecord()?.let { records.add(it) }
        val droppedBatches: Long = outbox.takeDroppedBatches()
        if (droppedBatches > 0) {
            records.add(AgentEvents.droppedBatches(now, droppedBatches))
        }
        queueLogs(resource, records)
        environment.saveLogcatPosition()

        val uploaded: Boolean = upload(config)
        return CycleResult(config, collected = true, uploaded = uploaded, logcat = logcat).also { lastCycle = it }
    }

    /** Sends what is waiting, when there is a network to send it on. */
    @Synchronized
    fun upload(config: AgentConfig = environment.loadConfig()): Boolean {
        val endpoint: OtlpEndpoint = config.endpoint ?: return false
        val token: String = config.token?.takeIf { it.isNotBlank() } ?: return false
        if (!environment.networkAvailable()) {
            return false
        }
        return uploader.drain(endpoint, token)
    }

    /**
     * The device is shutting down: record it, and put everything still in
     * memory on disk, to be sent after the next boot. Called on the main
     * thread with seconds to spare, so nothing here touches the network.
     */
    @Synchronized
    fun onShutdown() {
        val config: AgentConfig = environment.loadConfig()
        val shutdown: LogRecord = bootTracker.recordShutdown()
        if (!config.isReady) {
            return
        }
        val resource: List<Attribute> = DeviceResource.build(facts, config.identity, emptyList(), agentVersion)
        queueLogs(resource, logBuffer.drain() + shutdown)
        environment.saveLogcatPosition()
    }

    private fun appsCheckDue(): Boolean {
        val elapsed: Long = clock.elapsedRealtimeMillis()
        val last: Long? = lastAppsCheckElapsed
        val due: Boolean = appsCheckRequested || last == null || elapsed - last >= APPS_CHECK_INTERVAL_MILLIS || elapsed < last
        if (due) {
            lastAppsCheckElapsed = elapsed
            appsCheckRequested = false
        }
        return due
    }

    private fun queueLogs(resource: List<Attribute>, records: List<LogRecord>) {
        records.chunked(MAX_RECORDS_PER_BATCH).forEach { chunk ->
            outbox.add(Signal.LOGS, OtlpJson.logsRequest(resource, scope, chunk).toString())
        }
    }

    companion object {
        const val SCOPE_NAME: String = "oneuptime-android-agent"
        const val APPS_CHECK_INTERVAL_MILLIS: Long = 15 * 60_000
        const val MAX_RECORDS_PER_BATCH: Int = 2_000
    }
}
