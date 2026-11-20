package com.oneuptime.androidagent.testing

import com.oneuptime.androidagent.Clock
import com.oneuptime.androidagent.device.DeviceFacts
import com.oneuptime.androidagent.otlp.Attribute
import com.oneuptime.androidagent.otlp.AttributeValue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A clock a test sets and moves by hand. */
class FakeClock(var now: Long = 1_795_076_857_467L, var elapsed: Long = 3_600_000L) : Clock {
    override fun nowMillis(): Long = now

    override fun elapsedRealtimeMillis(): Long = elapsed

    fun advance(millis: Long) {
        now += millis
        elapsed += millis
    }
}

/** An Elo kiosk on Android 14, the device most tests describe. */
fun kioskFacts(
    androidId: String? = "3f2a9c1b7d4e5a60",
    sdkInt: Int = 34,
    buildSerial: String? = null,
): DeviceFacts =
    DeviceFacts(
        manufacturer = "Elo Touch Solutions",
        model = "Elo-i3-15",
        androidRelease = "14",
        sdkInt = sdkInt,
        buildId = "UP1A.231005.007",
        buildDisplay = "ELO-I3-15-14.0.0-2024.06",
        securityPatch = "2024-06-05",
        androidId = androidId,
        supportedAbis = listOf("arm64-v8a", "armeabi-v7a", "armeabi"),
        buildSerial = buildSerial,
        logicalCpuCount = 8,
    )

fun List<Attribute>.toMap(): Map<String, Any> =
    associate { attribute ->
        attribute.key to
            when (val value: AttributeValue = attribute.value) {
                is AttributeValue.Text -> value.value
                is AttributeValue.Bool -> value.value
                is AttributeValue.Int64 -> value.value
                is AttributeValue.Real -> value.value
                is AttributeValue.TextList -> value.values
            }
    }

fun parseJson(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

/** OTLP JSON attributes (`[{key, value: {stringValue}}]`) as a map of key to the inner value object. */
fun JsonElement.otlpAttributes(): Map<String, JsonObject> =
    (this as? JsonArray ?: JsonArray(emptyList())).associate { item ->
        val entry: JsonObject = item.jsonObject
        entry.getValue("key").jsonPrimitive.content to entry.getValue("value").jsonObject
    }

fun JsonObject.array(key: String): JsonArray = getValue(key).jsonArray

fun JsonObject.obj(key: String): JsonObject = getValue(key).jsonObject

fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content

/** A java.lang.Process whose output is [output], for Logcat tests. */
class FakeProcess(output: String, private val exitCode: Int = 0) : Process() {
    private val stdout = output.byteInputStream(Charsets.UTF_8)

    @Volatile
    var destroyed: Boolean = false
        private set

    override fun getOutputStream(): java.io.OutputStream = java.io.OutputStream.nullOutputStream()

    override fun getInputStream(): java.io.InputStream = stdout

    override fun getErrorStream(): java.io.InputStream = java.io.InputStream.nullInputStream()

    override fun waitFor(): Int = exitCode

    override fun exitValue(): Int = exitCode

    override fun destroy() {
        destroyed = true
    }
}
