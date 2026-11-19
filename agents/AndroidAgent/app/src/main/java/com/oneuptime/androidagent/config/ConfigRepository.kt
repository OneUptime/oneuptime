package com.oneuptime.androidagent.config

import android.content.Context
import android.content.RestrictionsManager
import android.os.Bundle
import com.oneuptime.androidagent.device.DeviceFacts

/**
 * The setup screen's settings: the URL and the device's name in plain
 * SharedPreferences, the ingestion key sealed in the [TokenVault].
 */
class LocalSettingsStore(private val store: KeyValueStore, private val vault: TokenVault) {
    fun read(): LocalSettings =
        LocalSettings(
            oneUptimeUrl = store.getString(KEY_URL),
            token = (vault.read() as? StoredToken.Present)?.token,
            deviceName = store.getString(KEY_DEVICE_NAME),
        )

    /** Whether a key was stored that can no longer be read, so it must be entered again. */
    fun tokenIsUnreadable(): Boolean = vault.read() == StoredToken.Unreadable

    fun save(url: String?, token: String?, deviceName: String?) {
        store.edit {
            putString(KEY_URL, url?.trim()?.takeIf { it.isNotEmpty() })
            putString(KEY_DEVICE_NAME, deviceName?.trim()?.takeIf { it.isNotEmpty() })
        }
        val trimmedToken: String? = token?.trim()?.takeIf { it.isNotEmpty() }
        if (trimmedToken != null) {
            vault.save(trimmedToken)
        }
    }

    fun clearToken() {
        vault.clear()
    }

    companion object {
        const val PREFERENCES: String = "oneuptime_agent_settings"
        const val KEY_URL: String = "oneuptime_url"
        const val KEY_DEVICE_NAME: String = "device_name"
    }
}

/** Reads the agent's settings on the device: the managed configuration, then the setup screen's. */
class ConfigRepository(
    private val context: Context,
    private val local: LocalSettingsStore,
    private val facts: DeviceFacts,
) {
    fun managedSettings(): ManagedSettings {
        val bundle: Bundle =
            try {
                context.getSystemService(RestrictionsManager::class.java)?.applicationRestrictions ?: Bundle.EMPTY
            } catch (_: RuntimeException) {
                Bundle.EMPTY
            }
        return ManagedConfigParser.parse(bundle.toMap())
    }

    fun load(): AgentConfig = ConfigResolver.resolve(managedSettings(), local.read(), facts)

    companion object {
        @Suppress("DEPRECATION")
        fun Bundle.toMap(): Map<String, Any?> = keySet().associateWith { key -> get(key) }
    }
}
