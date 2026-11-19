package com.oneuptime.androidagent.otlp

import com.oneuptime.androidagent.testing.array
import com.oneuptime.androidagent.testing.obj
import com.oneuptime.androidagent.testing.otlpAttributes
import com.oneuptime.androidagent.testing.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * The OTLP/JSON encoding OneUptime's /otlp endpoint decodes: proto3 JSON,
 * so 64-bit integers are strings, enums are numbers, names are camelCase.
 */
class OtlpJsonTest {
    private val scope = Scope("oneuptime-android-agent", "17.0.12")
    private val resource: List<Attribute> = attributes { text("host.name", "kiosk-01") }

    @Test
    fun `attribute values use the OTLP value fields, with integers as strings`() {
        assertEquals(JsonPrimitive("a"), OtlpJson.value(AttributeValue.Text("a"))["stringValue"])
        assertEquals(JsonPrimitive(true), OtlpJson.value(AttributeValue.Bool(true))["boolValue"])
        assertEquals(JsonPrimitive("9007199254740993"), OtlpJson.value(AttributeValue.Int64(9_007_199_254_740_993L))["intValue"])
        assertEquals(1.5, OtlpJson.value(AttributeValue.Real(1.5))["doubleValue"]!!.jsonPrimitive.double, 0.0)

        val list: JsonObject = OtlpJson.value(AttributeValue.TextList(listOf("10.0.0.5", "fd00::5")))
        val values = list.obj("arrayValue").array("values")
        assertEquals(listOf("10.0.0.5", "fd00::5"), values.map { it.jsonObject.text("stringValue") })
    }

    @Test
    fun `a gauge point has a time and asDouble, and no start time`() {
        val metric = Metric("system.uptime", "s", "Uptime", MetricData.Gauge(listOf(NumberPoint(NumberValue.Fraction(12.5), 1_000L))))
        val json: JsonObject = OtlpJson.metric(metric)

        assertEquals("system.uptime", json.text("name"))
        assertEquals("s", json.text("unit"))
        val point: JsonObject = json.obj("gauge").array("dataPoints")[0].jsonObject
        assertEquals("1000", point.text("timeUnixNano"))
        assertEquals(12.5, point.getValue("asDouble").jsonPrimitive.double, 0.0)
        assertFalse(point.containsKey("startTimeUnixNano"))
        assertFalse(point.containsKey("attributes"))
    }

    @Test
    fun `a sum is cumulative, says whether it is monotonic, and carries its start time and attributes`() {
        val point =
            NumberPoint(
                NumberValue.Whole(4_294_967_296L),
                timeUnixNano = 2_000L,
                attributes = attributes { text("direction", "receive") },
                startTimeUnixNano = 1_000L,
            )
        val json: JsonObject = OtlpJson.metric(Metric("system.network.io", "By", "Bytes", MetricData.Sum(listOf(point), isMonotonic = true)))

        val sum: JsonObject = json.obj("sum")
        assertEquals(2, sum.getValue("aggregationTemporality").jsonPrimitive.int)
        assertTrue(sum.getValue("isMonotonic").jsonPrimitive.boolean)
        val encoded: JsonObject = sum.array("dataPoints")[0].jsonObject
        assertEquals("4294967296", encoded.text("asInt"))
        assertEquals("1000", encoded.text("startTimeUnixNano"))
        assertEquals("receive", encoded.getValue("attributes").otlpAttributes().getValue("direction").text("stringValue"))
    }

    @Test
    fun `a metrics request nests resource, scope and metrics, and leaves out metrics with no points`() {
        val metrics =
            listOf(
                Metric("system.uptime", "s", "Uptime", MetricData.Gauge(listOf(NumberPoint(NumberValue.Fraction(1.0), 1L)))),
                Metric("system.cpu.utilization", "1", "CPU", MetricData.Gauge(emptyList())),
            )
        val request: JsonObject = OtlpJson.metricsRequest(resource, scope, metrics)

        val resourceMetrics: JsonObject = request.array("resourceMetrics")[0].jsonObject
        assertEquals("kiosk-01", resourceMetrics.obj("resource").getValue("attributes").otlpAttributes().getValue("host.name").text("stringValue"))
        val scopeMetrics: JsonObject = resourceMetrics.array("scopeMetrics")[0].jsonObject
        assertEquals("oneuptime-android-agent", scopeMetrics.obj("scope").text("name"))
        assertEquals("17.0.12", scopeMetrics.obj("scope").text("version"))
        assertEquals(listOf("system.uptime"), scopeMetrics.array("metrics").map { it.jsonObject.text("name") })
    }

    @Test
    fun `a log record carries both times as strings, its severity as number and text, and a string body`() {
        val record =
            LogRecord(
                timeUnixNano = 1_795_076_857_467_000_000L,
                observedTimeUnixNano = 1_795_076_858_000_000_000L,
                severity = Severity.WARN,
                body = "Low memory: \"cached\" apps killed",
                attributes = attributes { text("android.log.tag", "ActivityManager") },
            )
        val request: JsonObject = OtlpJson.logsRequest(resource, scope, listOf(record))
        val encoded: JsonObject =
            request.array("resourceLogs")[0].jsonObject.array("scopeLogs")[0].jsonObject.array("logRecords")[0].jsonObject

        assertEquals("1795076857467000000", encoded.text("timeUnixNano"))
        assertEquals("1795076858000000000", encoded.text("observedTimeUnixNano"))
        assertEquals(13, encoded.getValue("severityNumber").jsonPrimitive.int)
        assertEquals("WARN", encoded.text("severityText"))
        assertEquals("Low memory: \"cached\" apps killed", encoded.obj("body").text("stringValue"))
        assertEquals("ActivityManager", encoded.getValue("attributes").otlpAttributes().getValue("android.log.tag").text("stringValue"))
    }

    @Test
    fun `severity numbers are the OpenTelemetry ones`() {
        assertEquals(listOf(1, 5, 9, 13, 17, 21), Severity.entries.map { it.number })
    }

    @Test
    fun `milliseconds become nanoseconds`() {
        assertEquals(1_000_000L, millisToNanos(1L))
        assertEquals(1_795_076_857_467_000_000L, millisToNanos(1_795_076_857_467L))
    }
}
