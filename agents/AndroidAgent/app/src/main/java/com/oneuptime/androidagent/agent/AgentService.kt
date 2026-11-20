package com.oneuptime.androidagent.agent

import android.app.Notification
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The agent, running: a foreground service that collects every collection
 * interval (a minute by default) and sends what it collected.
 *
 * Why a foreground service, and not only WorkManager: WorkManager runs
 * periodic work at most every 15 minutes, while OneUptime's Host Stopped
 * Reporting alert looks for a report every 10, and Logcat has to be read as
 * it is written. The service holds no wake lock: when the device sleeps, the
 * agent sleeps with it, and catches up when it wakes.
 *
 * It is started at boot (BootReceiver), when the app is updated, when the
 * setup screen opens, and by the watchdog (WatchdogWorker) if it ever stops.
 */
class AgentService : Service() {
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val wake: Channel<Unit> = Channel(Channel.CONFLATED)
    private var loop: Job? = null
    private var lastStatus: AgentStatus? = null
    private lateinit var runtime: AgentRuntime

    // The notification's words, in the device's language.
    private val strings: StringSource by lazy { ContextStrings(this) }

    private val receiver: BroadcastReceiver =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    // The device manager pushed new settings: use them now.
                    Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED -> wake.trySend(Unit)
                    Intent.ACTION_SHUTDOWN -> runtime.core.onShutdown()
                    Intent.ACTION_PACKAGE_ADDED, Intent.ACTION_PACKAGE_REMOVED, Intent.ACTION_PACKAGE_REPLACED ->
                        runtime.core.requestAppsCheck()
                }
            }
        }

    private val networkCallback =
        object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Back online: send what was kept while offline, without waiting for the next collection.
                scope.launch { runCatching { runtime.core.upload() } }
            }
        }

    override fun onCreate() {
        super.onCreate()
        running = true
        runtime = AgentRuntime.get(this)
        enterForeground(AgentStatusText.of(strings, runtime.configRepository.load(), runtime.uploader.status, 0))

        ContextCompat.registerReceiver(
            this,
            receiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED)
                addAction(Intent.ACTION_SHUTDOWN)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        ContextCompat.registerReceiver(
            this,
            receiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_PACKAGE_ADDED)
                addAction(Intent.ACTION_PACKAGE_REMOVED)
                addAction(Intent.ACTION_PACKAGE_REPLACED)
                addDataScheme("package")
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        try {
            getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(networkCallback)
        } catch (error: RuntimeException) {
            Log.w(TAG, "Could not watch the network: ${error.message}")
        }

        WatchdogWorker.schedule(this)
        loop = scope.launch { runLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Every start by startForegroundService must be answered with startForeground.
        enterForeground(lastStatus ?: AgentStatusText.of(strings, runtime.configRepository.load(), runtime.uploader.status, 0))
        if (intent?.action == ACTION_COLLECT_NOW) {
            wake.trySend(Unit)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        running = false
        loop?.cancel()
        scope.cancel()
        runCatching { unregisterReceiver(receiver) }
        runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(networkCallback) }
        runtime.logcat.saveResumePoints()
        runtime.logcat.stopAll()
        super.onDestroy()
    }

    private suspend fun runLoop() {
        while (scope.isActive) {
            val result: CycleResult? =
                try {
                    runtime.core.cycle(byService = true)
                } catch (error: Exception) {
                    // A cycle that fails is logged and the next one runs: the agent never stops on its own.
                    Log.e(TAG, "Collection cycle failed", error)
                    null
                }
            val config = result?.config ?: runtime.configRepository.load()
            showStatus(AgentStatusText.of(strings, config, runtime.uploader.status, runtime.outbox.totalBytes()))
            withTimeoutOrNull(config.collectionIntervalSeconds * 1000L) { wake.receive() }
        }
    }

    private fun showStatus(status: AgentStatus) {
        if (status == lastStatus) {
            return
        }
        lastStatus = status
        try {
            NotificationManagerCompat.from(this).notify(AgentNotifications.NOTIFICATION_ID, AgentNotifications.build(this, status))
        } catch (_: SecurityException) {
            // Notifications are not allowed (Android 13+ without POST_NOTIFICATIONS): the service runs regardless.
        }
    }

    private fun enterForeground(status: AgentStatus) {
        lastStatus = status
        val notification: Notification = AgentNotifications.build(this, status)
        val type: Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, AgentNotifications.NOTIFICATION_ID, notification, type)
    }

    companion object {
        private const val TAG: String = "OneUptimeAgent"
        const val ACTION_COLLECT_NOW: String = "com.oneuptime.androidagent.action.COLLECT_NOW"

        @Volatile
        var running: Boolean = false
            private set
    }
}
