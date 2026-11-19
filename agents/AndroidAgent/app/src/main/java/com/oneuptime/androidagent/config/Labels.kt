package com.oneuptime.androidagent.config

/**
 * Reads the labels a device manager gives a device, "store=0412, region=emea",
 * into the pairs the agent sends as `oneuptime.label.store=0412`, which
 * OneUptime turns into the labels `store:0412` and `region:emea` on the
 * device's host.
 *
 * Pairs are separated by commas, semicolons or new lines, and each is
 * `name=value` or `name:value`. A name is letters, digits, `_`, `-` and `.`;
 * a pair with any other name, or no value, is left out and reported.
 */
object LabelParser {
    const val MAX_LABELS: Int = 20
    private const val MAX_VALUE_LENGTH: Int = 100

    private val NAME: Regex = Regex("^[A-Za-z0-9_.-]{1,64}$")

    data class Result(val labels: Map<String, String>, val rejected: List<String>)

    fun parse(text: String?): Result {
        val labels: LinkedHashMap<String, String> = LinkedHashMap()
        val rejected: MutableList<String> = mutableListOf()

        text.orEmpty()
            .split(',', ';', '\n')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .forEach { pair ->
                val separator: Int = pair.indexOfFirst { it == '=' || it == ':' }
                if (separator <= 0) {
                    rejected.add(pair)
                    return@forEach
                }
                val name: String = pair.substring(0, separator).trim()
                val value: String = pair.substring(separator + 1).trim().take(MAX_VALUE_LENGTH)
                if (!NAME.matches(name) || value.isEmpty() || labels.size >= MAX_LABELS) {
                    rejected.add(pair)
                    return@forEach
                }
                labels[name] = value
            }

        return Result(labels, rejected)
    }
}
