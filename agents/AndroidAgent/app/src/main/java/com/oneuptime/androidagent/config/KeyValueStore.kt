package com.oneuptime.androidagent.config

import android.annotation.SuppressLint
import android.content.SharedPreferences

/**
 * The little the agent keeps between runs: its settings, its state. An
 * interface so the code that reads and writes it is tested without Android.
 */
interface KeyValueStore {
    fun getString(key: String): String?

    fun getLong(key: String): Long?

    fun edit(block: Editor.() -> Unit)

    interface Editor {
        fun putString(key: String, value: String?)

        fun putLong(key: String, value: Long?)
    }
}

/** A [KeyValueStore] in memory, for tests and for a store that cannot be read. */
class MemoryKeyValueStore : KeyValueStore {
    private val values: MutableMap<String, Any> = mutableMapOf()

    @Synchronized
    override fun getString(key: String): String? = values[key] as? String

    @Synchronized
    override fun getLong(key: String): Long? = values[key] as? Long

    @Synchronized
    override fun edit(block: KeyValueStore.Editor.() -> Unit) {
        val editor =
            object : KeyValueStore.Editor {
                override fun putString(key: String, value: String?) {
                    if (value == null) values.remove(key) else values[key] = value
                }

                override fun putLong(key: String, value: Long?) {
                    if (value == null) values.remove(key) else values[key] = value
                }
            }
        editor.block()
    }
}

/**
 * A [KeyValueStore] in SharedPreferences. Writes are committed at once, not
 * applied in the background: the agent writes rarely, and a shutdown that
 * follows a write must not lose it.
 */
class SharedPreferencesStore(private val preferences: SharedPreferences) : KeyValueStore {
    override fun getString(key: String): String? = preferences.getString(key, null)

    override fun getLong(key: String): Long? = if (preferences.contains(key)) preferences.getLong(key, 0L) else null

    // commit, not apply: a write made as the device shuts down must reach the disk before it does.
    @SuppressLint("ApplySharedPref")
    override fun edit(block: KeyValueStore.Editor.() -> Unit) {
        val editor: SharedPreferences.Editor = preferences.edit()
        val wrapper =
            object : KeyValueStore.Editor {
                override fun putString(key: String, value: String?) {
                    if (value == null) editor.remove(key) else editor.putString(key, value)
                }

                override fun putLong(key: String, value: Long?) {
                    if (value == null) editor.remove(key) else editor.putLong(key, value)
                }
            }
        wrapper.block()
        editor.commit()
    }
}
