package com.oneuptime.androidagent.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Starts the agent's service. */
object AgentStarter {
    private const val TAG: String = "OneUptimeAgent"

    /**
     * Starts the foreground service, and returns whether Android let it.
     * From Android 12 an app in the background may start one only in a few
     * cases (at boot, after an update, from its own screen, when exempt from
     * battery optimizations); otherwise this returns false and the caller
     * does the work itself.
     */
    fun startService(context: Context, collectNow: Boolean = false): Boolean =
        try {
            val intent = Intent(context, AgentService::class.java)
            if (collectNow) {
                intent.action = AgentService.ACTION_COLLECT_NOW
            }
            ContextCompat.startForegroundService(context, intent)
            true
        } catch (error: IllegalStateException) {
            // ForegroundServiceStartNotAllowedException (Android 12+) is one of these.
            Log.w(TAG, "Android did not let the agent start its service now: ${error.message}")
            false
        } catch (error: SecurityException) {
            Log.w(TAG, "Android did not let the agent start its service now: ${error.message}")
            false
        }

    /** Starts the service and makes sure the watchdog is scheduled. */
    fun start(context: Context, collectNow: Boolean = false): Boolean {
        WatchdogWorker.schedule(context)
        return startService(context, collectNow)
    }
}

/**
 * Starts the agent when the device has booted and when the app has been
 * updated - the two moments Android lets an app start a foreground service
 * from the background on every version.
 *
 * An app a device manager has just installed hears neither until it has been
 * opened once (Android keeps new apps "stopped"), which is why the docs say
 * to open it once, or have the device manager launch it.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> AgentStarter.start(context)
        }
    }
}

/**
 * Every 15 minutes, makes sure the agent is running. If its service has
 * stopped and Android will not let it be started from the background, the
 * watchdog collects and sends one report itself, so the device keeps
 * reporting, every 15 minutes instead of every minute. WorkManager keeps
 * this schedule across reboots on its own.
 */
class WatchdogWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        if (AgentService.running) {
            return Result.success()
        }
        if (AgentStarter.startService(applicationContext)) {
            return Result.success()
        }
        withContext(Dispatchers.IO) {
            try {
                AgentRuntime.get(applicationContext).core.cycle(byService = false)
            } catch (error: Exception) {
                Log.e("OneUptimeAgent", "Watchdog collection failed", error)
            }
        }
        return Result.success()
    }

    companion object {
        const val UNIQUE_NAME: String = "oneuptime-agent-watchdog"

        fun schedule(context: Context) {
            try {
                val request: PeriodicWorkRequest = PeriodicWorkRequestBuilder<WatchdogWorker>(15, TimeUnit.MINUTES).build()
                WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
            } catch (error: IllegalStateException) {
                Log.w("OneUptimeAgent", "Could not schedule the watchdog: ${error.message}")
            }
        }
    }
}
