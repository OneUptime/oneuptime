package com.oneuptime.androidagent.otlp

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * OTLP/HTTP JSON (the protobuf messages in the proto3 JSON mapping), the
 * format OneUptime's /otlp/v1/metrics and /otlp/v1/logs accept with
 * `Content-Type: application/json`:
 *
 *   - 64-bit integers (`asInt`, `intValue`, every `*UnixNano`) are strings;
 *   - enums are their numbers (`aggregationTemporality: 2` is cumulative);
 *   - field names are lowerCamelCase.
 *
 * Nothing here has a default value that OTLP would treat differently from
 * leaving it out, so empty attribute lists are left out too.
 */
object OtlpJson {
    const val AGGREGATION_TEMPORALITY_CUMULATIVE: Int = 2

    fun metricsRequest(resource: List<Attribute>, scope: Scope, metrics: List<Metric>): JsonObject =
        buildJsonObject {
            putJsonArray("resourceMetrics") {
                add(
                    buildJsonObject {
                        put("resource", resource(resource))
                        putJsonArray("scopeMetrics") {
                            add(
                                buildJsonObject {
                                    put("scope", scope(scope))
                                    putJsonArray("metrics") {
                                        metrics.filter { it.data.points.isNotEmpty() }.forEach { add(metric(it)) }
                                    }
                                },
                            )
                        }
                    },
                )
            }
        }

    fun logsRequest(resource: List<Attribute>, scope: Scope, records: List<LogRecord>): JsonObject =
        buildJsonObject {
            putJsonArray("resourceLogs") {
                add(
                    buildJsonObject {
                        put("resource", resource(resource))
                        putJsonArray("scopeLogs") {
                            add(
                                buildJsonObject {
                                    put("scope", scope(scope))
                                    putJsonArray("logRecords") {
                                        records.forEach { add(logRecord(it)) }
                                    }
                                },
                            )
                        }
                    },
                )
            }
        }

    fun resource(attributes: List<Attribute>): JsonObject =
        buildJsonObject {
            put("attributes", attributes(attributes))
        }

    fun scope(scope: Scope): JsonObject =
        buildJsonObject {
            put("name", scope.name)
            put("version", scope.version)
        }

    fun metric(metric: Metric): JsonObject =
        buildJsonObject {
            put("name", metric.name)
            put("description", metric.description)
            put("unit", metric.unit)
            when (val data: MetricData = metric.data) {
                is MetricData.Gauge ->
                    putJsonObject("gauge") {
                        put("dataPoints", points(data.points))
                    }
                is MetricData.Sum ->
                    putJsonObject("sum") {
                        put("aggregationTemporality", AGGREGATION_TEMPORALITY_CUMULATIVE)
                        put("isMonotonic", data.isMonotonic)
                        put("dataPoints", points(data.points))
                    }
            }
        }

    private fun points(points: List<NumberPoint>): JsonArray =
        buildJsonArray {
            points.forEach { point -> add(point(point)) }
        }

    fun point(point: NumberPoint): JsonObject =
        buildJsonObject {
            if (point.attributes.isNotEmpty()) {
                put("attributes", attributes(point.attributes))
            }
            point.startTimeUnixNano?.let { put("startTimeUnixNano", it.toString()) }
            put("timeUnixNano", point.timeUnixNano.toString())
            when (val value: NumberValue = point.value) {
                is NumberValue.Whole -> put("asInt", value.value.toString())
                is NumberValue.Fraction -> put("asDouble", value.value)
            }
        }

    fun logRecord(record: LogRecord): JsonObject =
        buildJsonObject {
            put("timeUnixNano", record.timeUnixNano.toString())
            put("observedTimeUnixNano", record.observedTimeUnixNano.toString())
            put("severityNumber", record.severity.number)
            put("severityText", record.severity.text)
            putJsonObject("body") {
                put("stringValue", record.body)
            }
            if (record.attributes.isNotEmpty()) {
                put("attributes", attributes(record.attributes))
            }
        }

    fun attributes(attributes: List<Attribute>): JsonArray =
        buildJsonArray {
            attributes.forEach { attribute ->
                add(
                    buildJsonObject {
                        put("key", attribute.key)
                        put("value", value(attribute.value))
                    },
                )
            }
        }

    fun value(value: AttributeValue): JsonObject =
        buildJsonObject {
            when (value) {
                is AttributeValue.Text -> put("stringValue", value.value)
                is AttributeValue.Bool -> put("boolValue", value.value)
                is AttributeValue.Int64 -> put("intValue", value.value.toString())
                is AttributeValue.Real -> put("doubleValue", JsonPrimitive(value.value))
                is AttributeValue.TextList ->
                    putJsonObject("arrayValue") {
                        putJsonArray("values") {
                            value.values.forEach { item ->
                                add(buildJsonObject { put("stringValue", item) })
                            }
                        }
                    }
            }
        }
}
