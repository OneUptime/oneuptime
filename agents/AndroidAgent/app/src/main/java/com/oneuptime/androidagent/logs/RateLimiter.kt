package com.oneuptime.androidagent.logs

/**
 * A token bucket: up to [capacity] at once, refilled at [perSecond]. It keeps
 * a device whose apps start logging in a loop from sending gigabytes, while
 * a burst - the backlog read after a restart, a busy minute - still goes
 * through.
 */
class RateLimiter(
    private val capacity: Double,
    private val perSecond: Double,
    private val elapsedMillis: () -> Long,
) {
    private var tokens: Double = capacity
    private var lastRefill: Long = elapsedMillis()

    @Synchronized
    fun tryAcquire(): Boolean {
        val now: Long = elapsedMillis()
        if (now > lastRefill) {
            tokens = (tokens + (now - lastRefill) / 1000.0 * perSecond).coerceAtMost(capacity)
        }
        lastRefill = now
        if (tokens >= 1.0) {
            tokens -= 1.0
            return true
        }
        return false
    }
}
