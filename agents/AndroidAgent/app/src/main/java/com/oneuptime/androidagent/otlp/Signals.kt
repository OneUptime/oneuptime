package com.oneuptime.androidagent.otlp

/** A data point's value: OTLP keeps integers and doubles apart. */
sealed interface NumberValue {
    data class Whole(val value: Long) : NumberValue

    data class Fraction(val value: Double) : NumberValue
}

data class NumberPoint(
    val value: NumberValue,
    val timeUnixNano: Long,
    val attributes: List<Attribute> = emptyList(),
    // When a cumulative sum started counting: the device's boot, for the agent.
    val startTimeUnixNano: Long? = null,
)

sealed interface MetricData {
    val points: List<NumberPoint>

    data class Gauge(override val points: List<NumberPoint>) : MetricData

    /**
     * A sum, always cumulative: each point is the total since its start
     * time, as the hostmetrics receiver sends its own (a counter of bytes
     * since boot, or an up-down count of bytes in use).
     */
    data class Sum(override val points: List<NumberPoint>, val isMonotonic: Boolean) : MetricData
}

data class Metric(
    val name: String,
    val unit: String,
    val description: String,
    val data: MetricData,
)

/** OTLP's log severity numbers, and the text OneUptime shows for each. */
enum class Severity(val number: Int, val text: String) {
    TRACE(1, "TRACE"),
    DEBUG(5, "DEBUG"),
    INFO(9, "INFO"),
    WARN(13, "WARN"),
    ERROR(17, "ERROR"),
    FATAL(21, "FATAL"),
}

data class LogRecord(
    val timeUnixNano: Long,
    val observedTimeUnixNano: Long,
    val severity: Severity,
    val body: String,
    val attributes: List<Attribute> = emptyList(),
)

/** The instrumentation scope every payload names: this agent. */
data class Scope(val name: String, val version: String)

/** Milliseconds since the epoch, as OTLP's nanoseconds. */
fun millisToNanos(millis: Long): Long = millis * 1_000_000L
