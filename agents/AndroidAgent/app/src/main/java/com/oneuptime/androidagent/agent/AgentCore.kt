package com.oneuptime.androidagent.agent

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.apps.AppInventoryTracker
import com.oneuptime.androidagent.apps.InstalledApp
import com.oneuptime.androidagent.boot.BootInfo
import com.oneuptime.androidagent.boot.BootTracker
import com.oneuptime.androidagent.boot.RebootFacts
import com.oneuptime.androidagent.collect.CollectorCapabilities
import com.oneuptime.androidagent.collect.CpuSource
import com.oneuptime.androidagent.collect.CpuUnavailable
import com.oneuptime.androidagent.collect.DeviceSnapshot
import com.oneuptime.androidagent.collect.HostMetrics
import com.oneuptime.androidagent.config.AgentConfig
import com.oneuptime.androidagent.config.OtlpEndpoint
import com.oneuptime.androidagent.device.DeviceFacts
import com.oneuptime.androidagent.device.SecurityPatchAge
import com.oneuptime.androidagent.dropbox.DropBoxFinding
import com.oneuptime.androidagent.dropbox.DropBoxRead
import com.oneuptime.androidagent.dropbox.DropBoxState
import com.oneuptime.androidagent.dropbox.LastKernelLog
import com.oneuptime.androidagent.logs.LogBuffer
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.logs.Redactor
import com.oneuptime.androidagent.logsession.LogSessionClient
import com.oneuptime.androidagent.logsession.LogSessionDevice
import com.oneuptime.androidagent.logsession.LogSessionExchange
import com.oneuptime.androidagent.logsession.LogSessionManager
import com.oneuptime.androidagent.logsession.LogSessionReport
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
    // Reads DropBox's new entries: every app's crash stacks, native crashes, ANRs, and the reboots' reasons.
    val readDropBox: (config: AgentConfig) -> DropBoxRead = { DropBoxRead(DropBoxState.DISABLED, emptyList(), emptyList()) },
    val takeDroppedDropBoxRecord: () -> LogRecord? = { null },
    // Where the last snapshot's CPU use came from, or why there was none (SnapshotCollector.capabilities).
    val cpuReading: () -> CollectorCapabilities? = { null },
    // The grants the agent still lacks here (AgentPermissions), for the resource; null when unknown.
    val missingPermissions: (config: AgentConfig) -> List<AgentGrant>? = { null },
)

