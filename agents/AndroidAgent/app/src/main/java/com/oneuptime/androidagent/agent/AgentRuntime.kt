package com.oneuptime.androidagent.agent

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings
import androidx.annotation.VisibleForTesting
import com.oneuptime.androidagent.BuildConfig
import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.SystemClocks
import com.oneuptime.androidagent.apps.AppInventoryTracker
import com.oneuptime.androidagent.apps.InstalledApps
import com.oneuptime.androidagent.boot.BootInfo
import com.oneuptime.androidagent.boot.BootTracker
import com.oneuptime.androidagent.collect.BootIdParser
import com.oneuptime.androidagent.collect.SnapshotCollector
import com.oneuptime.androidagent.config.ConfigRepository
import com.oneuptime.androidagent.config.KeyValueStore
import com.oneuptime.androidagent.config.KeystoreSecretCipher
import com.oneuptime.androidagent.config.LocalSettingsStore
import com.oneuptime.androidagent.config.SecretCipher
import com.oneuptime.androidagent.config.SharedPreferencesStore
import com.oneuptime.androidagent.config.TokenVault
import com.oneuptime.androidagent.device.AndroidDeviceFacts
import com.oneuptime.androidagent.device.DeviceFacts
import com.oneuptime.androidagent.logs.LogBuffer
import com.oneuptime.androidagent.logs.LogcatCollector
import com.oneuptime.androidagent.logs.PackageNameResolver
import com.oneuptime.androidagent.logs.ProcessLauncher
import com.oneuptime.androidagent.logs.ResumePoint
import com.oneuptime.androidagent.logs.ResumePointStore
import com.oneuptime.androidagent.transport.HttpUrlConnectionTransport
import com.oneuptime.androidagent.transport.Outbox
import com.oneuptime.androidagent.transport.Uploader
import java.io.File

/**
 * The agent's parts, made once per process and shared by the service, the
 * watchdog and the setup screen, so they all see one outbox and one state.
 */
class AgentRuntime private constructor(context: Context) {
    private val appContext: Context = context.applicationContext
    val clock: Clock = SystemClocks
    val facts: DeviceFacts = AndroidDeviceFacts.read(appContext)

    private val stateStore: KeyValueStore =
        SharedPreferencesStore(appContext.getSharedPreferences(STATE_PREFERENCES, Context.MODE_PRIVATE))
    private val settingsStore: KeyValueStore =
        SharedPreferencesStore(appContext.getSharedPreferences(LocalSettingsStore.PREFERENCES, Context.MODE_PRIVATE))

    val localSettings = LocalSettingsStore(settingsStore, TokenVault(settingsStore, secretCipher()))
    val configRepository = ConfigRepository(appContext, localSettings, facts)

    // noBackupFilesDir: the outbox is the device's own telemetry, never copied to another device by a backup.
    val outbox = Outbox(File(appContext.noBackupFilesDir, "outbox"), clock)
    val uploader = Uploader(outbox, HttpUrlConnectionTransport(userAgent()), clock)
    private val logBuffer = LogBuffer()
    val collector = SnapshotCollector(appContext, clock)

    val logcat =
        LogcatCollector(
            clock = clock,
            sdkInt = Build.VERSION.SDK_INT,
            launcher = ProcessLauncher.SYSTEM,
            packages = AndroidPackageNames(appContext.packageManager),
            currentBootId = ::bootId,
            buffer = logBuffer,
            resumePoints = PreferencesResumePointStore(stateStore),
        )

