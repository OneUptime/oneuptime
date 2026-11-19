package com.oneuptime.androidagent.otlp

/**
 * One OpenTelemetry attribute value, as OTLP carries it: a string, a boolean,
 * a 64-bit integer, a double, or an array of strings.
 */
sealed interface AttributeValue {
    data class Text(val value: String) : AttributeValue

    data class Bool(val value: Boolean) : AttributeValue

    data class Int64(val value: Long) : AttributeValue

    data class Real(val value: Double) : AttributeValue

    data class TextList(val values: List<String>) : AttributeValue
}

data class Attribute(val key: String, val value: AttributeValue)

/**
 * Builds an attribute list, leaving out what is not known: a null or blank
 * string, an empty list, or a number that is not finite. A resource or a
 * record then never carries an attribute whose value says nothing.
 */
class AttributesBuilder {
    private val attributes: MutableList<Attribute> = mutableListOf()

    fun text(key: String, value: String?) {
        val trimmed: String = value?.trim().orEmpty()
        if (trimmed.isNotEmpty()) {
            attributes.add(Attribute(key, AttributeValue.Text(trimmed)))
        }
    }

    fun bool(key: String, value: Boolean?) {
        if (value != null) {
            attributes.add(Attribute(key, AttributeValue.Bool(value)))
        }
    }

    fun int(key: String, value: Long?) {
        if (value != null) {
            attributes.add(Attribute(key, AttributeValue.Int64(value)))
        }
    }

    fun real(key: String, value: Double?) {
        if (value != null && value.isFinite()) {
            attributes.add(Attribute(key, AttributeValue.Real(value)))
        }
    }

    fun textList(key: String, values: List<String>) {
        val kept: List<String> = values.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (kept.isNotEmpty()) {
            attributes.add(Attribute(key, AttributeValue.TextList(kept)))
        }
    }

    fun all(other: List<Attribute>) {
        attributes.addAll(other)
    }

    fun build(): List<Attribute> = attributes.toList()
}

fun attributes(block: AttributesBuilder.() -> Unit): List<Attribute> = AttributesBuilder().apply(block).build()

fun List<Attribute>.textValue(key: String): String? =
    (firstOrNull { it.key == key }?.value as? AttributeValue.Text)?.value
