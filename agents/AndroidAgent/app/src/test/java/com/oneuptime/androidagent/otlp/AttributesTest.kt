package com.oneuptime.androidagent.otlp

import com.oneuptime.androidagent.testing.toMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AttributesTest {
    @Test
    fun `values that say nothing are left out`() {
        val built: List<Attribute> =
            attributes {
                text("kept", "  value  ")
                text("null", null)
                text("blank", "   ")
                int("count", null)
                bool("flag", null)
                real("nan", Double.NaN)
                real("infinite", Double.POSITIVE_INFINITY)
                textList("empty", listOf(" ", ""))
            }

        assertEquals(mapOf("kept" to "value"), built.toMap())
    }

    @Test
    fun `lists are trimmed and keep the first of each value`() {
        val built: List<Attribute> = attributes { textList("host.ip", listOf(" 10.0.0.5 ", "10.0.0.5", "", "fd00::5")) }

        assertEquals(listOf("10.0.0.5", "fd00::5"), built.toMap()["host.ip"])
    }

    @Test
    fun `every kind of value is kept as its kind`() {
        val built: Map<String, Any> =
            attributes {
                int("pid", 42L)
                bool("escaped", true)
                real("ratio", 0.25)
            }.toMap()

        assertEquals(42L, built["pid"])
        assertEquals(true, built["escaped"])
        assertEquals(0.25, built["ratio"])
    }

    @Test
    fun `textValue reads a string attribute by key`() {
        val built: List<Attribute> = attributes { text("host.name", "kiosk-01") }

        assertEquals("kiosk-01", built.textValue("host.name"))
        assertNull(built.textValue("missing"))
    }
}