    val core =
        AgentCore(
            environment =
                AgentEnvironment(
                    loadConfig = configRepository::load,
                    collectSnapshot = collector::collect,
                    ipAddresses = { SnapshotCollector.ipAddresses(appContext) },
                    bootInfo = ::bootInfo,
                    installedApps = { InstalledApps.read(appContext.packageManager) },
                    readLogsGranted = ::readLogsGranted,
                    networkAvailable = ::networkAvailable,
                    updateLogcat = { config, granted -> logcat.update(config.logcatEnabled, granted, config.logcatMinLevel) },
                    stopLogcat = logcat::stopAll,
                    saveLogcatPosition = logcat::saveResumePoints,
                    takeDroppedLogcatRecord = logcat::takeDroppedLinesRecord,
                ),
            facts = facts,
            clock = clock,
            outbox = outbox,
            uploader = uploader,
            bootTracker = BootTracker(stateStore, clock),
            apps = AppInventoryTracker(stateStore, clock),
            logBuffer = logBuffer,
            agentVersion = BuildConfig.VERSION_NAME,
        )

    fun readLogsGranted(): Boolean =
        appContext.checkSelfPermission(Manifest.permission.READ_LOGS) == PackageManager.PERMISSION_GRANTED

    fun bootId(): String? = BootIdParser.parse(SnapshotCollector.readSmallFile(BOOT_ID_PATH))

    fun bootInfo(): BootInfo {
        val bootCount: Int? =
            try {
                Settings.Global.getInt(appContext.contentResolver, Settings.Global.BOOT_COUNT, -1).takeIf { it >= 0 }
            } catch (_: RuntimeException) {
                null
            }
        return BootInfo(
            bootId = bootId(),
            bootCount = bootCount,
            bootTimeMillis = clock.nowMillis() - clock.elapsedRealtimeMillis(),
        )
    }

    private fun networkAvailable(): Boolean =
        try {
            val connectivity: ConnectivityManager? = appContext.getSystemService(ConnectivityManager::class.java)
            val capabilities: NetworkCapabilities? = connectivity?.activeNetwork?.let { connectivity.getNetworkCapabilities(it) }
            capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        } catch (_: RuntimeException) {
            // Better to try and fail than to stop sending on a check that failed.
            true
        }

    private fun userAgent(): String = "OneUptimeAndroidAgent/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; API ${Build.VERSION.SDK_INT})"

    companion object {
        private const val STATE_PREFERENCES: String = "oneuptime_agent_state"
        const val BOOT_ID_PATH: String = "/proc/sys/kernel/random/boot_id"

        @Volatile
        private var instance: AgentRuntime? = null

        // The Android Keystore on a device; Robolectric has none, so its tests set a software key.
        @VisibleForTesting
        @Volatile
        var secretCipher: () -> SecretCipher = { KeystoreSecretCipher() }

        fun get(context: Context): AgentRuntime =
            instance ?: synchronized(this) {
                instance ?: AgentRuntime(context).also { instance = it }
            }

        @VisibleForTesting
        fun resetForTests() {
            synchronized(this) {
                instance?.logcat?.stopAll()
                instance = null
                secretCipher = { KeystoreSecretCipher() }
            }
        }
    }
}

/** Package names by uid, cached: Logcat names the writer of each line by its uid. */
class AndroidPackageNames(private val packageManager: PackageManager) : PackageNameResolver {
    private val cache: MutableMap<Int, String?> = mutableMapOf()

    @Synchronized
    override fun packageForUid(uid: Int): String? {
        if (cache.size > MAX_CACHED) {
            cache.clear()
        }
        return cache.getOrPut(uid) {
            try {
                packageManager.getPackagesForUid(uid)?.sorted()?.firstOrNull()
            } catch (_: RuntimeException) {
                null
            }
        }
    }

    companion object {
        private const val MAX_CACHED: Int = 512
    }
}

/** Where each Logcat session got to, in the agent's state preferences. */
class PreferencesResumePointStore(private val store: KeyValueStore) : ResumePointStore {
    override fun load(session: String): ResumePoint? {
        val time: Long = store.getLong("logcat.$session.time") ?: return null
        return ResumePoint(store.getString("logcat.$session.boot"), time)
    }

    override fun save(session: String, point: ResumePoint) {
        store.edit {
            putString("logcat.$session.boot", point.bootId)
            putLong("logcat.$session.time", point.timeUnixNano)
        }
    }
}