/** How the last cycle went, for the notification and the setup screen. */
data class CycleResult(
    val config: AgentConfig,
    val collected: Boolean,
    val uploaded: Boolean,
    val logcat: LogcatState?,
    val dropBox: DropBoxState? = null,
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
    // The log sessions OneUptime asks the device for, and the client that fetches them; none in most tests.
    private val logSessions: LogSessionManager? = null,
    private val logSessionClient: LogSessionClient? = null,
    private val canSendSessionLogs: () -> Boolean = { false },
) {
    private val scope = Scope(SCOPE_NAME, agentVersion)
    private var announcedStart: Boolean = false
    private var lastLogcatState: LogcatState? = null
    private var lastDropBoxState: DropBoxState? = null
    private var lastCpuReading: Pair<CpuSource, CpuUnavailable?>? = null
    private var lastAppsCheckElapsed: Long? = null

    // What DropBox said of recent boots, kept until the boot's record goes out with it.
    private val bootFindings: ArrayDeque<DropBoxFinding.Boot> = ArrayDeque()

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
        val resource: List<Attribute> =
            DeviceResource.build(facts, config.identity, environment.ipAddresses(), agentVersion, environment.missingPermissions(config))
        val records: MutableList<LogRecord> = mutableListOf()

        // DropBox first: what it says of the last reboot goes on the boot's own record.
        val dropBox: DropBoxRead = environment.readDropBox(config)
        records.addAll(dropBox.records)
        rememberBootFindings(dropBox.boots)

        val bootInfo: BootInfo = environment.bootInfo()
        if (!waitForRebootFacts(dropBox.state, bootInfo)) {
            bootTracker.observe(bootInfo)?.let { event ->
                records.add(BootTracker.record(event, now, rebootFactsFor(event.boot)))
            }
        }

        val logcat: LogcatState = environment.updateLogcat(config, environment.readLogsGranted())
        if (!announcedStart) {
            records.add(AgentEvents.started(now, agentVersion, config.source, logcat, dropBox.state))
            announcedStart = true
        } else {
            if (logcat != lastLogcatState) {
                records.add(AgentEvents.logcatChanged(now, logcat))
            }
            if (dropBox.state != lastDropBoxState) {
                records.add(AgentEvents.dropBoxChanged(now, dropBox.state))
            }
        }
        lastLogcatState = logcat
        lastDropBoxState = dropBox.state

        val snapshot: DeviceSnapshot =
            environment.collectSnapshot().copy(
                bootsInLastHour = bootTracker.bootsInLastHour(now),
                securityPatchAgeDays = SecurityPatchAge.days(facts.securityPatch, now),
            )
        outbox.add(Signal.METRICS, OtlpJson.metricsRequest(resource, scope, HostMetrics.from(snapshot)).toString())
        lastCollectionAtMillis = snapshot.timeMillis

        /*
         * Where CPU use comes from, said once and again when it changes: a
         * fleet whose devices send none sees why in OneUptime, not only on
         * each device's screen (#9803).
         */
        environment.cpuReading()?.let { cpu ->
            val reading: Pair<CpuSource, CpuUnavailable?> = cpu.cpuSource to cpu.cpuUnavailable
            if (reading != lastCpuReading) {
                records.add(AgentEvents.cpu(now, cpu.cpuSource, cpu.cpuUnavailable))
                lastCpuReading = reading
            }
        }
        bootTracker.recordAlive(byService)

        if (config.installedAppsEnabled && appsCheckDue()) {
            records.addAll(apps.check(environment.installedApps()))
        }

        // Sessions move on before the buffer is drained, so what they record goes out in this cycle.
        logSessions?.tick()
        records.addAll(logBuffer.drain())
        environment.takeDroppedLogcatRecord()?.let { records.add(it) }
        environment.takeDroppedDropBoxRecord()?.let { records.add(it) }
        val droppedBatches: Long = outbox.takeDroppedBatches()
        if (droppedBatches > 0) {
            records.add(AgentEvents.droppedBatches(now, droppedBatches))
        }
        queueLogs(resource, records)
        environment.saveLogcatPosition()

        val uploaded: Boolean = upload(config)
        exchangeLogSessions(config)
        return CycleResult(config, collected = true, uploaded = uploaded, logcat = logcat, dropBox = dropBox.state).also { lastCycle = it }
    }

    /**
     * Asks OneUptime for the log sessions waiting for this device, and tells
     * it what became of the ones it has (LogSessionManager). Every cycle, so
     * a request reaches the device within a minute; never without a network.
     */
    @Synchronized
    fun exchangeLogSessions(config: AgentConfig = environment.loadConfig()) {
        val manager: LogSessionManager = logSessions ?: return
        val client: LogSessionClient = logSessionClient ?: return
        val endpoint: OtlpEndpoint = config.endpoint ?: return
        val token: String = config.token?.takeIf { it.isNotBlank() } ?: return
        manager.tick()
        if (!environment.networkAvailable() || client.isPaused()) {
            return
        }
        val reports: List<LogSessionReport> = manager.reportsToSend()
        val device = LogSessionDevice(config.identity.name, facts.sdkInt, agentVersion, canSendSessionLogs())
        val result: LogSessionExchange = client.exchange(endpoint, token, device, reports)
        if (result is LogSessionExchange.Answered) {
            manager.onReported(reports)
            manager.onServerSessions(result.sessions)
            manager.tick()
        }
    }

    /*
     * Android writes a boot's DropBox entries - SYSTEM_BOOT, then the kernel's
     * last log with the reboot's reason - a few seconds after the boot,
     * about when the agent starts. When the agent can read DropBox, a new
     * boot's record waits for them, for up to the first three minutes of
     * uptime, so it says why the device rebooted. It is only recorded then,
     * so a restart of the agent meanwhile does not lose it.
     */
    private fun waitForRebootFacts(dropBox: DropBoxState, boot: BootInfo): Boolean =
        dropBox == DropBoxState.READING &&
            clock.elapsedRealtimeMillis() < BOOT_FACTS_WAIT_MILLIS &&
            bootTracker.isNew(boot) &&
            bootFindings.none { it.timeMillis >= boot.bootTimeMillis - BOOT_FACTS_SLACK_MILLIS }

    private fun rememberBootFindings(boots: List<DropBoxFinding.Boot>) {
        for (finding in boots) {
            bootFindings.addLast(finding)
            while (bootFindings.size > MAX_BOOT_FINDINGS) {
                bootFindings.removeFirst()
            }
        }
    }

    // What the kernel's last log said of the reboot before [boot], from the entry Android wrote at that boot.
    private fun rebootFactsFor(boot: BootInfo): RebootFacts? {
        val log: LastKernelLog =
            bootFindings.lastOrNull { it.kernelLog != null && it.timeMillis >= boot.bootTimeMillis - BOOT_FACTS_SLACK_MILLIS }?.kernelLog
                ?: return null
        return RebootFacts(
            reason = log.bootReason,
            kernelPanic = log.panic?.let { Redactor.redact(it) },
            lastKernelLines = log.lastLines.map { Redactor.redact(it) },
        )
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
        const val BOOT_FACTS_WAIT_MILLIS: Long = 3 * 60_000
        private const val BOOT_FACTS_SLACK_MILLIS: Long = 60_000
        private const val MAX_BOOT_FINDINGS: Int = 8
    }
}
