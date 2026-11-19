package com.oneuptime.androidagent

import android.os.SystemClock

/** The two clocks the agent reads, behind an interface so tests can set them. */
interface Clock {
    /** Wall-clock time, milliseconds since the epoch. */
    fun nowMillis(): Long

    /** Milliseconds since boot, deep sleep included: Android's uptime. */
    fun elapsedRealtimeMillis(): Long
}

object SystemClocks : Clock {
    override fun nowMillis(): Long = System.currentTimeMillis()

    override fun elapsedRealtimeMillis(): Long = SystemClock.elapsedRealtime()
}
