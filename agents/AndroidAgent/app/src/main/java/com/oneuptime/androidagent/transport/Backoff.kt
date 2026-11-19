package com.oneuptime.androidagent.transport

import kotlin.random.Random

/**
 * How long to wait before trying OneUptime again: twice as long after each
 * failure in a row, from [baseMillis] up to [maxMillis], with half of it
 * random so a fleet that lost its network together does not come back in one
 * wave. A `Retry-After` the server sent is waited at least, up to an hour.
 */
class Backoff(
    private val baseMillis: Long = 15_000,
    private val maxMillis: Long = 15 * 60_000,
    private val random: Random = Random.Default,
) {
    fun delayMillis(failures: Int, retryAfterMillis: Long? = null): Long {
        val exponent: Int = (failures - 1).coerceIn(0, 30)
        val ceiling: Long = (baseMillis shl exponent.coerceAtMost(20)).coerceIn(baseMillis, maxMillis)
        val half: Long = ceiling / 2
        val jittered: Long = half + random.nextLong(half + 1)
        val serverAsked: Long = retryAfterMillis?.coerceIn(0, MAX_RETRY_AFTER_MILLIS) ?: 0
        return maxOf(jittered, serverAsked)
    }

    companion object {
        const val MAX_RETRY_AFTER_MILLIS: Long = 60 * 60_000
    }
}
